/**
 * P1 mechanism ablations: each of the three design pillars is toggled ON/OFF in
 * the *specific* threat regime it is supposed to defend, so we can show the
 * mechanism is load-bearing rather than decorative.
 *
 *   1. Strategy HETEROGENEITY      vs  correlated honest errors  (相关错误)
 *      ON  = A/B/C strategies with independent error modes (low ρ).
 *      OFF = homogeneous committee whose honest errors are correlated (high ρ);
 *            on a "hard" task many honest agents flip the SAME way and overturn
 *            the honest majority.  (paper §III-A, §IV intro: independence ⇒ low ρ)
 *
 *   2. VRF rotation + org cap      vs  co-located collusion        (串通共址)
 *      ON  = per-task VRF re-selection from a larger pool with ≤⌊n/3⌋ per org,
 *            so a same-org colluding bloc can never seat a committee majority.
 *      OFF = a fixed committee with no rotation / no org cap; the colluding bloc
 *            is permanently seated and dominates the weighted vote.
 *            (paper §IV-B Algorithm 1, §VII-A coalition resistance)
 *
 *   3. commit-reveal               vs  herding information cascade  (从众级联)
 *      ON  = sealed independent commits; nobody sees others before revealing.
 *      OFF = open sequential reveal; herding-prone honest agents copy the
 *            running majority, so a few early loud (malicious) votes cascade into
 *            a wrong landslide.  (paper §IV-E, §VII anti-herding)
 *
 * All three reuse the PRODUCTION aggregation rule (`ma3cDecision`, rep×conf
 * weighted vote at θ) — only the threat/mechanism is modeled here, so the ON/OFF
 * gap is attributable to the mechanism alone. Scope: these are simulation
 * ablations of the consensus layer (no LLM, no chain), paired across matched
 * seeds; arbitration is deliberately OFF so each pillar is isolated (arbitration
 * is ablated separately in comparative_runner `--no-arbitration`).
 *
 * See docs/xn/验证方案-方法对比评估.md and paper §VIII (P1 ablations).
 */

const { SeededRng } = require('./ma3c_wbft_simulator');
const {
    ma3cDecision,
    isCorrect,
    isFalseAccept,
    isFalseReject
} = require('./baselines/decision_strategies');
const { organizationLimit, DEFAULT_NORMAL_THRESHOLD } = require('../negotiation/protocol_config');
const { summarize, pairedComparison } = require('./stats');

function round4(value) {
    return Number((Number(value) || 0).toFixed(4));
}

// ---- shared scoring helpers -------------------------------------------------

function emptyCounter() {
    return { correct: 0, falseAccept: 0, falseReject: 0, observe: 0, total: 0 };
}

function score(counter, finalDecision, taskValid) {
    counter.total += 1;
    if (isCorrect(finalDecision, taskValid)) counter.correct += 1;
    if (isFalseAccept(finalDecision, taskValid)) counter.falseAccept += 1;
    if (isFalseReject(finalDecision, taskValid)) counter.falseReject += 1;
    if (finalDecision === 'OBSERVE') counter.observe += 1;
}

function emptyRates() {
    return { correctness: [], falseAccept: [], falseReject: [], observe: [] };
}

function pushRates(rates, counter) {
    rates.correctness.push(counter.correct / counter.total);
    rates.falseAccept.push(counter.falseAccept / counter.total);
    rates.falseReject.push(counter.falseReject / counter.total);
    rates.observe.push(counter.observe / counter.total);
}

function summarizeRates(rates) {
    return {
        correctness: summarize(rates.correctness),
        falseAccept: summarize(rates.falseAccept),
        falseReject: summarize(rates.falseReject),
        observe: summarize(rates.observe)
    };
}

/**
 * Assemble the ON-vs-OFF report: per-config means±CI plus the paired delta
 * (ON−OFF correctness, OFF−ON false-accept so positive = ON safer) and a verdict
 * on whether the mechanism is load-bearing in this regime.
 */
function assembleAblation({ meta, onRates, offRates }) {
    const on = summarizeRates(onRates);
    const off = summarizeRates(offRates);
    const correctnessGain = pairedComparison(onRates.correctness, offRates.correctness);
    const falseAcceptReduction = pairedComparison(offRates.falseAccept, onRates.falseAccept);
    return {
        meta,
        on,
        off,
        correctnessGain,
        falseAcceptReduction,
        // Mechanism is load-bearing if turning it ON significantly improves
        // correctness OR significantly reduces false-accept (CI excludes 0).
        loadBearing: Boolean(
            (correctnessGain && correctnessGain.ciExcludesZero && correctnessGain.meanDiff > 0)
            || (falseAcceptReduction && falseAcceptReduction.ciExcludesZero && falseAcceptReduction.meanDiff > 0)
        )
    };
}

function honestConfidence(rng) {
    return round4(0.75 + rng.next() * 0.2);
}

// =============================================================================
// Ablation 1 — strategy heterogeneity vs correlated honest errors
// =============================================================================

/**
 * Correlated-error model. Each honest agent has marginal error rate p. With
 * correlation ρ it adopts a per-task COMMON-MODE error outcome (shared across all
 * homogeneous agents) instead of an independent draw — so on a "hard" task the
 * whole homogeneous committee tends to err together. Marginal stays p for any ρ
 * (P(err)=ρ·p+(1−ρ)·p=p); only the covariance changes. ρ=0 ⇒ heterogeneous
 * (independent A/B/C strategies); ρ high ⇒ homogeneous (one strategy type).
 */
function honestVoteCorrelated({ taskValid, rng, p, rho, sharedErr }) {
    const correct = taskValid ? 'APPROVE' : 'REJECT';
    const wrong = taskValid ? 'REJECT' : 'APPROVE';
    const erred = rng.next() < rho ? sharedErr : rng.next() < p;
    return { decision: erred ? wrong : correct, confidence: honestConfidence(rng) };
}

function runHeterogeneityConfig({ rho, n, maliciousCount, honestErrorRate, threshold, seeds, tasksPerSeed, baseSeed }) {
    const rates = emptyRates();
    for (let s = 0; s < seeds; s += 1) {
        const rng = new SeededRng(baseSeed + s * 7919);
        const counter = emptyCounter();
        for (let t = 0; t < tasksPerSeed; t += 1) {
            const taskValid = t % 2 === 0;
            const sharedErr = rng.next() < honestErrorRate; // common-mode draw, once per task
            const opinions = [];
            for (let i = 0; i < n; i += 1) {
                const malicious = i < maliciousCount;
                if (malicious) {
                    // forge-accept Byzantine: always APPROVE regardless of validity
                    opinions.push({ agentId: `a-${i}`, decision: 'APPROVE', confidence: 0.9, assignedWeight: 1 });
                } else {
                    const v = honestVoteCorrelated({ taskValid, rng, p: honestErrorRate, rho, sharedErr });
                    opinions.push({ agentId: `a-${i}`, decision: v.decision, confidence: v.confidence, assignedWeight: 1 });
                }
            }
            const result = ma3cDecision(opinions, { threshold, n });
            score(counter, result.finalDecision, taskValid);
        }
        pushRates(rates, counter);
    }
    return rates;
}

/**
 * ON = heterogeneous (ρ=0, independent errors); OFF = homogeneous (ρ=rho).
 * Same committee size / malicious load / marginal honest error in both — only the
 * error CORRELATION differs.
 */
function runHeterogeneityAblation({
    n = 7,
    maliciousRatio = 0.2,
    honestErrorRate = 0.12,
    rho = 0.85,
    threshold = DEFAULT_NORMAL_THRESHOLD,
    seeds = 200,
    tasksPerSeed = 40,
    baseSeed = 20260417
} = {}) {
    const maliciousCount = Math.round(n * maliciousRatio);
    const common = { n, maliciousCount, honestErrorRate, threshold, seeds, tasksPerSeed, baseSeed };
    const onRates = runHeterogeneityConfig({ rho: 0, ...common });
    const offRates = runHeterogeneityConfig({ rho, ...common });
    return assembleAblation({
        meta: { ablation: 'heterogeneity', threat: 'correlated honest errors', n, maliciousRatio, maliciousCount, honestErrorRate, rho, threshold, seeds, tasksPerSeed },
        onRates,
        offRates
    });
}

// =============================================================================
// Ablation 2 — VRF rotation + org cap vs co-located collusion
// =============================================================================

/**
 * VRF-weighted random selection of n agents from a pool, enforcing the org
 * diversity cap (paper Algorithm 1: same-org ≤ ⌊n/3⌋). Reputation-proportional;
 * with equal reputation this is uniform without replacement. An agent is skipped
 * if adding it would exceed its org's cap, modeling the "while same-org > ⌊n/3⌋
 * reselect" loop.
 */
function vrfSelect({ pool, n, rng }) {
    const cap = organizationLimit(n);
    const orgCount = {};
    const remaining = pool.slice();
    const chosen = [];
    while (chosen.length < n && remaining.length) {
        const idx = rng.int(0, remaining.length - 1);
        const agent = remaining.splice(idx, 1)[0];
        if ((orgCount[agent.org] || 0) >= cap) continue; // org cap → skip
        orgCount[agent.org] = (orgCount[agent.org] || 0) + 1;
        chosen.push(agent);
    }
    return chosen;
}

function colludingPool({ poolSize, colluders }) {
    const pool = [];
    for (let i = 0; i < colluders; i += 1) {
        pool.push({ agentId: `evil-${i}`, org: 'org-evil', malicious: true }); // co-located bloc
    }
    for (let i = 0; pool.length < poolSize; i += 1) {
        pool.push({ agentId: `honest-${i}`, org: `org-${i % 5}`, malicious: false });
    }
    return pool;
}

function committeeOpinions({ committee, taskValid, rng, honestErrorRate }) {
    return committee.map((agent) => {
        if (agent.malicious) {
            return { agentId: agent.agentId, decision: 'APPROVE', confidence: 0.9, assignedWeight: 1 };
        }
        const correct = taskValid ? 'APPROVE' : 'REJECT';
        const wrong = taskValid ? 'REJECT' : 'APPROVE';
        const erred = rng.next() < honestErrorRate;
        return { agentId: agent.agentId, decision: erred ? wrong : correct, confidence: honestConfidence(rng), assignedWeight: 1 };
    });
}

function runRotationConfig({ rotate, pool, n, honestErrorRate, threshold, seeds, tasksPerSeed, baseSeed }) {
    const rates = emptyRates();
    // OFF: a single fixed committee, worst-case co-located (seats every colluder
    // first, then fills with honest) — no rotation, no org cap.
    const colluders = pool.filter((a) => a.malicious);
    const honest = pool.filter((a) => !a.malicious);
    const fixedCommittee = colluders.concat(honest).slice(0, n);
    for (let s = 0; s < seeds; s += 1) {
        const rng = new SeededRng(baseSeed + s * 7919);
        const counter = emptyCounter();
        for (let t = 0; t < tasksPerSeed; t += 1) {
            const taskValid = t % 2 === 0;
            const committee = rotate ? vrfSelect({ pool, n, rng }) : fixedCommittee;
            const opinions = committeeOpinions({ committee, taskValid, rng, honestErrorRate });
            const result = ma3cDecision(opinions, { threshold, n });
            score(counter, result.finalDecision, taskValid);
        }
        pushRates(rates, counter);
    }
    return rates;
}

/**
 * ON = per-task VRF rotation with org cap; OFF = fixed co-located committee.
 * `colluders` is sized so the bloc is a committee majority when permanently
 * seated (OFF) but is capped to a minority under rotation (ON).
 */
function runVrfRotationAblation({
    n = 7,
    poolSize = 21,
    colluders = 5,
    honestErrorRate = 0.1,
    threshold = DEFAULT_NORMAL_THRESHOLD,
    seeds = 200,
    tasksPerSeed = 40,
    baseSeed = 20260417
} = {}) {
    const pool = colludingPool({ poolSize, colluders });
    const common = { pool, n, honestErrorRate, threshold, seeds, tasksPerSeed, baseSeed };
    const onRates = runRotationConfig({ rotate: true, ...common });
    const offRates = runRotationConfig({ rotate: false, ...common });
    return assembleAblation({
        meta: { ablation: 'vrf-rotation', threat: 'co-located collusion', n, poolSize, colluders, orgCap: organizationLimit(n), honestErrorRate, threshold, seeds, tasksPerSeed },
        onRates,
        offRates
    });
}

// =============================================================================
// Ablation 3 — commit-reveal vs herding information cascade
// =============================================================================

/**
 * One task under either sealed (ON) or open-sequential (OFF) reveal.
 * OFF: malicious agents reveal first (loud early votes) and honest agents reveal
 * in random order; with herding probability `herding` an honest agent abandons
 * its own judgment and copies the running revealed majority. ON: every agent
 * commits independently (no observation), so herding cannot fire.
 */
function runCommitRevealTask({ open, n, maliciousCount, honestErrorRate, herding, rng, taskValid }) {
    const correct = taskValid ? 'APPROVE' : 'REJECT';
    const wrong = taskValid ? 'REJECT' : 'APPROVE';

    const honestIdx = [];
    for (let i = maliciousCount; i < n; i += 1) honestIdx.push(i);
    // shuffle honest reveal order (Fisher-Yates with the shared rng)
    for (let i = honestIdx.length - 1; i > 0; i -= 1) {
        const j = rng.int(0, i);
        [honestIdx[i], honestIdx[j]] = [honestIdx[j], honestIdx[i]];
    }

    let approve = 0;
    let reject = 0;
    const opinions = [];

    // Malicious reveal first → seed the cascade with APPROVE.
    for (let i = 0; i < maliciousCount; i += 1) {
        opinions.push({ agentId: `a-${i}`, decision: 'APPROVE', confidence: 0.9, assignedWeight: 1 });
        approve += 1;
    }
    for (const i of honestIdx) {
        const own = rng.next() < honestErrorRate ? wrong : correct;
        let decision = own;
        if (open && approve + reject > 0 && rng.next() < herding) {
            // copy the running visible majority instead of own judgment
            decision = approve > reject ? 'APPROVE' : reject > approve ? 'REJECT' : own;
        }
        if (decision === 'APPROVE') approve += 1; else reject += 1;
        opinions.push({ agentId: `a-${i}`, decision, confidence: honestConfidence(rng), assignedWeight: 1 });
    }
    return opinions;
}

function runCommitRevealConfig({ open, n, maliciousCount, honestErrorRate, herding, threshold, seeds, tasksPerSeed, baseSeed }) {
    const rates = emptyRates();
    for (let s = 0; s < seeds; s += 1) {
        const rng = new SeededRng(baseSeed + s * 7919);
        const counter = emptyCounter();
        for (let t = 0; t < tasksPerSeed; t += 1) {
            const taskValid = t % 2 === 0;
            const opinions = runCommitRevealTask({ open, n, maliciousCount, honestErrorRate, herding, rng, taskValid });
            const result = ma3cDecision(opinions, { threshold, n });
            score(counter, result.finalDecision, taskValid);
        }
        pushRates(rates, counter);
    }
    return rates;
}

/**
 * ON = sealed commit-reveal (no herding); OFF = open sequential reveal where
 * honest agents herd onto the malicious-seeded majority.
 */
function runCommitRevealAblation({
    n = 7,
    maliciousRatio = 0.2,
    honestErrorRate = 0.1,
    herding = 0.6,
    threshold = DEFAULT_NORMAL_THRESHOLD,
    seeds = 200,
    tasksPerSeed = 40,
    baseSeed = 20260417
} = {}) {
    const maliciousCount = Math.round(n * maliciousRatio);
    const common = { n, maliciousCount, honestErrorRate, herding, threshold, seeds, tasksPerSeed, baseSeed };
    const onRates = runCommitRevealConfig({ open: false, ...common });
    const offRates = runCommitRevealConfig({ open: true, ...common });
    return assembleAblation({
        meta: { ablation: 'commit-reveal', threat: 'herding cascade', n, maliciousRatio, maliciousCount, honestErrorRate, herding, threshold, seeds, tasksPerSeed },
        onRates,
        offRates
    });
}

function runAllAblations(options = {}) {
    return {
        heterogeneity: runHeterogeneityAblation(options.heterogeneity || {}),
        vrfRotation: runVrfRotationAblation(options.vrfRotation || {}),
        commitReveal: runCommitRevealAblation(options.commitReveal || {})
    };
}

module.exports = {
    runHeterogeneityAblation,
    runVrfRotationAblation,
    runCommitRevealAblation,
    runAllAblations,
    // exported for unit tests
    vrfSelect,
    honestVoteCorrelated
};
