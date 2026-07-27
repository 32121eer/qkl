#!/usr/bin/env node

/**
 * Run the three P1 gap-closing experiments and archive the JSON:
 *   (G1) per-phase latency (real off-chain compute + measured on-chain anchor)
 *   (G2) false-reject (always_reject) attack sweep
 *   (G3) full baseline set incl. B3 reputation-only and B6 confidence-only
 *
 *   node scripts/run_p1_gap_experiments.js
 *   node scripts/run_p1_gap_experiments.js --trials=30 --output=demo/experiments/p1_gap_results.json
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { runPhaseLatency, runAttackSweep } = require('../demo/experiments/p1_gap_experiments');

function readArg(name, fallback = null) {
    const prefix = `--${name}=`;
    const hit = process.argv.find((item) => item.startsWith(prefix));
    return hit ? hit.slice(prefix.length) : fallback;
}
function asInt(value, fallback) { const p = Number.parseInt(value, 10); return Number.isFinite(p) ? p : fallback; }
function pct(v) { return `${(Number(v) * 100).toFixed(1)}%`; }
function gitCommit() { try { return execSync('git rev-parse --short HEAD', { cwd: __dirname }).toString().trim(); } catch { return 'unknown'; } }

function printSweep(title, report) {
    console.log(`\n=== ${title} (behavior=${report.meta.behavior}, n=${report.meta.n}, ${report.meta.trials}×${report.meta.tasksPerTrial}) ===`);
    for (const run of report.sweep) {
        console.log(`\n-- malicious=${pct(run.meta.maliciousRatio)} --`);
        console.table(Object.entries(run.methods).map(([k, m]) => ({
            method: k,
            correctness: pct(m.correctness.mean),
            falseAccept: pct(m.falseAccept.mean),
            falseReject: pct(m.falseReject.mean),
            escalation: pct(m.escalationRate.mean)
        })));
    }
}

async function main() {
    const trials = asInt(readArg('trials', '30'), 30);
    const tasksPerTrial = asInt(readArg('tasks', '10'), 10);
    const n = asInt(readArg('n', '5'), 5);
    const output = readArg('output', 'demo/experiments/p1_gap_results.json');

    const result = { meta: { gitCommit: gitCommit(), generatedAt: new Date().toISOString() } };

    console.log('=== (G1) Per-phase latency (real off-chain compute + measured on-chain anchor) ===');
    result.phaseLatency = await runPhaseLatency({ n });
    console.log(JSON.stringify(result.phaseLatency, null, 2));

    result.falseReject = await runAttackSweep({ behavior: 'always_reject', n, trials, tasksPerTrial });
    printSweep('(G2) False-reject attack sweep', result.falseReject);

    result.falseAcceptFullBaselines = await runAttackSweep({ behavior: 'always_approve', n, trials, tasksPerTrial });
    printSweep('(G3) False-accept sweep — full baseline set (incl. B3, B6)', result.falseAcceptFullBaselines);

    const outputPath = path.resolve(process.cwd(), output);
    fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    console.log(`\nSaved JSON report to ${outputPath}`);
}

main().catch((error) => { console.error('P1 gap experiments failed:', error); process.exit(1); });
