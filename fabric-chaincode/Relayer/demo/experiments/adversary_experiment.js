/**
 * Strategic-adversary and collusion experiments, driven by the REAL production
 * detection code:
 *   - reputation_store.js  → `inObservationPeriod` (alignment-variance anomaly)
 *   - behavior_analyzer.js → `hiddenCollusionAgents` (disputed-vote similarity ≥ 0.9)
 *
 * Strategic adversary (paper scenario 3): an agent behaves honestly for K tasks
 * then attacks (always-approve). We measure detection latency = tasks after the
 * flip until the real ReputationStore flags it (observation period) and until its
 * weight falls below the honest median.
 *
 * Collusion (paper scenario 4): two cross-org agents vote in lockstep. We feed the
 * real BehaviorAnalyzer and measure true-positive (colluders flagged) vs
 * false-positive (honest flagged) rates as a function of disputed-task count.
 * Honest agents carry an independent error rate, so honest pairs do NOT reach the
 * 0.9 similarity bar — the discriminator the detector relies on.
 *
 * See docs/xn/验证方案-方法对比评估.md and paper §VIII.
 */

const { ReputationStore } = require('../negotiation/reputation_store');
const { BehaviorAnalyzer } = require('../negotiation/behavior_analyzer');
const { ma3cDecision } = require('./baselines/decision_strategies');
const { SeededRng } = require('./ma3c_wbft_simulator');
const { summarize } = require('./stats');

function honestVote(taskValid, rng, errorRate) {
    const correct = taskValid ? 'APPROVE' : 'REJECT';
    const wrong = taskValid ? 'REJECT' : 'APPROVE';
    const erred = rng.next() < errorRate;
    return {
        decision: erred ? wrong : correct,
        confidence: Number((0.75 + rng.next() * 0.2).toFixed(2))
    };
}

function median(values) {
    if (!values.length) return 0;
    const s = values.slice().sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Strategic adversary: one agent flips honest→always-approve at task `flipAt`.
 * Returns, per trial, tasks-after-flip until (a) observation period triggers and
 * (b) weight drops below the honest median.
 */
function runStrategicAdversary({
    n = 7,
    flipAt = 50,
    observeTasks = 40,
    honestErrorRate = 0.08,
    trials = 100,
    baseSeed = 20260417
} = {}) {
    const obsLatencies = [];
    const weightLatencies = [];
    let detectedObs = 0;
    let detectedWeight = 0;

    for (let t = 0; t < trials; t += 1) {
        const rng = new SeededRng(baseSeed + t * 7919);
        const store = new ReputationStore();
        const agentIds = Array.from({ length: n }, (_, i) => `agent-${i + 1}`);
        const attackerId = agentIds[0];
        store.ensure(agentIds);

        let obsLatency = null;
        let weightLatency = null;
        const totalTasks = flipAt + observeTasks;

        for (let k = 0; k < totalTasks; k += 1) {
            const taskValid = k % 2 === 0;
            const attacking = k >= flipAt;
            const opinions = agentIds.map((agentId) => {
                const isAttacker = agentId === attackerId;
                const weight = store.getWeight(agentId);
                let vote;
                if (isAttacker && attacking) {
                    vote = { decision: 'APPROVE', confidence: 0.9 }; // always-approve attack
                } else {
                    vote = honestVote(taskValid, rng, honestErrorRate);
                }
                return { agentId, decision: vote.decision, confidence: vote.confidence, assignedWeight: weight, latencyMs: 60 };
            });

            const result = ma3cDecision(opinions, { n });
            const finalDecision = result.finalDecision === 'OBSERVE' ? (taskValid ? 'COMMIT' : 'REJECT') : result.finalDecision;
            store.updateFromRound(opinions, { finalDecision });

            if (attacking) {
                const since = k - flipAt + 1;
                const snap = store.get(attackerId);
                if (obsLatency === null && snap?.inObservationPeriod) obsLatency = since;
                const honestWeights = agentIds.filter((id) => id !== attackerId).map((id) => store.getWeight(id));
                if (weightLatency === null && store.getWeight(attackerId) < median(honestWeights)) weightLatency = since;
            }
        }

        if (obsLatency !== null) { detectedObs += 1; obsLatencies.push(obsLatency); }
        if (weightLatency !== null) { detectedWeight += 1; weightLatencies.push(weightLatency); }
    }

    return {
        meta: { n, flipAt, observeTasks, honestErrorRate, trials },
        observationPeriod: {
            detectionRate: Number((detectedObs / trials).toFixed(4)),
            tasksToDetect: summarize(obsLatencies)
        },
        weightBelowHonestMedian: {
            detectionRate: Number((detectedWeight / trials).toFixed(4)),
            tasksToDetect: summarize(weightLatencies)
        }
    };
}

/**
 * Collusion: `colluderCount` cross-org agents vote in lockstep (always APPROVE)
 * regardless of evidence; honest agents track truth with an independent error
 * rate. Drives the real BehaviorAnalyzer over `disputedTasks` disputed entries.
 */
function runCollusionDetection({
    n = 7,
    colluderCount = 2,
    disputedTasks = 30,
    honestErrorRate = 0.12,
    trials = 100,
    baseSeed = 20260417
} = {}) {
    let trueDetect = 0;       // both colluders flagged
    let anyHonestFalse = 0;   // any honest agent falsely flagged
    const analyzer = new BehaviorAnalyzer();

    for (let t = 0; t < trials; t += 1) {
        const rng = new SeededRng(baseSeed + t * 7919);
        const store = new ReputationStore();
        const agents = Array.from({ length: n }, (_, i) => ({
            agentId: `agent-${i + 1}`,
            role: 'VERIFIER',
            focus: ['proof', 'balanced', 'semantic'][i % 3],
            organization: `org-${String.fromCharCode(97 + i)}`, // distinct orgs
            strategyType: 'B_POLICY_CHECKER'
        }));
        store.ensure(agents.map((a) => a.agentId));
        const colluderIds = agents.slice(0, colluderCount).map((a) => a.agentId);

        const history = [];
        for (let k = 0; k < disputedTasks; k += 1) {
            const taskValid = k % 2 === 0;
            const opinions = agents.map((a) => {
                if (colluderIds.includes(a.agentId)) {
                    return { agentId: a.agentId, decision: 'APPROVE', confidence: 0.9 }; // lockstep
                }
                const v = honestVote(taskValid, rng, honestErrorRate);
                return { agentId: a.agentId, decision: v.decision, confidence: v.confidence };
            });
            // Disputed = not unanimous (colluders force disagreement on invalid tasks).
            const decisions = new Set(opinions.map((o) => o.decision));
            history.push({ wasDisputed: decisions.size > 1, opinions });
        }

        const { reports, hiddenCollusionAgents } = analyzer.analyzeCandidates({ agents, history, reputationStore: store });
        const flagged = new Set(hiddenCollusionAgents);
        if (colluderIds.every((id) => flagged.has(id))) trueDetect += 1;
        const honestIds = agents.map((a) => a.agentId).filter((id) => !colluderIds.includes(id));
        if (honestIds.some((id) => flagged.has(id))) anyHonestFalse += 1;
        void reports;
    }

    return {
        meta: { n, colluderCount, disputedTasks, honestErrorRate, trials },
        trueDetectionRate: Number((trueDetect / trials).toFixed(4)),
        falsePositiveRate: Number((anyHonestFalse / trials).toFixed(4))
    };
}

function runCollusionSweep({ disputedCounts = [10, 20, 30, 50], ...rest } = {}) {
    return disputedCounts.map((disputedTasks) => runCollusionDetection({ ...rest, disputedTasks }));
}

module.exports = {
    runStrategicAdversary,
    runCollusionDetection,
    runCollusionSweep
};
