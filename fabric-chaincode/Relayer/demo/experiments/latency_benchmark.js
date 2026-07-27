/**
 * Latency / time-cost benchmark for the comparison baselines.
 *
 * Two cost dimensions are reported:
 *
 *  1. AGGREGATION COMPUTE — wall-clock time to run one decision rule over a
 *     committee's opinion set (micro-benchmark, µs/decision), swept over
 *     committee size n. Isolates the on-path consensus-layer compute overhead of
 *     each rule; all rules are O(n), so this shows the layer is never the
 *     bottleneck (network / chain confirmation dominates).
 *
 *  2. END-TO-END MODEL LATENCY — the paper §VI latency model: optimistic 8s,
 *     arbitration 21s, timeout 90s. Baselines have no escalation path → always
 *     optimistic; MA3C pays the arbitration premium only on escalated tasks, so
 *     its mean latency is taken from the comparative runs (`avgLatencyMs`).
 *
 * See docs/xn/对比与消融实验报告.md §2.5.
 */

const { performance } = require('perf_hooks');
const { STRATEGIES } = require('./baselines/decision_strategies');
const { SeededRng, buildAgentPopulation } = require('./ma3c_wbft_simulator');
const { generateOpinions } = require('./comparative_runner');
const { DEFAULT_NORMAL_THRESHOLD } = require('../negotiation/protocol_config');

const DEFAULT_METHODS = ['ma3c', 'repWeighted', 'weightedBft', 'equalMajority', 'pbft', 'singleRelay'];

/** A representative settled-round opinion set (20% malicious, honest error 0.12). */
function buildOpinionSet(n, rng) {
    const agents = buildAgentPopulation({ n, maliciousRatio: 0.2, rng });
    return generateOpinions({ agents, taskValid: true, rng, honestErrorRate: 0.12 });
}

/** Median µs/decision over `iters` calls (after a warmup), repeated `reps` times. */
function benchStrategy(method, opinions, cfg, iters) {
    const { decide } = STRATEGIES[method];
    for (let i = 0; i < 2000; i += 1) decide(opinions, cfg); // warmup / JIT
    const t0 = performance.now();
    for (let i = 0; i < iters; i += 1) decide(opinions, cfg);
    const t1 = performance.now();
    return ((t1 - t0) / iters) * 1000; // µs per decision
}

function median(values) {
    const s = values.slice().sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function runAggregationBenchmark({
    methods = DEFAULT_METHODS,
    sizes = [5, 15, 31, 63],
    iters = 100000,
    reps = 5,
    threshold = DEFAULT_NORMAL_THRESHOLD,
    seed = 20260417
} = {}) {
    const rows = [];
    for (const n of sizes) {
        const rng = new SeededRng(seed + n);
        const opinions = buildOpinionSet(n, rng);
        const cfg = { threshold, n, relayIndex: 0 };
        const row = { n };
        for (const method of methods) {
            const samples = [];
            for (let r = 0; r < reps; r += 1) {
                samples.push(benchStrategy(method, opinions, cfg, iters));
            }
            row[method] = Number(median(samples).toFixed(4)); // µs/decision
        }
        rows.push(row);
    }
    return { meta: { methods, sizes, iters, reps }, rows };
}

module.exports = {
    DEFAULT_METHODS,
    buildOpinionSet,
    runAggregationBenchmark
};
