#!/usr/bin/env node

/**
 * Runs the four P0 experiments (throughput, silence attack, parameter sensitivity,
 * incentive compatibility) on the real agent / reputation components.
 *
 *   node scripts/run_p0_experiments.js
 *   node scripts/run_p0_experiments.js --trials=60 --output=p0.json
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const {
    runThroughput,
    runSilenceAttack,
    runParameterSensitivity,
    runIncentiveCompatibility,
    STRATEGIES
} = require('../demo/experiments/p0_experiments');
const { runDecisionComparison } = require('../demo/experiments/comparative_runner');

function readArg(name, fallback = null) {
    const prefix = `--${name}=`;
    const hit = process.argv.find((item) => item.startsWith(prefix));
    return hit ? hit.slice(prefix.length) : fallback;
}
function asInt(value, fallback) { const p = Number.parseInt(value, 10); return Number.isFinite(p) ? p : fallback; }
function pct(v) { return `${(Number(v) * 100).toFixed(1)}%`; }
function gitCommit() { try { return execSync('git rev-parse --short HEAD', { cwd: __dirname }).toString().trim(); } catch { return 'unknown'; } }

async function main() {
    const trials = asInt(readArg('trials', '40'), 40);
    const output = readArg('output', null);
    const result = { meta: { gitCommit: gitCommit(), generatedAt: new Date().toISOString(), trials } };

    console.log('\n=== Scenario 1: throughput & concurrency (real verification-layer compute; E2E modeled) ===');
    const tp = await runThroughput({ poolSizes: [10, 20, 30], lMax: 3, n: 5, tasksPerPool: 400 });
    result.throughput = tp;
    console.table(tp.rows);

    console.log('\n=== Scenario 5: silence attack (commit, withhold reveal) ===');
    const sil = await runSilenceAttack({ n: 7, silentRatios: [0, 0.14, 0.28, 0.43], tasksPerTrial: 40, trials });
    result.silence = sil;
    console.table(sil.results.map((r) => ({
        silentRatio: pct(r.silentRatio),
        silentCount: r.silentCount,
        finalizeRate: pct(r.finalizeRate.mean),
        escalation: pct(r.escalationRate.mean),
        correctness: pct(r.correctness.mean),
        silentAgentRep: r.silentAgentFinalReputation ? r.silentAgentFinalReputation.mean.toFixed(2) : '—'
    })));

    console.log('\n=== Parameter sensitivity (headline robustness; MA3C vs equal at 40% Byzantine) ===');
    const sen = runParameterSensitivity({ runDecisionComparison, seeds: 120, tasksPerSeed: 16 });
    result.sensitivity = sen;
    console.log('[sweep θ]'); console.table(sen.theta);
    console.log('[sweep honest error rate]'); console.table(sen.honestErrorRate);

    console.log('\n=== Theorems 1–2: incentive compatibility (per-strategy long-run payoff) ===');
    const inc = runIncentiveCompatibility({ n: 8, tasksPerTrial: 300, trials: Math.max(40, trials) });
    result.incentive = inc;
    console.table(STRATEGIES.map((s) => ({
        strategy: s,
        cumulativePayoff: inc.strategies[s].cumulativePayoff.mean.toFixed(2),
        finalReputation: inc.strategies[s].finalReputation.mean.toFixed(2)
    })));
    console.log(`honest strategy strictly dominates all others: ${inc.strategies._honestDominates}`);

    if (output) {
        const outputPath = path.resolve(process.cwd(), output);
        fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
        console.log(`\nSaved JSON report to ${outputPath}`);
    }
}

main().catch((error) => { console.error('P0 experiments failed:', error); process.exit(1); });
