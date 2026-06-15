/**
 * Lightweight statistics for paired method comparison.
 *
 * The comparison is paired by construction: every method is evaluated on the
 * SAME per-seed task stream, so we compare per-seed metric samples pairwise.
 * We report mean ± 95% CI, a paired bootstrap CI on the difference, a two-sided
 * sign test p-value, and Cohen's d (paired). No external dependencies.
 */

function round6(value) {
    return Number((Number(value) || 0).toFixed(6));
}

function mean(values = []) {
    if (!values.length) return 0;
    return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function variance(values = []) {
    if (values.length < 2) return 0;
    const m = mean(values);
    return values.reduce((sum, v) => sum + (v - m) ** 2, 0) / (values.length - 1);
}

function std(values = []) {
    return Math.sqrt(variance(values));
}

/** Normal-approx 95% CI of the mean (n≥30 makes this safe). */
function ci95(values = []) {
    if (values.length < 2) {
        const m = mean(values);
        return { mean: round6(m), lower: round6(m), upper: round6(m), n: values.length };
    }
    const m = mean(values);
    const half = 1.96 * (std(values) / Math.sqrt(values.length));
    return {
        mean: round6(m),
        lower: round6(m - half),
        upper: round6(m + half),
        halfWidth: round6(half),
        n: values.length
    };
}

function summarize(values = []) {
    const c = ci95(values);
    return { ...c, std: round6(std(values)) };
}

// Deterministic RNG so bootstrap CIs are reproducible.
function seededRng(seed = 12345) {
    let state = (Number(seed) >>> 0) || 1;
    return () => {
        state = (1664525 * state + 1013904223) >>> 0;
        return state / 0x100000000;
    };
}

/**
 * Paired comparison of method A vs method B on aligned per-seed samples
 * (treatmentSamples[i] and baselineSamples[i] come from the SAME seed).
 *
 * Returns the mean difference (A−B), a bootstrap 95% CI on that difference,
 * a two-sided sign-test p-value, and paired Cohen's d.
 */
function pairedComparison(treatmentSamples = [], baselineSamples = [], { bootstrap = 2000, seed = 12345 } = {}) {
    const n = Math.min(treatmentSamples.length, baselineSamples.length);
    if (n === 0) {
        return null;
    }
    const diffs = [];
    let positives = 0;
    let negatives = 0;
    for (let i = 0; i < n; i += 1) {
        const d = treatmentSamples[i] - baselineSamples[i];
        diffs.push(d);
        if (d > 0) positives += 1;
        else if (d < 0) negatives += 1;
    }
    const meanDiff = mean(diffs);
    const sdDiff = std(diffs);

    // Bootstrap CI on the mean difference.
    const rng = seededRng(seed);
    const bootMeans = [];
    for (let b = 0; b < bootstrap; b += 1) {
        let acc = 0;
        for (let i = 0; i < n; i += 1) {
            acc += diffs[Math.floor(rng() * n)];
        }
        bootMeans.push(acc / n);
    }
    bootMeans.sort((a, b) => a - b);
    const lo = bootMeans[Math.floor(0.025 * bootMeans.length)];
    const hi = bootMeans[Math.min(bootMeans.length - 1, Math.floor(0.975 * bootMeans.length))];

    return {
        n,
        meanTreatment: round6(mean(treatmentSamples)),
        meanBaseline: round6(mean(baselineSamples)),
        meanDiff: round6(meanDiff),
        diffCi95: { lower: round6(lo), upper: round6(hi) },
        ciExcludesZero: lo > 0 || hi < 0,
        cohensD: round6(sdDiff > 0 ? meanDiff / sdDiff : 0),
        sign: {
            wins: positives,
            losses: negatives,
            ties: n - positives - negatives,
            pValue: round6(signTestPValue(positives, negatives))
        }
    };
}

/**
 * Two-sided exact sign test p-value via binomial tail.
 * H0: P(A>B) = P(A<B) = 0.5 among non-tied pairs.
 */
function signTestPValue(wins, losses) {
    const m = wins + losses;
    if (m === 0) return 1;
    const k = Math.min(wins, losses);
    let cumulative = 0;
    for (let i = 0; i <= k; i += 1) {
        cumulative += binomialPmf(m, i, 0.5);
    }
    return Math.min(1, 2 * cumulative);
}

function binomialPmf(n, k, p) {
    return Math.exp(logChoose(n, k) + k * Math.log(p) + (n - k) * Math.log(1 - p));
}

function logChoose(n, k) {
    return logFactorial(n) - logFactorial(k) - logFactorial(n - k);
}

function logFactorial(n) {
    let acc = 0;
    for (let i = 2; i <= n; i += 1) {
        acc += Math.log(i);
    }
    return acc;
}

module.exports = {
    mean,
    variance,
    std,
    ci95,
    summarize,
    pairedComparison,
    signTestPValue,
    seededRng
};
