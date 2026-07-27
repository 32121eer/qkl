/**
 * Pluggable decision strategies for head-to-head comparison.
 *
 * Every strategy consumes the SAME per-task opinion set and differs ONLY in the
 * aggregation rule, so any correctness gap is attributable to the rule itself
 * (paired-by-construction comparison). See docs/xn/验证方案-方法对比评估.md.
 *
 * Opinion shape (produced by ma3c_wbft_simulator.buildOpinion):
 *   { agentId, decision: 'APPROVE'|'REJECT'|'QUESTION', confidence, assignedWeight, latencyMs }
 *
 * Result shape:
 *   { finalDecision: 'COMMIT'|'REJECT'|'OBSERVE', acceptRatio, ... }
 *
 * COMMIT  ← evidence judged valid
 * REJECT  ← evidence judged invalid
 * OBSERVE ← no quorum / abstention (counts as "no result" → not correct)
 */

const { DEFAULT_NORMAL_THRESHOLD } = require('../../negotiation/protocol_config');

function round6(value) {
    return Number((Number(value) || 0).toFixed(6));
}

function tally(opinions = []) {
    let approve = 0;
    let reject = 0;
    let question = 0;
    for (const item of opinions) {
        const decision = String(item.decision || 'QUESTION').toUpperCase();
        if (decision === 'APPROVE') approve += 1;
        else if (decision === 'REJECT') reject += 1;
        else question += 1;
    }
    return { approve, reject, question };
}

/**
 * Generic weighted-ratio rule. `weightOf(opinion)` selects the per-vote weight.
 * Shared by MA3C (rep×conf) and the reputation-only ablation (rep).
 */
function weightedRatioDecision(opinions, threshold, weightOf) {
    let approveWeight = 0;
    let rejectWeight = 0;
    let questionWeight = 0;
    for (const item of opinions) {
        const decision = String(item.decision || 'QUESTION').toUpperCase();
        const w = Math.max(0, Number(weightOf(item)) || 0);
        if (decision === 'APPROVE') approveWeight += w;
        else if (decision === 'REJECT') rejectWeight += w;
        else questionWeight += w;
    }
    const decisive = approveWeight + rejectWeight;
    const acceptRatio = decisive > 0 ? approveWeight / decisive : 0;
    const rejectRatio = decisive > 0 ? rejectWeight / decisive : 0;

    let finalDecision = 'OBSERVE';
    if (acceptRatio >= threshold) finalDecision = 'COMMIT';
    else if (rejectRatio >= threshold) finalDecision = 'REJECT';

    return {
        finalDecision,
        approveWeight: round6(approveWeight),
        rejectWeight: round6(rejectWeight),
        questionWeight: round6(questionWeight),
        acceptRatio: round6(acceptRatio),
        rejectRatio: round6(rejectRatio)
    };
}

/**
 * MA3C (proposed): vote weight = reputation × self-reported confidence,
 * decided against the risk-adaptive threshold θ.
 */
function ma3cDecision(opinions, cfg = {}) {
    const threshold = Number(cfg.threshold) || DEFAULT_NORMAL_THRESHOLD;
    return weightedRatioDecision(
        opinions,
        threshold,
        (item) => (Number(item.assignedWeight) || 0) * (Number(item.confidence) || 0)
    );
}

/**
 * B3 — reputation-weighted, NO confidence (ablation isolating confidence's contribution).
 */
function repWeightedDecision(opinions, cfg = {}) {
    const threshold = Number(cfg.threshold) || DEFAULT_NORMAL_THRESHOLD;
    return weightedRatioDecision(
        opinions,
        threshold,
        (item) => Number(item.assignedWeight) || 0
    );
}

/**
 * B1 — equal-weight majority. One vote per agent, abstentions (QUESTION) do not
 * count toward a side. Requires a strict majority of the FULL committee, so
 * abstentions make a majority harder to reach (standard notary-committee rule).
 */
function equalMajorityDecision(opinions, cfg = {}) {
    const n = Number(cfg.n) || opinions.length;
    const { approve, reject, question } = tally(opinions);
    const majority = Math.floor(n / 2) + 1;

    let finalDecision = 'OBSERVE';
    if (approve >= majority) finalDecision = 'COMMIT';
    else if (reject >= majority) finalDecision = 'REJECT';

    const decisive = approve + reject;
    return {
        finalDecision,
        approveVotes: approve,
        rejectVotes: reject,
        questionVotes: question,
        requiredVotes: majority,
        acceptRatio: round6(decisive > 0 ? approve / decisive : 0)
    };
}

/**
 * B2 — PBFT-style quorum. Needs 2f+1 agreeing votes where f = ⌊(n−1)/3⌋.
 * If neither side reaches quorum the task cannot finalize → OBSERVE
 * (in a real PBFT relay this triggers view-change / arbitration).
 */
function pbftDecision(opinions, cfg = {}) {
    const n = Number(cfg.n) || opinions.length;
    const f = Math.floor((n - 1) / 3);
    const quorum = 2 * f + 1;
    const { approve, reject, question } = tally(opinions);

    let finalDecision = 'OBSERVE';
    if (approve >= quorum) finalDecision = 'COMMIT';
    else if (reject >= quorum) finalDecision = 'REJECT';

    const decisive = approve + reject;
    return {
        finalDecision,
        approveVotes: approve,
        rejectVotes: reject,
        questionVotes: question,
        faultBudget: f,
        requiredVotes: quorum,
        acceptRatio: round6(decisive > 0 ? approve / decisive : 0)
    };
}

/**
 * B4 — weighted (stake/reputation) BFT. A reputation-weighted Byzantine quorum:
 * a side finalizes only if its weight reaches a super-majority `bftQuorum`
 * (default 2/3) of the TOTAL committee weight — abstentions (QUESTION) and
 * non-revealing agents count against the quorum, exactly like a stake-weighted
 * BFT (e.g. Tendermint) tolerating < ⅓ Byzantine weight. Distinct from B2 PBFT
 * (one-agent-one-vote 2f+1) by weighting votes, and from MA3C by using NO
 * confidence weighting, a fixed (non-risk-adaptive) quorum, and NO arbitration
 * escalation. Safer than simple majority (a malicious bloc must control > ⅔ of
 * weight to force acceptance) but it trades liveness: under disagreement neither
 * side reaches ⅔ → OBSERVE (no result).
 */
function weightedBftDecision(opinions, cfg = {}) {
    const quorum = Number.isFinite(cfg.bftQuorum) ? cfg.bftQuorum : 2 / 3;
    let approveWeight = 0;
    let rejectWeight = 0;
    let totalWeight = 0;
    for (const item of opinions) {
        const w = Math.max(0, Number(item.assignedWeight) || 0);
        totalWeight += w;
        const decision = String(item.decision || 'QUESTION').toUpperCase();
        if (decision === 'APPROVE') approveWeight += w;
        else if (decision === 'REJECT') rejectWeight += w;
    }

    let finalDecision = 'OBSERVE';
    if (totalWeight > 0) {
        if (approveWeight >= quorum * totalWeight) finalDecision = 'COMMIT';
        else if (rejectWeight >= quorum * totalWeight) finalDecision = 'REJECT';
    }

    const decisive = approveWeight + rejectWeight;
    return {
        finalDecision,
        approveWeight: round6(approveWeight),
        rejectWeight: round6(rejectWeight),
        totalWeight: round6(totalWeight),
        quorumWeight: round6(quorum * totalWeight),
        acceptRatio: round6(decisive > 0 ? approveWeight / decisive : 0)
    };
}

/**
 * B5 — static notary committee. A fixed M-of-N notary set: the result finalizes
 * only when one side gathers ≥ `notaryQuorum` agreeing signatures (default simple
 * majority), exactly like a classic threshold-signature notary bridge. The
 * decision rule equals equal-weight majority (one notary, one vote, no
 * reputation/confidence); what makes it a DISTINCT baseline is selection-time:
 * the committee is FIXED across tasks (no VRF rotation, no organization
 * diversity constraint), so it is the natural foil for the decentralization /
 * concentration experiment (a fixed bloc can permanently dominate). Downstream
 * runners read `staticCommittee: true` to pin the committee instead of rotating.
 */
function staticNotaryDecision(opinions, cfg = {}) {
    const n = Number(cfg.n) || opinions.length;
    const { approve, reject, question } = tally(opinions);
    const quorum = Number.isFinite(cfg.notaryQuorum)
        ? cfg.notaryQuorum
        : Math.floor(n / 2) + 1;

    let finalDecision = 'OBSERVE';
    if (approve >= quorum) finalDecision = 'COMMIT';
    else if (reject >= quorum) finalDecision = 'REJECT';

    const decisive = approve + reject;
    return {
        finalDecision,
        approveVotes: approve,
        rejectVotes: reject,
        questionVotes: question,
        requiredVotes: quorum,
        acceptRatio: round6(decisive > 0 ? approve / decisive : 0)
    };
}

/**
 * B6 — confidence-only weighted voting. Vote weight = self-reported confidence,
 * with NO reputation (mirror of B3 reputation-only, isolating the other factor).
 * Decided against the same risk-adaptive threshold θ. Exposes the failure mode
 * the proposed rep×conf guards against: a malicious agent that simply reports
 * confidence = 1.0 gains maximal weight when reputation is ignored.
 */
function confWeightedDecision(opinions, cfg = {}) {
    const threshold = Number(cfg.threshold) || DEFAULT_NORMAL_THRESHOLD;
    return weightedRatioDecision(
        opinions,
        threshold,
        (item) => Number(item.confidence) || 0
    );
}

/**
 * B7 — CP-WBFT adapted (Zheng et al., AAAI-26, ref [2]). A confidence-probed
 * weighted Byzantine quorum: vote weight = confidence (the "confidence probe"),
 * and a side finalizes only if its confidence-weight reaches a super-majority
 * `bftQuorum` (default 2/3) of the TOTAL confidence-weight — abstentions and
 * non-revealers count against the quorum, tolerating < ⅓ Byzantine
 * confidence-weight. Adapted to our setting it differs from MA3C by using
 * confidence WITHOUT reputation, a fixed (non-risk-adaptive) quorum, and NO
 * arbitration escalation; differs from B4 weighted-BFT by weighting on
 * confidence rather than reputation. Like all BFT-quorum rules it trades
 * liveness: under disagreement neither side reaches ⅔ → OBSERVE.
 */
function cpwbftDecision(opinions, cfg = {}) {
    const quorum = Number.isFinite(cfg.bftQuorum) ? cfg.bftQuorum : 2 / 3;
    let approveWeight = 0;
    let rejectWeight = 0;
    let totalWeight = 0;
    for (const item of opinions) {
        const w = Math.max(0, Number(item.confidence) || 0);
        totalWeight += w;
        const decision = String(item.decision || 'QUESTION').toUpperCase();
        if (decision === 'APPROVE') approveWeight += w;
        else if (decision === 'REJECT') rejectWeight += w;
    }

    let finalDecision = 'OBSERVE';
    if (totalWeight > 0) {
        if (approveWeight >= quorum * totalWeight) finalDecision = 'COMMIT';
        else if (rejectWeight >= quorum * totalWeight) finalDecision = 'REJECT';
    }

    const decisive = approveWeight + rejectWeight;
    return {
        finalDecision,
        approveWeight: round6(approveWeight),
        rejectWeight: round6(rejectWeight),
        totalWeight: round6(totalWeight),
        quorumWeight: round6(quorum * totalWeight),
        acceptRatio: round6(decisive > 0 ? approveWeight / decisive : 0)
    };
}

/**
 * B0 — single relay (no consensus). One pre-selected agent's judgment is the
 * result. cfg.relayIndex is chosen by the caller's shared RNG so the pick is
 * identical across the comparison (paired). QUESTION → OBSERVE.
 */
function singleRelayDecision(opinions, cfg = {}) {
    if (!opinions.length) {
        return { finalDecision: 'OBSERVE', relayAgentId: null, acceptRatio: 0 };
    }
    const index = Number.isInteger(cfg.relayIndex)
        ? Math.min(opinions.length - 1, Math.max(0, cfg.relayIndex))
        : 0;
    const chosen = opinions[index];
    const decision = String(chosen.decision || 'QUESTION').toUpperCase();

    let finalDecision = 'OBSERVE';
    if (decision === 'APPROVE') finalDecision = 'COMMIT';
    else if (decision === 'REJECT') finalDecision = 'REJECT';

    return {
        finalDecision,
        relayAgentId: chosen.agentId,
        acceptRatio: decision === 'APPROVE' ? 1 : 0
    };
}

const STRATEGIES = {
    // usesArbitration: OBSERVE escalates to the Phase-4 arbitration committee
    // (MA3C-only protocol feature; baselines have no escalation path).
    ma3c: { label: 'MA3C (rep×conf)', decide: ma3cDecision, usesReputation: true, usesArbitration: true },
    repWeighted: { label: 'B3 reputation-only', decide: repWeightedDecision, usesReputation: true, usesArbitration: false },
    weightedBft: { label: 'B4 weighted BFT (≥⅔ weight)', decide: weightedBftDecision, usesReputation: true, usesArbitration: false },
    equalMajority: { label: 'B1 equal majority', decide: equalMajorityDecision, usesReputation: false, usesArbitration: false },
    pbft: { label: 'B2 PBFT 2f+1', decide: pbftDecision, usesReputation: false, usesArbitration: false },
    staticNotary: { label: 'B5 static notary (M-of-N, fixed)', decide: staticNotaryDecision, usesReputation: false, usesArbitration: false, staticCommittee: true },
    confWeighted: { label: 'B6 confidence-only', decide: confWeightedDecision, usesReputation: false, usesArbitration: false },
    cpwbft: { label: 'B7 CP-WBFT adapted (≥⅔ conf-weight)', decide: cpwbftDecision, usesReputation: false, usesArbitration: false },
    singleRelay: { label: 'B0 single relay', decide: singleRelayDecision, usesReputation: false, usesArbitration: false }
};

/**
 * Whether a final decision matches ground truth.
 * OBSERVE (no quorum) is never "correct" — a verification that cannot finalize
 * delivered no usable result.
 */
function isCorrect(finalDecision, taskValid) {
    return (taskValid && finalDecision === 'COMMIT') || (!taskValid && finalDecision === 'REJECT');
}

function isFalseAccept(finalDecision, taskValid) {
    return !taskValid && finalDecision === 'COMMIT';
}

function isFalseReject(finalDecision, taskValid) {
    return taskValid && finalDecision === 'REJECT';
}

module.exports = {
    STRATEGIES,
    ma3cDecision,
    repWeightedDecision,
    weightedBftDecision,
    equalMajorityDecision,
    pbftDecision,
    staticNotaryDecision,
    confWeightedDecision,
    cpwbftDecision,
    singleRelayDecision,
    weightedRatioDecision,
    tally,
    isCorrect,
    isFalseAccept,
    isFalseReject
};
