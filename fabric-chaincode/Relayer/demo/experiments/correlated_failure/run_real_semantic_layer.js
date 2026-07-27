/**
 * Real-judgment-driven semantic-layer tolerance (paper §VIII, real-data D.2 counterpart).
 *
 * D.2 in the paper feeds SIMULATED honest votes (honest agents err at a modeled rate pᵢ)
 * into the aggregation. This harness instead feeds the REAL per-case honest judgments
 * collected from live LLMs in experiment 5.7 (raw_samples.json) — so the honest error is
 * the models' MEASURED error, not a modeled pᵢ — and injects malicious forge-accept votes
 * at 20/40/60%. It then runs the SAME production aggregation rules (ma3cDecision and the
 * baselines) so any gap is attributable to the rule, exactly like D.1 does for the
 * deterministic layer. This is the real-data answer to "can the probabilistic honest-error
 * simulation be replaced by real data": yes, at the per-judgment level.
 *
 * Honest votes: sampled (with replacement) from a model's real repeats for each case, so
 * their error rate and case-by-case correlation are the real ones. Malicious votes: APPROVE
 * regardless (forge-accept). Confidence is set from the calibration mean (calibration.json
 * captured judgment+correctness but not per-sample confidence); reputation is uniform —
 * this isolates the honest-error realism, which lives in the judgments.
 *
 * Run: node run_real_semantic_layer.js   (needs raw_samples.json from run_correlated_failure.js)
 */

const fs = require('fs');
const path = require('path');
const {
    ma3cDecision, equalMajorityDecision, pbftDecision, weightedBftDecision,
    singleRelayDecision, isCorrect, isFalseAccept
} = require('../baselines/decision_strategies');
const { summarize } = require('../stats');

const RAW = path.join(__dirname, 'raw_samples.json');
const HONEST_CONF = 0.9;   // calibration meanConfidenceCorrect ≈ 0.92
const MAL_CONF = 0.95;     // malicious agents over-report confidence
const N = Number(process.env.N || 5);
const TRIALS = Number(process.env.TRIALS || 400);
const TASKS = Number(process.env.TASKS || 20);
const RATIOS = [0.2, 0.4, 0.6];

class Rng { constructor(s = 20260629) { this.s = (s >>> 0) || 1; } next() { this.s = (1664525 * this.s + 1013904223) >>> 0; return this.s / 0x100000000; } int(a, b) { return Math.floor(this.next() * (b - a + 1)) + a; } }

function loadByCase(raw, model) {
    const byCase = {};
    for (const s of raw.rawSamples[model]) (byCase[s.caseId] = byCase[s.caseId] || []).push(s.judgment);
    return byCase;
}

// honestVote(caseId, rng) → 'APPROVE'|'REJECT', drawn from REAL model repeats.
// mode 'homo:<model>' draws from one model (correlated, ρ high);
// mode 'hetero' draws each vote from a random model (model-diverse, ρ lower).
function makeSampler(raw, mode) {
    if (mode.startsWith('homo:')) {
        const m = mode.slice(5);
        const bc = loadByCase(raw, m);
        return (cid, rng) => (bc[cid] || ['REJECT'])[rng.int(0, (bc[cid] || [0]).length - 1)];
    }
    const bcs = raw.models.map((m) => loadByCase(raw, m));
    return (cid, rng) => {
        const bc = bcs[rng.int(0, bcs.length - 1)];
        const reps = bc[cid] || ['REJECT'];
        return reps[rng.int(0, reps.length - 1)];
    };
}

function run(raw, mode) {
    const sampleHonest = makeSampler(raw, mode);
    const cases = raw.casesMeta;                       // [{id, truth}]
    const rng = new Rng();
    const methods = { ma3c: ma3cDecision, equalMajority: equalMajorityDecision, pbft: pbftDecision, weightedBft: weightedBftDecision, singleRelay: singleRelayDecision };
    const out = {};

    for (const ratio of RATIOS) {
        const f = Math.floor(N * ratio);               // malicious seats
        const acc = {}; const fa = {};
        for (const m of Object.keys(methods)) { acc[m] = []; fa[m] = []; }

        for (let t = 0; t < TRIALS; t += 1) {
            const correct = {}; const falseAcc = {};
            for (const m of Object.keys(methods)) { correct[m] = 0; falseAcc[m] = 0; }

            for (let k = 0; k < TASKS; k += 1) {
                const c = cases[rng.int(0, cases.length - 1)];
                const truth = c.truth;                 // 'ACCEPT' | 'REJECT'
                const taskValid = truth === 'ACCEPT';

                // n votes: f malicious APPROVE + (n-f) honest REAL judgments.
                const opinions = [];
                for (let i = 0; i < N; i += 1) {
                    const malicious = i < f;
                    let judgment;
                    if (malicious) judgment = 'APPROVE';
                    else judgment = sampleHonest(c.id, rng) === 'ACCEPT' ? 'APPROVE' : 'REJECT';
                    opinions.push({
                        agentId: `${malicious ? 'mal' : 'hon'}-${i}`,
                        decision: judgment,
                        confidence: malicious ? MAL_CONF : HONEST_CONF,
                        assignedWeight: 1
                    });
                }
                const relayIndex = rng.int(0, N - 1);
                for (const [m, fn] of Object.entries(methods)) {
                    const r = fn(opinions, { threshold: 0.7, n: N, relayIndex });
                    // ma3c escalates OBSERVE to arbitration: a fresh honest committee on the
                    // same case (real judgments), majority verdict.
                    let dec = r.finalDecision;
                    if (m === 'ma3c' && dec === 'OBSERVE') {
                        let a = 0; let rj = 0;
                        for (let q = 0; q < 5; q += 1) (sampleHonest(c.id, rng) === 'ACCEPT' ? a++ : rj++);
                        dec = a > rj ? 'COMMIT' : 'REJECT';
                    }
                    if (isCorrect(dec, taskValid)) correct[m] += 1;
                    if (isFalseAccept(dec, taskValid)) falseAcc[m] += 1;
                }
            }
            for (const m of Object.keys(methods)) { acc[m].push(correct[m] / TASKS); fa[m].push(falseAcc[m] / TASKS); }
        }
        out[`mr${ratio}`] = Object.fromEntries(Object.keys(methods).map((m) => [m, {
            correctness: summarize(acc[m]), falseAccept: summarize(fa[m])
        }]));
    }
    return out;
}

function errRate(raw, model) {
    const s = raw.rawSamples[model];
    return 1 - s.filter((x) => x.correct).length / s.length;
}

function main() {
    const raw = JSON.parse(fs.readFileSync(RAW, 'utf8'));
    const modes = [
        ['homo:' + raw.models[0], `homogeneous (${raw.models[0]} only)`],
        ['homo:' + raw.models[1], `homogeneous (${raw.models[1]} only)`],
        ['hetero', `heterogeneous (mix of ${raw.models.join(' + ')})`]
    ];
    const measuredErr = Object.fromEntries(raw.models.map((m) => [m, Number(errRate(raw, m).toFixed(4))]));
    const byMode = {};
    for (const [mode] of modes) byMode[mode] = run(raw, mode);

    const outObj = {
        experiment: 'real-judgment-driven-semantic-layer (D.2 real counterpart)',
        note: 'Honest votes are REAL per-case LLM judgments (exp 5.7), not a modeled pᵢ. Homogeneous = all honest agents share one model (errors correlated, ρ high); heterogeneous = honest votes drawn across both models (model-diverse, ρ lower). Confidence fixed from calibration mean; reputation uniform — isolates honest-error realism in the judgments.',
        measuredHonestErrorRate: measuredErr,
        config: { n: N, trials: TRIALS, tasksPerTrial: TASKS, ratios: RATIOS, honestConf: HONEST_CONF, malConf: MAL_CONF },
        modes: Object.fromEntries(modes),
        results: byMode,
        meta: { generatedAt: new Date().toISOString(), source: 'raw_samples.json (real LLM judgments, exp 5.7)' }
    };
    fs.writeFileSync(path.join(__dirname, 'real_semantic_layer_results.json'), `${JSON.stringify(outObj, null, 2)}\n`);

    process.stdout.write(`\nReal-judgment-driven semantic layer — measured honest err: ${JSON.stringify(measuredErr)}\n`);
    const cols = ['ma3c', 'equalMajority', 'pbft', 'weightedBft', 'singleRelay'];
    for (const [mode, label] of modes) {
        process.stdout.write(`\n### ${label}\nratio | ` + cols.map((m) => m.slice(0, 10)).join(' | ') + '\n');
        for (const ratio of RATIOS) {
            const r = byMode[mode][`mr${ratio}`];
            process.stdout.write(`${(ratio * 100).toFixed(0)}%   | ` +
                cols.map((m) => `${(r[m].correctness.mean * 100).toFixed(0)}%/fa${(r[m].falseAccept.mean * 100).toFixed(0)}`).join(' | ') + '\n');
        }
    }
    process.stdout.write(`\nwrote real_semantic_layer_results.json\n`);
}

if (require.main === module) main();
