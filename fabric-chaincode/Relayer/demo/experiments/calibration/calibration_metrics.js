/**
 * Calibration metrics for confidence signals (paper §VIII, experiment 5.6).
 *
 * Every function consumes an array of samples
 *     { p: <predicted probability of being correct, in [0,1]>, y: <1 if correct else 0> }
 * and is a pure, deterministic computation — no I/O, no randomness — so the same
 * metrics apply equally to the calibrated-simulation signals and to real
 * per-sample LLM records once a large-enough labelled set is collected.
 *
 * Metrics:
 *   ece(M)  Expected Calibration Error — Σ_b (n_b/N)·|acc_b − conf_b| over M equal-width bins.
 *   mce(M)  Maximum Calibration Error — max_b |acc_b − conf_b|.
 *   brier   Mean squared error between p and y (lower = better).
 *   auc     Area under ROC (Mann–Whitney U); probability that a correct sample is
 *           ranked above an incorrect one. 0.5 = uninformative, 1.0 = perfect ranking.
 *   reliabilityBins(M)  Per-bin {pMean, accuracy, count} for the calibration curve.
 */

function clamp01(x) {
    const v = Number(x);
    if (!Number.isFinite(v)) return 0;
    return Math.min(1, Math.max(0, v));
}

function round6(value) {
    return Number((Number(value) || 0).toFixed(6));
}

/** Equal-width reliability bins over [0,1]. Empty bins are omitted from the curve. */
function reliabilityBins(samples = [], bins = 10) {
    const M = Math.max(1, Math.floor(bins));
    const acc = Array.from({ length: M }, () => ({ pSum: 0, ySum: 0, count: 0 }));
    for (const s of samples) {
        const p = clamp01(s.p);
        const y = s.y ? 1 : 0;
        // p === 1 lands in the last bin.
        let b = Math.floor(p * M);
        if (b >= M) b = M - 1;
        acc[b].pSum += p;
        acc[b].ySum += y;
        acc[b].count += 1;
    }
    return acc
        .map((b, i) => ({
            bin: i,
            lo: round6(i / M),
            hi: round6((i + 1) / M),
            count: b.count,
            pMean: b.count ? round6(b.pSum / b.count) : null,
            accuracy: b.count ? round6(b.ySum / b.count) : null
        }))
        .filter((b) => b.count > 0);
}

function ece(samples = [], bins = 10) {
    const N = samples.length;
    if (!N) return 0;
    let sum = 0;
    for (const b of reliabilityBins(samples, bins)) {
        sum += (b.count / N) * Math.abs(b.accuracy - b.pMean);
    }
    return round6(sum);
}

function mce(samples = [], bins = 10) {
    let max = 0;
    for (const b of reliabilityBins(samples, bins)) {
        max = Math.max(max, Math.abs(b.accuracy - b.pMean));
    }
    return round6(max);
}

function brier(samples = []) {
    const N = samples.length;
    if (!N) return 0;
    let sum = 0;
    for (const s of samples) {
        const p = clamp01(s.p);
        const y = s.y ? 1 : 0;
        sum += (p - y) * (p - y);
    }
    return round6(sum / N);
}

/**
 * AUC via the Mann–Whitney U statistic with tie-aware mid-ranks:
 *   AUC = (Σ ranks of positives − n_pos(n_pos+1)/2) / (n_pos·n_neg).
 * Returns 0.5 when one class is absent (signal cannot discriminate).
 */
function auc(samples = []) {
    const pos = [];
    const neg = [];
    for (const s of samples) {
        (s.y ? pos : neg).push(clamp01(s.p));
    }
    const nPos = pos.length;
    const nNeg = neg.length;
    if (!nPos || !nNeg) return 0.5;

    const all = samples
        .map((s) => ({ p: clamp01(s.p), y: s.y ? 1 : 0 }))
        .sort((a, b) => a.p - b.p);

    // Assign mid-ranks to ties.
    let i = 0;
    let rankSumPos = 0;
    while (i < all.length) {
        let j = i;
        while (j < all.length && all[j].p === all[i].p) j += 1;
        const midRank = (i + 1 + j) / 2; // average of ranks (i+1..j), 1-based
        for (let k = i; k < j; k += 1) {
            if (all[k].y === 1) rankSumPos += midRank;
        }
        i = j;
    }
    return round6((rankSumPos - (nPos * (nPos + 1)) / 2) / (nPos * nNeg));
}

/** All metrics at once for one signal. */
function calibrationReport(samples = [], { bins = 10 } = {}) {
    const positives = samples.reduce((c, s) => c + (s.y ? 1 : 0), 0);
    return {
        n: samples.length,
        accuracy: samples.length ? round6(positives / samples.length) : 0,
        ece: ece(samples, bins),
        mce: mce(samples, bins),
        brier: brier(samples),
        auc: auc(samples),
        curve: reliabilityBins(samples, bins)
    };
}

module.exports = {
    reliabilityBins,
    ece,
    mce,
    brier,
    auc,
    calibrationReport
};
