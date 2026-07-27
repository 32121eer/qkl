/**
 * REAL-agent VRF-rotation ablation — upgrades the SIMULATED D.3 rotation ablation
 * to production components. Drives the real `CommitteeSelector` (weighted VRF
 * selection + ⌊n/3⌋ organization cap), real `VerifierAgent`s, real
 * `ReputationStore`, and real `ma3cDecision`. No modeled opinions.
 *
 * Threat: a co-located colluding bloc (same org, `always_approve` forge-accept).
 *   ON  = per-task VRF reselection from the pool with the org cap → bloc capped
 *         to a minority.
 *   OFF = a fixed committee seating the whole bloc first (co-located majority).
 * Arbitration is OFF here to isolate the rotation/selection mechanism.
 */

const { ReputationStore } = require('../negotiation/reputation_store');
const { CommitteeSelector } = require('../negotiation/committee_selector');
const { buildProtocolParams } = require('../negotiation/protocol_config');
const { VerifierAgent } = require('../agents/verifier_agent');
const { ma3cDecision, isCorrect, isFalseAccept } = require('./baselines/decision_strategies');
const { buildTask, collectOpinions } = require('./real_agent_experiment');
const { summarize, pairedComparison } = require('./stats');

const ORGS = ['org-a', 'org-b', 'org-c', 'org-d', 'org-e', 'org-f', 'org-g', 'org-h'];
const FOCUS = ['proof', 'balanced', 'semantic'];

/** Pool: `colluderCount` same-org always_approve colluders + honest, org-diverse rest. */
function buildPool({ poolSize = 21, colluderCount = 5 }) {
    const agents = [];
    for (let i = 0; i < colluderCount; i += 1) {
        agents.push(new VerifierAgent({
            agentId: `col-${String(i + 1).padStart(2, '0')}`,
            focus: FOCUS[i % FOCUS.length],
            organization: 'org-colluder',
            strictProof: false,
            useLLM: false,
            behavior: 'always_approve'
        }));
    }
    for (let i = 0; i < poolSize - colluderCount; i += 1) {
        agents.push(new VerifierAgent({
            agentId: `hon-${String(i + 1).padStart(2, '0')}`,
            focus: FOCUS[i % FOCUS.length],
            organization: ORGS[i % ORGS.length],
            strictProof: false,
            useLLM: false,
            behavior: 'honest'
        }));
    }
    return agents;
}

async function runRealVrfAblation({
    rotate,
    poolSize = 21,
    colluderCount = 5,
    n = 7,
    tasksPerTrial = 40,
    trials = 100
} = {}) {
    const pool = buildPool({ poolSize, colluderCount });
    const colluders = pool.filter((a) => a.behavior !== 'honest');
    const honest = pool.filter((a) => a.behavior === 'honest');
    const fixedCommittee = colluders.concat(honest).slice(0, n); // OFF: bloc seated first
    const params = buildProtocolParams('CRITICAL'); // n target 7, orgLimit ⌊7/3⌋=2, θ=0.75

    const correctnessSamples = [];
    const falseAcceptSamples = [];
    let blocSeatsAccum = 0;
    let tasksAccum = 0;

    for (let tr = 0; tr < trials; tr += 1) {
        const repStore = new ReputationStore({});
        repStore.ensure(pool.map((a) => a.agentId));
        const selector = new CommitteeSelector({ reputationStore: repStore, targetCommitteeSize: n });
        let correct = 0;
        let falseAccept = 0;

        for (let t = 0; t < tasksPerTrial; t += 1) {
            const taskValid = t % 2 === 0;
            const groundTruth = taskValid ? 'VALID' : 'INVALID';
            const taskCase = buildTask(`${tr}-${t}`, groundTruth);

            let committee;
            if (rotate) {
                const res = selector.select({
                    agents: pool,
                    committeeSize: n,
                    task: { ...taskCase.task, risk: 'CRITICAL' },
                    protocolParams: params
                });
                committee = res.selected;
            } else {
                committee = fixedCommittee;
            }

            blocSeatsAccum += committee.filter((a) => a.organization === 'org-colluder').length;
            tasksAccum += 1;

            const opinions = await collectOpinions(committee, taskCase, {
                weightOf: (id) => repStore.getWeight(id) || (1 / committee.length)
            });
            const { finalDecision } = ma3cDecision(opinions, { threshold: params.threshold, n });
            if (isCorrect(finalDecision, taskValid)) correct += 1;
            if (isFalseAccept(finalDecision, taskValid)) falseAccept += 1;
        }
        correctnessSamples.push(correct / tasksPerTrial);
        falseAcceptSamples.push(falseAccept / tasksPerTrial);
    }

    return {
        meta: {
            rotate, poolSize, colluderCount, n,
            organizationLimit: params.organizationLimit,
            threshold: params.threshold,
            tasksPerTrial, trials,
            meanBlocSeatsPerCommittee: Number((blocSeatsAccum / tasksAccum).toFixed(3))
        },
        correctness: summarize(correctnessSamples),
        falseAccept: summarize(falseAcceptSamples),
        correctnessSamples,
        falseAcceptSamples
    };
}

async function runRotationComparison(opts = {}) {
    const on = await runRealVrfAblation({ ...opts, rotate: true });
    const off = await runRealVrfAblation({ ...opts, rotate: false });
    return {
        on,
        off,
        correctnessGain: pairedComparison(on.correctnessSamples, off.correctnessSamples),
        falseAcceptReduction: pairedComparison(off.falseAcceptSamples, on.falseAcceptSamples)
    };
}

module.exports = { buildPool, runRealVrfAblation, runRotationComparison };
