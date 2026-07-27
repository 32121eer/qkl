/**
 * Head-to-head comparison harness: MA3C vs baselines B0–B3.
 *
 * Two modes, both paired by construction (identical task stream / opinion sets
 * across methods, identical seeds):
 *
 *   runDecisionComparison  — fresh reputation each task; isolates the AGGREGATION
 *                            RULE (answers H1/H2: tolerance vs malicious ratio).
 *   runSequentialComparison — persistent committee, per-method reputation evolves;
 *                            shows ADAPTIVE TRUST (reputation/learning) advantage.
 *
 * See docs/xn/验证方案-方法对比评估.md (sections 1, 3, 6).
 */

const {
    SeededRng,
    buildAgentPopulation,
    buildOpinion
} = require('./ma3c_wbft_simulator');
const { ma3cDecision } = require('./baselines/decision_strategies');
const { ReputationStore } = require('../negotiation/reputation_store');
const { DEFAULT_NORMAL_THRESHOLD } = require('../negotiation/protocol_config');
const {
    STRATEGIES,
    isCorrect,
    isFalseAccept,
    isFalseReject
} = require('./baselines/decision_strategies');
const { summarize, pairedComparison } = require('./stats');
const fs = require('fs');

const DEFAULT_METHODS = ['ma3c', 'repWeighted', 'confWeighted', 'cpwbft', 'weightedBft', 'staticNotary', 'equalMajority', 'pbft', 'singleRelay'];

/**
 * Optional calibration from real LLM measurements (scripts/collect_llm_calibration.js).
 * When CALIBRATION_FILE points at a calibration.json, its calibratedParams replace
 * the hand-picked defaults (honestErrorRate, arbiterErrorFactor). Cached once.
 */
let _calibrationCache;
function loadCalibration(file = process.env.CALIBRATION_FILE) {
    if (_calibrationCache !== undefined) return _calibrationCache;
    _calibrationCache = null;
    if (file && fs.existsSync(file)) {
        try {
            _calibrationCache = JSON.parse(fs.readFileSync(file, 'utf8')).calibratedParams || null;
        } catch {
            _calibrationCache = null;
        }
    }
    return _calibrationCache;
}

function cloneOpinions(opinions) {
    return opinions.map((item) => ({ ...item }));
}

function flipDecision(decision) {
    const d = String(decision || '').toUpperCase();
    if (d === 'APPROVE') return 'REJECT';
    if (d === 'REJECT') return 'APPROVE';
    return d;
}

/**
 * Generate one settled-round opinion set for a fresh task. `evidenceReady` is
 * true so honest agents are not stuck in QUESTION (we compare the decisive round).
 *
 * `honestErrorRate` injects the probabilistic honest signal the paper's game
 * model assumes (§V-A: P(σᵢ=ω)=1−pᵢ) but the base simulator omits. An erring
 * honest agent reports the WRONG side at its normal confidence — exactly the
 * regime where equal-weight majority can be outvoted and confidence/reputation
 * weighting earns its keep. By type: proof≈crypto (lowest error), balanced, then
 * semantic/structural (LLM reasoning, highest error). Malicious agents unaffected.
 */
function generateOpinions({ agents, taskValid, rng, weightMap, honestErrorRate = 0 }) {
    const typeMultiplier = { proof: 0.4, balanced: 1.0, structural: 1.6, semantic: 1.6 };
    return agents.map((agent) => {
        const opinion = buildOpinion({
            agent,
            taskValid,
            round: 2,
            assignedWeight: weightMap ? (weightMap[agent.agentId] || 0) : (1 / agents.length),
            rng,
            evidenceReady: true
        });
        if (honestErrorRate > 0 && agent.honest && (opinion.decision === 'APPROVE' || opinion.decision === 'REJECT')) {
            const p = honestErrorRate * (typeMultiplier[agent.focus] ?? 1.0);
            if (rng.next() < p) {
                opinion.decision = flipDecision(opinion.decision);
                opinion.erred = true;
            }
        }
        return opinion;
    });
}

// Paper §VI latency model (ms): optimistic path vs arbitration path vs timeout.
const LATENCY = { optimistic: 8000, arbitration: 21000, timeout: 90000 };
const DEFAULT_THRESHOLD_ARB = 0.75;

/**
 * Phase-4 arbitration committee. A SEPARATE, higher-quality pool of k arbiters
 * (higher reputation, multi-strategy, lower error). They run the same weighted
 * vote at θ_arb=0.75. Arbiters are NOT oracles — they have their own error rate,
 * just markedly lower (arbiterErrorFactor) than line verifiers; with k of them
 * voting independently their majority is reliable but not perfect. If even
 * arbitration is sub-threshold → TIMEOUT (paper: rare, no result delivered).
 *
 * This both (a) resolves OBSERVE decisively so correctness is scored fairly, and
 * (b) yields a ground-truth signal to grade verifier reputation against, which
 * is what breaks the cold-start learning deadlock.
 */
function resolveByArbitration({
    rng,
    taskValid,
    honestErrorRate = 0,
    k = 5,
    thresholdArb = DEFAULT_THRESHOLD_ARB,
    arbiterErrorFactor = loadCalibration()?.arbiterErrorFactor ?? 0.3
}) {
    const arbiters = [];
    const focusCycle = ['proof', 'balanced', 'semantic'];
    for (let i = 0; i < k; i += 1) {
        arbiters.push({
            agentId: `arb-${i + 1}`,
            focus: focusCycle[i % focusCycle.length],
            honest: true,
            isNewcomer: false,
            baseLatencyMs: 40,
            qualityBias: 0.92 + rng.next() * 0.06,
            maliciousBias: 0
        });
    }
    const opinions = generateOpinions({
        agents: arbiters,
        taskValid,
        rng,
        honestErrorRate: honestErrorRate * arbiterErrorFactor
    });
    const result = ma3cDecision(opinions, { threshold: thresholdArb, n: k });
    // Below θ_arb on both sides → no quorum → TIMEOUT (treated as no result).
    return { finalDecision: result.finalDecision === 'OBSERVE' ? 'TIMEOUT' : result.finalDecision };
}

function emptyCounters() {
    return { correct: 0, falseAccept: 0, falseReject: 0, observe: 0, timeout: 0, arbitrated: 0, total: 0, latencyMs: 0 };
}

function recordOutcome(counters, finalDecision, taskValid, { arbitrated = false, latencyMs = LATENCY.optimistic } = {}) {
    counters.total += 1;
    if (isCorrect(finalDecision, taskValid)) counters.correct += 1;
    if (isFalseAccept(finalDecision, taskValid)) counters.falseAccept += 1;
    if (isFalseReject(finalDecision, taskValid)) counters.falseReject += 1;
    if (finalDecision === 'OBSERVE') counters.observe += 1;
    if (finalDecision === 'TIMEOUT') counters.timeout += 1;
    if (arbitrated) counters.arbitrated += 1;
    counters.latencyMs += latencyMs;
}

/**
 * Apply a strategy and, for MA3C, escalate OBSERVE to arbitration (when enabled).
 * Returns the EFFECTIVE final decision (post-arbitration) plus cost metadata.
 * The effective decision is what both correctness scoring and reputation feedback
 * should use — escalation is a feature, not a failure.
 */
function decideWithArbitration({ method, opinions, cfg, taskValid, arbSeed, honestErrorRate, enableArbitration }) {
    const strat = STRATEGIES[method];
    const result = strat.decide(opinions, cfg);
    if (result.finalDecision === 'OBSERVE' && strat.usesArbitration && enableArbitration) {
        // Per-task derived RNG: arbitration draws don't pollute the main stream,
        // so results are identical regardless of which/how many methods escalate.
        const arb = resolveByArbitration({
            rng: new SeededRng(arbSeed),
            taskValid,
            honestErrorRate,
            thresholdArb: DEFAULT_THRESHOLD_ARB
        });
        const latencyMs = arb.finalDecision === 'TIMEOUT' ? LATENCY.timeout : LATENCY.arbitration;
        return { finalDecision: arb.finalDecision, arbitrated: true, latencyMs };
    }
    return { finalDecision: result.finalDecision, arbitrated: false, latencyMs: LATENCY.optimistic };
}

/**
 * Mode 1 — decision-rule comparison with fresh reputation.
 * Each seed yields a per-method rate triple; rates are compared pairwise.
 */
function runDecisionComparison({
    methods = DEFAULT_METHODS,
    n = 5,
    maliciousRatio = 0.2,
    threshold = DEFAULT_NORMAL_THRESHOLD,
    seeds = 200,
    tasksPerSeed = 20,
    honestErrorRate = 0,
    enableArbitration = true,
    baseSeed = 20260417
} = {}) {
    const perSeed = {};
    for (const method of methods) {
        perSeed[method] = { correctness: [], falseAccept: [], falseReject: [], escalationRate: [], avgLatencyMs: [] };
    }

    for (let s = 0; s < seeds; s += 1) {
        const rng = new SeededRng(baseSeed + s * 7919);
        const counters = {};
        for (const method of methods) counters[method] = emptyCounters();

        for (let t = 0; t < tasksPerSeed; t += 1) {
            const taskValid = t % 2 === 0;
            const agents = buildAgentPopulation({ n, maliciousRatio, rng });
            const opinions = generateOpinions({ agents, taskValid, rng, honestErrorRate });
            // Pre-pick relay index and arbitration seed from the SAME stream so
            // every method sees an identical task (paired regardless of method set).
            const relayIndex = rng.int(0, agents.length - 1);
            const arbSeed = rng.int(1, 0x7fffffff);

            for (const method of methods) {
                const outcome = decideWithArbitration({
                    method,
                    opinions: cloneOpinions(opinions),
                    cfg: { threshold, n, relayIndex },
                    taskValid,
                    arbSeed,
                    honestErrorRate,
                    enableArbitration
                });
                recordOutcome(counters[method], outcome.finalDecision, taskValid, outcome);
            }
        }

        for (const method of methods) {
            const c = counters[method];
            perSeed[method].correctness.push(c.correct / c.total);
            perSeed[method].falseAccept.push(c.falseAccept / c.total);
            perSeed[method].falseReject.push(c.falseReject / c.total);
            perSeed[method].escalationRate.push(c.arbitrated / c.total);
            perSeed[method].avgLatencyMs.push(c.latencyMs / c.total);
        }
    }

    return assembleReport({
        methods,
        perSeed,
        extraMetrics: ['escalationRate', 'avgLatencyMs'],
        meta: { mode: 'decision', n, maliciousRatio, threshold, seeds, tasksPerSeed, honestErrorRate, enableArbitration }
    });
}

/**
 * Mode 2 — sequential comparison: fixed committee, malicious agents lie every
 * task. Reputation-using methods evolve their own store and downweight liars;
 * stateless methods do not. Reveals the adaptive-trust advantage over time.
 */
function runSequentialComparison({
    methods = DEFAULT_METHODS,
    n = 7,
    maliciousRatio = 0.3,
    threshold = DEFAULT_NORMAL_THRESHOLD,
    seeds = 100,
    tasksPerSeed = 120,
    warmupSplit = 0.5,
    honestErrorRate = 0,
    enableArbitration = true,
    baseSeed = 20260417
} = {}) {
    const perSeed = {};
    for (const method of methods) {
        perSeed[method] = { correctness: [], falseAccept: [], falseReject: [], lateCorrectness: [], escalationRate: [], avgLatencyMs: [] };
    }

    const warmupTasks = Math.floor(tasksPerSeed * warmupSplit);

    for (let s = 0; s < seeds; s += 1) {
        const rng = new SeededRng(baseSeed + s * 7919);
        // Fixed committee for the whole stream (no churn — isolates learning).
        const agents = buildAgentPopulation({ n, maliciousRatio, rng });
        const agentIds = agents.map((a) => a.agentId);

        const repStores = {};
        const counters = {};
        const lateCounters = {};
        for (const method of methods) {
            counters[method] = emptyCounters();
            lateCounters[method] = emptyCounters();
            if (STRATEGIES[method].usesReputation) {
                repStores[method] = new ReputationStore();
                repStores[method].ensure(agentIds);
            }
        }

        for (let t = 0; t < tasksPerSeed; t += 1) {
            const taskValid = t % 2 === 0;
            const opinions = generateOpinions({ agents, taskValid, rng, honestErrorRate });
            const relayIndex = rng.int(0, agents.length - 1);
            const arbSeed = rng.int(1, 0x7fffffff);

            for (const method of methods) {
                const strat = STRATEGIES[method];
                const view = cloneOpinions(opinions);
                const store = strat.usesReputation ? repStores[method] : null;
                if (store) {
                    for (const op of view) {
                        op.assignedWeight = store.getWeight(op.agentId);
                    }
                }
                const outcome = decideWithArbitration({
                    method,
                    opinions: view,
                    cfg: { threshold, n, relayIndex },
                    taskValid,
                    arbSeed,
                    honestErrorRate,
                    enableArbitration
                });
                recordOutcome(counters[method], outcome.finalDecision, taskValid, outcome);
                if (t >= warmupTasks) recordOutcome(lateCounters[method], outcome.finalDecision, taskValid, outcome);
                // Grade verifiers against the EFFECTIVE (post-arbitration) outcome —
                // the protocol's own ground truth. This is what lets reputation
                // learn even when the verifier round itself was indecisive
                // (breaks the cold-start deadlock). TIMEOUT yields no signal.
                if (store && (outcome.finalDecision === 'COMMIT' || outcome.finalDecision === 'REJECT')) {
                    store.updateFromRound(view, { finalDecision: outcome.finalDecision });
                }
            }
        }

        for (const method of methods) {
            const c = counters[method];
            const lc = lateCounters[method];
            perSeed[method].correctness.push(c.correct / c.total);
            perSeed[method].falseAccept.push(c.falseAccept / c.total);
            perSeed[method].falseReject.push(c.falseReject / c.total);
            perSeed[method].lateCorrectness.push(lc.total ? lc.correct / lc.total : 0);
            perSeed[method].escalationRate.push(c.arbitrated / c.total);
            perSeed[method].avgLatencyMs.push(c.latencyMs / c.total);
        }
    }

    return assembleReport({
        methods,
        perSeed,
        extraMetrics: ['lateCorrectness', 'escalationRate', 'avgLatencyMs'],
        meta: { mode: 'sequential', n, maliciousRatio, threshold, seeds, tasksPerSeed, warmupTasks, honestErrorRate, enableArbitration }
    });
}

function assembleReport({ methods, perSeed, meta, extraMetrics = [] }) {
    const metrics = ['correctness', 'falseAccept', 'falseReject', ...extraMetrics];
    const methodSummaries = {};
    for (const method of methods) {
        methodSummaries[method] = { label: STRATEGIES[method].label };
        for (const metric of metrics) {
            methodSummaries[method][metric] = summarize(perSeed[method][metric]);
        }
    }

    // MA3C vs every other method, paired per seed.
    const comparisons = {};
    if (methods.includes('ma3c')) {
        for (const method of methods) {
            if (method === 'ma3c') continue;
            comparisons[`ma3c_vs_${method}`] = {
                correctness: pairedComparison(perSeed.ma3c.correctness, perSeed[method].correctness),
                // For falseAccept, fewer is better → compare baseline−ma3c so positive = MA3C safer.
                falseAcceptReduction: pairedComparison(perSeed[method].falseAccept, perSeed.ma3c.falseAccept)
            };
        }
    }

    return { meta, methods: methodSummaries, comparisons };
}

/**
 * Sweep malicious ratio for the tolerance curve (H1/H2 main figure data).
 */
function runToleranceSweep({
    methods = DEFAULT_METHODS,
    n = 5,
    maliciousRatios = [0, 0.1, 0.2, 0.3, 0.4, 0.45],
    threshold = DEFAULT_NORMAL_THRESHOLD,
    seeds = 200,
    tasksPerSeed = 20,
    honestErrorRate = 0,
    enableArbitration = true,
    baseSeed = 20260417
} = {}) {
    return maliciousRatios.map((maliciousRatio, offset) => runDecisionComparison({
        methods,
        n,
        maliciousRatio,
        threshold,
        seeds,
        tasksPerSeed,
        honestErrorRate,
        enableArbitration,
        baseSeed: baseSeed + offset * 104729
    }));
}

module.exports = {
    DEFAULT_METHODS,
    loadCalibration,
    generateOpinions,
    runDecisionComparison,
    runSequentialComparison,
    runToleranceSweep
};
