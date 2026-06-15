#!/usr/bin/env node

/**
 * Strategic-adversary (scenario 3) and collusion (scenario 4) experiments,
 * driven by the real ReputationStore / BehaviorAnalyzer detection code.
 *
 *   node scripts/run_adversary_experiments.js
 *   node scripts/run_adversary_experiments.js --trials=500 --output=adv.json
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { runStrategicAdversary, runCollusionSweep } = require('../demo/experiments/adversary_experiment');

function readArg(name, fallback = null) {
    const prefix = `--${name}=`;
    const hit = process.argv.find((item) => item.startsWith(prefix));
    return hit ? hit.slice(prefix.length) : fallback;
}
function asInt(value, fallback) { const p = Number.parseInt(value, 10); return Number.isFinite(p) ? p : fallback; }
function gitCommit() { try { return execSync('git rev-parse --short HEAD', { cwd: __dirname }).toString().trim(); } catch { return 'unknown'; } }

function main() {
    const trials = asInt(readArg('trials', '200'), 200);
    const n = asInt(readArg('n', '7'), 7);
    const output = readArg('output', null);

    const strategic = runStrategicAdversary({ n, flipAt: 50, observeTasks: 40, trials });
    const collusion = runCollusionSweep({ n, colluderCount: 2, trials, disputedCounts: [10, 20, 30, 50] });

    console.log('\n=== Scenario 3: strategic adversary (honest 50 tasks → always-approve attack) ===');
    console.log(`detection latency (tasks after flip), n=${n}, ${trials} trials:`);
    console.table([
        { signal: 'observation period (variance)', detectionRate: strategic.observationPeriod.detectionRate, meanTasks: strategic.observationPeriod.tasksToDetect.mean },
        { signal: 'weight < honest median', detectionRate: strategic.weightBelowHonestMedian.detectionRate, meanTasks: strategic.weightBelowHonestMedian.tasksToDetect.mean }
    ]);

    console.log('\n=== Scenario 4: collusion (2 cross-org agents vote in lockstep) ===');
    console.log('real BehaviorAnalyzer, vote-similarity ≥ 0.9 over disputed tasks:');
    console.table(collusion.map((r) => ({
        taskStreamLength: r.meta.disputedTasks,
        trueDetectionRate: r.trueDetectionRate,
        falsePositiveRate: r.falsePositiveRate
    })));

    if (output) {
        const result = { meta: { gitCommit: gitCommit(), generatedAt: new Date().toISOString(), trials, n }, strategic, collusion };
        const outputPath = path.resolve(process.cwd(), output);
        fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
        console.log(`\nSaved JSON report to ${outputPath}`);
    }
}

main();
