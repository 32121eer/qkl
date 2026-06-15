/**
 * REAL-agent Byzantine-robustness experiment (no numeric simulation, no mock LLM).
 *
 * Opinions come from the actual production `VerifierAgent.execute()` rule-based
 * path (useLLM:false → real evaluateChecks→decide→calculateConfidence), with real
 * adversarial `behavior` injection. Arbitration is run by real arbiter agents.
 * Those real opinions are then aggregated by MA3C and the baselines (B0–B2) for a
 * paired head-to-head. This tests the SHIPPING implementation, not a behavior model.
 *
 * Scope note: without an LLM the rule-based agents adjudicate cryptographic/
 * structural validity (pre-verification, collector quorum, proof) but NOT semantic
 * value mismatch — so this experiment uses VALID vs CRYPTO-TAMPERED tasks, the
 * classes the real agents decisively verify, and stresses CONSENSUS robustness to
 * Byzantine agents (the LLM semantic layer is calibrated separately, see
 * scripts/collect_llm_calibration.js). See docs/xn/验证方案-方法对比评估.md §13.
 */

const { VerifierAgent } = require('../agents/verifier_agent');
const { DEFAULT_NORMAL_THRESHOLD } = require('../negotiation/protocol_config');
const {
    STRATEGIES,
    ma3cDecision,
    isCorrect,
    isFalseAccept,
    isFalseReject
} = require('./baselines/decision_strategies');
const { summarize, pairedComparison } = require('./stats');

const ORGS = ['org-a', 'org-b', 'org-c', 'org-d', 'org-e', 'org-f', 'org-g'];
const FOCUS_CYCLE = ['proof', 'balanced', 'semantic'];
const DEFAULT_METHODS = ['ma3c', 'weightedBft', 'equalMajority', 'pbft', 'singleRelay'];
const THRESHOLD_ARB = 0.75;

/** A complete, valid evidence bundle the real agents accept. */
function validEvidence() {
    const evidenceHash = '0xevhash-valid';
    return {
        request: { txHash: '0xsrc-valid' },
        sourceTxHash: '0xsrc-valid',
        payload: { found: true, result: { batchId: 'BATCH-APPLE-0001', grade: 'A' }, record: { batchId: 'BATCH-APPLE-0001' } },
        preVerification: { status: 'PASS' },
        sourceHeader: { number: 1039 },
        sourceHeaderHash: '0xhdr-1039',
        queryProof: { commitment: { value: '0xc' }, queryObject: { statement: 's' } },
        queryObject: { statement: 's' },
        collectorAttestations: [
            { organization: 'orgA', evidenceHash },
            { organization: 'orgB', evidenceHash }
        ]
    };
}

/**
 * Labeled task. groundTruth VALID → honest agents APPROVE; INVALID (crypto
 * pre-verification failed) → honest agents REJECT. session.queryVerifyStatus
 * mirrors the on-chain cryptographic pre-check the agents read.
 */
function buildTask(index, groundTruth) {
    const evidence = validEvidence();
    let queryVerifyStatus = 'PASS';
    if (groundTruth === 'INVALID') {
        evidence.preVerification = { status: 'FAIL' };
        evidence.queryProof = null;
        queryVerifyStatus = 'FAILED';
    }
    return {
        task: {
            taskId: `rt-${index}`,
            queryId: `rq-${index}`,
            risk: 'NORMAL',
            sourceChain: 'FISCO',
            targetChain: 'FABRIC',
            evidenceBundle: evidence
        },
        groundTruth,
        session: { queryVerifyStatus, resultPayload: evidence.payload.result }
    };
}

/**
 * Build a committee of real VerifierAgents. The first `maliciousCount` agents get
 * the adversarial `behavior` (default always_approve = force-accept forged
 * evidence, the dangerous false-accept attack); the rest are honest.
 */
function buildCommittee({ n, maliciousRatio = 0, behavior = 'always_approve' }) {
    const maliciousCount = Math.min(n, Math.max(0, Math.round(n * maliciousRatio)));
    const agents = [];
    for (let i = 0; i < n; i += 1) {
        agents.push(new VerifierAgent({
            agentId: `verifier-${String(i + 1).padStart(2, '0')}`,
            focus: FOCUS_CYCLE[i % FOCUS_CYCLE.length],
            organization: ORGS[i % ORGS.length],
            strictProof: false,
            useLLM: false,
            behavior: i < maliciousCount ? behavior : 'honest'
        }));
    }
    return agents;
}

/** Honest, higher-quality arbiter committee (real agents). */
function buildArbiters(k = 5) {
    const focus = ['proof', 'semantic', 'balanced', 'proof', 'semantic'];
    const arbiters = [];
    for (let i = 0; i < k; i += 1) {
        arbiters.push(new VerifierAgent({
            agentId: `arbiter-${i + 1}`,
            focus: focus[i % focus.length],
            organization: ORGS[i % ORGS.length],
            strictProof: false,
            useLLM: false,
            behavior: 'honest'
        }));
    }
    return arbiters;
}

/** Collect REAL opinions from agents for one task. Silent agents are dropped. */
async function collectOpinions(agents, taskCase, { round = 2, weightOf } = {}) {
    const context = {
        round,
        session: taskCase.session,
        submitterPlan: { readyForSubmission: true, planId: 'plan-1' }
    };
    const opinions = [];
    for (const agent of agents) {
        const assignedWeight = weightOf ? weightOf(agent.agentId) : (1 / agents.length);
        try {
            const env = await agent.execute(taskCase.task, { ...context, assignedWeight });
            opinions.push({
                agentId: env.agentId,
                decision: env.decision,
                confidence: env.confidence,
                assignedWeight,
                focus: env.focus
            });
        } catch (error) {
            if (error.code === 'AGENT_SILENT') continue; // silent attack → no reveal
            throw error;
        }
    }
    return opinions;
}

async function arbitrate(arbiters, taskCase) {
    const opinions = await collectOpinions(arbiters, taskCase, { round: 2 });
    const result = ma3cDecision(opinions, { threshold: THRESHOLD_ARB, n: arbiters.length });
    return result.finalDecision === 'OBSERVE' ? 'TIMEOUT' : result.finalDecision;
}

function emptyCounters() {
    return { correct: 0, falseAccept: 0, falseReject: 0, observe: 0, timeout: 0, arbitrated: 0, total: 0 };
}

function record(counters, finalDecision, groundTruth, arbitrated) {
    const valid = groundTruth === 'VALID';
    counters.total += 1;
    if (isCorrect(finalDecision, valid)) counters.correct += 1;
    if (isFalseAccept(finalDecision, valid)) counters.falseAccept += 1;
    if (isFalseReject(finalDecision, valid)) counters.falseReject += 1;
    if (finalDecision === 'OBSERVE') counters.observe += 1;
    if (finalDecision === 'TIMEOUT') counters.timeout += 1;
    if (arbitrated) counters.arbitrated += 1;
}

/**
 * One trial = one committee adjudicating a stream of labeled tasks; every method
 * aggregates the SAME real opinions. Returns per-method rate samples.
 */
async function runRealAgentByzantine({
    methods = DEFAULT_METHODS,
    n = 5,
    maliciousRatio = 0.4,
    behavior = 'always_approve',
    threshold = DEFAULT_NORMAL_THRESHOLD,
    trials = 20,
    tasksPerTrial = 10,
    enableArbitration = true
} = {}) {
    const perTrial = {};
    for (const method of methods) {
        perTrial[method] = { correctness: [], falseAccept: [], falseReject: [], escalationRate: [] };
    }

    for (let t = 0; t < trials; t += 1) {
        const agents = buildCommittee({ n, maliciousRatio, behavior });
        const arbiters = buildArbiters(5);
        const counters = {};
        for (const method of methods) counters[method] = emptyCounters();

        for (let k = 0; k < tasksPerTrial; k += 1) {
            const groundTruth = k % 2 === 0 ? 'VALID' : 'INVALID';
            const taskCase = buildTask(`${t}-${k}`, groundTruth);
            const opinions = await collectOpinions(agents, taskCase);
            const relayIndex = (t + k) % Math.max(1, opinions.length);

            for (const method of methods) {
                const strat = STRATEGIES[method];
                const result = strat.decide(opinions.map((o) => ({ ...o })), { threshold, n, relayIndex });
                let finalDecision = result.finalDecision;
                let arbitrated = false;
                if (finalDecision === 'OBSERVE' && strat.usesArbitration && enableArbitration) {
                    finalDecision = await arbitrate(arbiters, taskCase); // eslint-disable-line no-await-in-loop
                    arbitrated = true;
                }
                record(counters[method], finalDecision, groundTruth, arbitrated);
            }
        }

        for (const method of methods) {
            const c = counters[method];
            perTrial[method].correctness.push(c.correct / c.total);
            perTrial[method].falseAccept.push(c.falseAccept / c.total);
            perTrial[method].falseReject.push(c.falseReject / c.total);
            perTrial[method].escalationRate.push(c.arbitrated / c.total);
        }
    }

    const methodSummaries = {};
    for (const method of methods) {
        methodSummaries[method] = {
            label: STRATEGIES[method].label,
            correctness: summarize(perTrial[method].correctness),
            falseAccept: summarize(perTrial[method].falseAccept),
            falseReject: summarize(perTrial[method].falseReject),
            escalationRate: summarize(perTrial[method].escalationRate)
        };
    }
    const comparisons = {};
    if (methods.includes('ma3c')) {
        for (const method of methods) {
            if (method === 'ma3c') continue;
            comparisons[`ma3c_vs_${method}`] = {
                correctness: pairedComparison(perTrial.ma3c.correctness, perTrial[method].correctness),
                falseAcceptReduction: pairedComparison(perTrial[method].falseAccept, perTrial.ma3c.falseAccept)
            };
        }
    }

    return {
        meta: { mode: 'real-agent', n, maliciousRatio, behavior, threshold, trials, tasksPerTrial, enableArbitration },
        methods: methodSummaries,
        comparisons
    };
}

async function runRealAgentSweep({ maliciousRatios = [0, 0.2, 0.4, 0.6], ...rest } = {}) {
    const out = [];
    for (const maliciousRatio of maliciousRatios) {
        out.push(await runRealAgentByzantine({ ...rest, maliciousRatio })); // eslint-disable-line no-await-in-loop
    }
    return out;
}

module.exports = {
    validEvidence,
    buildTask,
    buildCommittee,
    buildArbiters,
    collectOpinions,
    runRealAgentByzantine,
    runRealAgentSweep
};
