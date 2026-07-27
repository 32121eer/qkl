#!/usr/bin/env node

/**
 * Latency / time-cost benchmark across the comparison baselines.
 *
 *   node scripts/run_latency_benchmark.js
 *   node scripts/run_latency_benchmark.js --iters=200000 --output=latency.json
 *
 * Reports per-decision aggregation compute (µs) swept over committee size, plus a
 * reminder of the end-to-end model latency (which only differs for MA3C via
 * arbitration). See demo/experiments/latency_benchmark.js and the report §2.5.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { runAggregationBenchmark, DEFAULT_METHODS } = require('../demo/experiments/latency_benchmark');

function readArg(name, fallback = null) {
    const prefix = `--${name}=`;
    const hit = process.argv.find((item) => item.startsWith(prefix));
    return hit ? hit.slice(prefix.length) : fallback;
}
function asInt(value, fallback) { const p = Number.parseInt(value, 10); return Number.isFinite(p) ? p : fallback; }
function gitCommit() { try { return execSync('git rev-parse --short HEAD', { cwd: __dirname }).toString().trim(); } catch { return 'unknown'; } }

const LABELS = {
    ma3c: 'MA3C', repWeighted: 'B3 rep-only', weightedBft: 'B4 weighted-BFT',
    equalMajority: 'B1 equal', pbft: 'B2 PBFT', singleRelay: 'B0 relay'
};

function main() {
    const iters = asInt(readArg('iters', '100000'), 100000);
    const output = readArg('output', null);

    const result = runAggregationBenchmark({ iters });

    console.log(`\n=== Per-decision aggregation compute (µs/decision, median of ${result.meta.reps} reps × ${iters} iters) ===`);
    console.table(result.rows.map((row) => {
        const out = { 'committee n': row.n };
        for (const method of DEFAULT_METHODS) out[LABELS[method]] = row[method];
        return out;
    }));
    console.log('All rules are O(n); consensus-layer compute is sub-microsecond and never the bottleneck.');
    console.log('\nEnd-to-end model latency (paper §VI): baselines = 8.0s (optimistic, no escalation);');
    console.log('MA3C = 18.9s cold-start / 9.6s matured (arbitration premium on escalated tasks only).');

    if (output) {
        const payload = { meta: { gitCommit: gitCommit(), generatedAt: new Date().toISOString(), iters }, ...result };
        const outputPath = path.resolve(process.cwd(), output);
        fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
        console.log(`\nSaved JSON report to ${outputPath}`);
    }
}

main();
