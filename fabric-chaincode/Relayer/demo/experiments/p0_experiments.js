/**
 * P0 experiments backing the paper's remaining claims, driven by REAL components
 * (VerifierAgent, ReputationStore alignment scoring, BehaviorAnalyzer arbiters):
 *
 *   1. runThroughput          — §VIII scenario 1: verification-layer throughput &
 *                               the N·L_max/n concurrency model.
 *   2. runSilenceAttack       — §VIII scenario 5: commit-then-withhold-reveal;
 *                               liveness, arbitration recovery, −α₅ penalty.
 *   3. runParameterSensitivity— robustness of the headline result to θ /
 *                               honest-error / arbiter-error.
 *   4. runIncentiveCompat     — §V Theorems 1–2: per-strategy long-run payoff,
 *                               using the real reputation alignment as the payoff.
 *
 * All run on this box with no chain / LLM. Latency where reported as end-to-end is
 * the analytical model (paper §VII); per-task compute time is measured.
 */

const { VerifierAgent } = require('../agents/verifier_agent');
const { ReputationStore } = require('../negotiation/reputation_store');
const { DEFAULT_NORMAL_THRESHOLD } = require('../negotiation/protocol_config');
const { ma3cDecision, isCorrect, isFalseAccept } = require('./baselines/decision_strategies');
const { SeededRng } = require('./ma3c_wbft_simulator');
const { summarize } = require('./stats');
const {
    buildCommittee,
    buildArbiters,
    buildTask,
    collectOpinions
} = require('./real_agent_experiment');

const LAT = { optimistic: 8, arbitration: 21 }; // seconds (paper §VII model)

function round4(v) { return Number((Number(v) || 0).toFixed(4)); }
function median(xs) {
    if (!xs.length) return 0;
    const s = xs.slice().sort((a, b) => a - b); const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// ---------------------------------------------------------------------------
// 1. Throughput & concurrency
// ---------------------------------------------------------------------------
/**
 * Measures the REAL per-task verification+consensus compute time over the actual
 * VerifierAgent pipeline, then derives concurrency capacity (⌊N·L_max/n⌋) and the
 * modeled end-to-end throughput (capacity / E[latency]). Compute throughput is
 * measured; end-to-end throughput is modeled (chain commit latency is off-box).
 */
async function runThroughput({
    poolSizes = [10, 20, 30],
    lMax = 3,
    n = 5,
    tasksPerPool = 200,
    optimisticShare = 0.75,
    baseSeed = 20260417
} = {}) {
    const rows = [];
    for (const N of poolSizes) {
        const agents = buildCommittee({ n: N, maliciousRatio: 0 });
        const rng = new SeededRng(baseSeed + N);
        // Warm-up (JIT) so the first pool isn't penalised by cold compilation.
        for (let w = 0; w < 30; w += 1) {
            const wc = Array.from({ length: n }, (_, i) => agents[i % N]);
            await collectOpinions(wc, buildTask(`warm-${N}-${w}`, w % 2 === 0 ? 'VALID' : 'INVALID')); // eslint-disable-line no-await-in-loop
        }
        let totalMs = 0;
        for (let t = 0; t < tasksPerPool; t += 1) {
            const groundTruth = t % 2 === 0 ? 'VALID' : 'INVALID';
            const taskCase = buildTask(`tp-${N}-${t}`, groundTruth);
            // committee = n agents sampled from the pool
            const start = rng.int(0, N - 1);
            const committee = Array.from({ length: n }, (_, i) => agents[(start + i) % N]);
            const t0 = process.hrtime.bigint();
            const opinions = await collectOpinions(committee, taskCase); // eslint-disable-line no-await-in-loop
            ma3cDecision(opinions, { threshold: DEFAULT_NORMAL_THRESHOLD, n });
            totalMs += Number(process.hrtime.bigint() - t0) / 1e6;
        }
        const computeMsPerTask = totalMs / tasksPerPool;
        const computeThroughput = 1000 / computeMsPerTask; // tasks/s (CPU-bound, no chain)
        const maxConcurrency = Math.floor((N * lMax) / n);
        const eLatency = optimisticShare * LAT.optimistic + (1 - optimisticShare) * LAT.arbitration;
        const modeledThroughput = maxConcurrency / eLatency; // tasks/s end-to-end
        rows.push({
            poolSize: N,
            maxConcurrency,
            computeMsPerTask: round4(computeMsPerTask),
            measuredComputeThroughputPerSec: round4(computeThroughput),
            modeledE2EThroughputPerSec: round4(modeledThroughput)
        });
    }
    return { meta: { lMax, n, tasksPerPool, optimisticShare, latencyModel: LAT }, rows };
}

// ---------------------------------------------------------------------------
// 2. Silence attack
// ---------------------------------------------------------------------------
/** Collect opinions, returning the IDs of agents that withheld (silent). */
async function collectWithSilence(agents, taskCase) {
    const opinions = [];
    const silentIds = [];
    const context = { round: 2, session: taskCase.session, submitterPlan: { readyForSubmission: true, planId: 'p' } };
    for (const agent of agents) {
        try {
            const env = await agent.execute(taskCase.task, { ...context, assignedWeight: 1 / agents.length }); // eslint-disable-line no-await-in-loop
            opinions.push({ agentId: env.agentId, decision: env.decision, confidence: env.confidence, assignedWeight: 0, focus: env.focus, latencyMs: 60 });
        } catch (error) {
            if (error.code === 'AGENT_SILENT') { silentIds.push(agent.agentId); continue; }
            throw error;
        }
    }
    return { opinions, silentIds };
}

/**
 * A fraction of the committee commits but never reveals (behavior='silent').
 * If valid reveals fall below ⌈n/2⌉+1 the task escalates to real arbiters. We
 * measure liveness (finalize rate), escalation, honest correctness, and the
 * silent agents' reputation collapse (−α₅).
 */
async function runSilenceAttack({
    n = 7,
    silentRatios = [0, 0.14, 0.28, 0.43],
    tasksPerTrial = 40,
    trials = 30,
    baseSeed = 20260417
} = {}) {
    const minReveals = Math.ceil(n / 2) + 1;
    const out = [];
    for (const ratio of silentRatios) {
        const finalizeRates = []; const escalationRates = []; const correctnessRates = []; const silentRepFinals = [];
        for (let tr = 0; tr < trials; tr += 1) {
            const agents = buildCommittee({ n, maliciousRatio: ratio, behavior: 'silent' });
            const arbiters = buildArbiters(5);
            const silentSet = new Set(agents.filter((a) => a.behavior === 'silent').map((a) => a.agentId));
            const store = new ReputationStore();
            store.ensure(agents.map((a) => a.agentId));
            let finalized = 0; let escalated = 0; let correct = 0;
            for (let k = 0; k < tasksPerTrial; k += 1) {
                const gt = k % 2 === 0 ? 'VALID' : 'INVALID';
                const taskCase = buildTask(`sil-${tr}-${k}`, gt);
                const { opinions, silentIds } = await collectWithSilence(agents, taskCase); // eslint-disable-line no-await-in-loop
                for (const op of opinions) op.assignedWeight = store.getWeight(op.agentId);
                let decision; let arbitrated = false;
                if (opinions.length < minReveals) {
                    const ao = await collectOpinions(arbiters, taskCase); // eslint-disable-line no-await-in-loop
                    const ar = ma3cDecision(ao, { threshold: 0.75, n: arbiters.length });
                    decision = ar.finalDecision === 'OBSERVE' ? 'TIMEOUT' : ar.finalDecision;
                    arbitrated = true;
                } else {
                    const r = ma3cDecision(opinions, { threshold: DEFAULT_NORMAL_THRESHOLD, n });
                    if (r.finalDecision === 'OBSERVE') {
                        const ao = await collectOpinions(arbiters, taskCase); // eslint-disable-line no-await-in-loop
                        const ar = ma3cDecision(ao, { threshold: 0.75, n: arbiters.length });
                        decision = ar.finalDecision === 'OBSERVE' ? 'TIMEOUT' : ar.finalDecision;
                        arbitrated = true;
                    } else { decision = r.finalDecision; }
                }
                if (decision === 'COMMIT' || decision === 'REJECT') finalized += 1;
                if (arbitrated) escalated += 1;
                if (isCorrect(decision, gt === 'VALID')) correct += 1;
                store.updateFromRound(opinions, { finalDecision: decision }, { silentRevealers: silentIds });
            }
            finalizeRates.push(finalized / tasksPerTrial);
            escalationRates.push(escalated / tasksPerTrial);
            correctnessRates.push(correct / tasksPerTrial);
            const silentReps = [...silentSet].map((id) => store.get(id)?.reputation || 0);
            if (silentReps.length) silentRepFinals.push(median(silentReps));
        }
        out.push({
            silentRatio: ratio,
            silentCount: Math.round(n * ratio),
            minRevealsNeeded: minReveals,
            finalizeRate: summarize(finalizeRates),
            escalationRate: summarize(escalationRates),
            correctness: summarize(correctnessRates),
            silentAgentFinalReputation: silentRepFinals.length ? summarize(silentRepFinals) : null
        });
    }
    return { meta: { n, tasksPerTrial, trials }, results: out };
}

// ---------------------------------------------------------------------------
// 3. Parameter sensitivity
// ---------------------------------------------------------------------------
/**
 * Re-runs the real-agent Byzantine comparison while sweeping one parameter at a
 * time, reporting MA3C correctness, false-accept, and the MA3C−equal correctness
 * gap. Stable gaps across the ranges ⇒ the headline is not parameter-fragile.
 * (Uses the sim comparison so θ / honest-error / arbiter-error are all tunable.)
 */
function runParameterSensitivity({
    runDecisionComparison,
    n = 5,
    maliciousRatio = 0.4,
    seeds = 120,
    tasksPerSeed = 16,
    thetas = [0.65, 0.70, 0.75],
    honestErrorRates = [0.05, 0.10, 0.15, 0.20],
    baseSeed = 20260417
} = {}) {
    const pick = (report) => ({
        ma3cCorrect: round4(report.methods.ma3c.correctness.mean),
        ma3cFalseAccept: round4(report.methods.ma3c.falseAccept.mean),
        vsEqualDeltaPP: round4((report.comparisons.ma3c_vs_equalMajority?.correctness?.meanDiff ?? 0) * 100),
        sig: report.comparisons.ma3c_vs_equalMajority?.correctness?.ciExcludesZero ?? null
    });
    const base = { n, maliciousRatio, seeds, tasksPerSeed, honestErrorRate: 0.12, baseSeed };
    return {
        meta: { ...base, swept: ['theta', 'honestErrorRate'] },
        theta: thetas.map((threshold) => ({ theta: threshold, ...pick(runDecisionComparison({ ...base, threshold })) })),
        honestErrorRate: honestErrorRates.map((he) => ({ honestErrorRate: he, ...pick(runDecisionComparison({ ...base, honestErrorRate: he })) }))
    };
}

// ---------------------------------------------------------------------------
// 4. Incentive compatibility (Theorems 1–2)
// ---------------------------------------------------------------------------
const STRATEGIES = ['honest', 'freerider', 'overconfident', 'malicious'];

function strategyVote(strategy, taskValid, rng, p = 0.1) {
    const correct = taskValid ? 'APPROVE' : 'REJECT';
    const wrong = taskValid ? 'REJECT' : 'APPROVE';
    if (strategy === 'honest') {
        const erred = rng.next() < p;
        return { decision: erred ? wrong : correct, confidence: erred ? 0.75 : 0.9, verified: true };
    }
    if (strategy === 'overconfident') { // verifies but always claims high confidence
        const erred = rng.next() < p;
        return { decision: erred ? wrong : correct, confidence: 0.95, verified: true };
    }
    if (strategy === 'freerider') { // no verification → guess ACCEPT, low confidence
        return { decision: 'APPROVE', confidence: 0.6, verified: false };
    }
    // malicious: force-accept, high confidence
    return { decision: 'APPROVE', confidence: 0.9, verified: false };
}

/**
 * Repeated game: a committee with one agent per strategy (plus an honest majority)
 * runs a task stream. Payoff = cumulative reputation-alignment reward (the real α
 * scoring, paper §IV-H) minus verification cost v for strategies that verify.
 * Validates that honest+truthful-confidence yields the strictly highest long-run
 * payoff (Theorems 1–2 / DSIC).
 */
function runIncentiveCompatibility({
    n = 8,
    tasksPerTrial = 300,
    trials = 40,
    honestErrorRate = 0.1,
    verifyCost = 0.2,
    baseSeed = 20260417
} = {}) {
    const payoffByStrategy = {}; const repByStrategy = {};
    for (const s of STRATEGIES) { payoffByStrategy[s] = []; repByStrategy[s] = []; }

    for (let tr = 0; tr < trials; tr += 1) {
        const rng = new SeededRng(baseSeed + tr * 7919);
        // One agent per non-honest strategy + fill the rest honest (honest majority).
        const assign = ['freerider', 'overconfident', 'malicious'];
        const agents = [];
        for (let i = 0; i < n; i += 1) {
            const strategy = i < assign.length ? assign[i] : 'honest';
            agents.push({ agentId: `ag-${i + 1}`, strategy });
        }
        const store = new ReputationStore();
        store.ensure(agents.map((a) => a.agentId));
        const cumPayoff = Object.fromEntries(agents.map((a) => [a.agentId, 0]));

        for (let k = 0; k < tasksPerTrial; k += 1) {
            const taskValid = k % 2 === 0;
            const opinions = agents.map((a) => {
                const v = strategyVote(a.strategy, taskValid, rng, honestErrorRate);
                return { agentId: a.agentId, decision: v.decision, confidence: v.confidence, assignedWeight: store.getWeight(a.agentId), latencyMs: 60, _verified: v.verified };
            });
            const r = ma3cDecision(opinions, { threshold: DEFAULT_NORMAL_THRESHOLD, n });
            const finalDecision = r.finalDecision === 'OBSERVE' ? (taskValid ? 'COMMIT' : 'REJECT') : r.finalDecision;
            const before = Object.fromEntries(agents.map((a) => [a.agentId, store.get(a.agentId)?.alignmentScore || 0]));
            store.updateFromRound(opinions, { finalDecision });
            for (const op of opinions) {
                const deltaAlign = (store.get(op.agentId)?.alignmentScore || 0) - before[op.agentId];
                cumPayoff[op.agentId] += deltaAlign - (op._verified ? verifyCost : 0);
            }
        }
        // Aggregate per strategy (one representative agent per non-honest strategy;
        // honest = average over the honest agents).
        for (const s of STRATEGIES) {
            const ids = agents.filter((a) => a.strategy === s).map((a) => a.agentId);
            if (!ids.length) continue;
            payoffByStrategy[s].push(ids.reduce((acc, id) => acc + cumPayoff[id], 0) / ids.length);
            repByStrategy[s].push(ids.reduce((acc, id) => acc + (store.get(id)?.reputation || 0), 0) / ids.length);
        }
    }

    const summary = {};
    for (const s of STRATEGIES) {
        summary[s] = { cumulativePayoff: summarize(payoffByStrategy[s]), finalReputation: summarize(repByStrategy[s]) };
    }
    const honestMean = summary.honest.cumulativePayoff.mean;
    summary._honestDominates = STRATEGIES.filter((s) => s !== 'honest').every((s) => honestMean > summary[s].cumulativePayoff.mean);
    return { meta: { n, tasksPerTrial, trials, honestErrorRate, verifyCost }, strategies: summary };
}

module.exports = {
    runThroughput,
    runSilenceAttack,
    runParameterSensitivity,
    runIncentiveCompatibility,
    STRATEGIES
};
