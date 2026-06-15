#!/usr/bin/env node

/**
 * Run the REAL-agent Byzantine-robustness experiment: actual VerifierAgent code
 * produces every opinion; MA3C (with real arbiter agents) is compared head-to-head
 * against baselines B0–B2 on identical real opinions.
 *
 *   node scripts/run_real_agent_experiment.js
 *   node scripts/run_real_agent_experiment.js --n=5 --malicious=0.4 --trials=40 --behavior=always_approve
 *   node scripts/run_real_agent_experiment.js --sweep --output=real.json
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { runRealAgentByzantine, runRealAgentSweep } = require('../demo/experiments/real_agent_experiment');

function readArg(name, fallback = null) {
    const prefix = `--${name}=`;
    const hit = process.argv.find((item) => item.startsWith(prefix));
    return hit ? hit.slice(prefix.length) : fallback;
}
function hasFlag(name) { return process.argv.includes(`--${name}`); }
function asInt(value, fallback) { const p = Number.parseInt(value, 10); return Number.isFinite(p) ? p : fallback; }
function pct(v) { return `${(Number(v) * 100).toFixed(1)}%`; }
function gitCommit() { try { return execSync('git rev-parse --short HEAD', { cwd: __dirname }).toString().trim(); } catch { return 'unknown'; } }

function printReport(report) {
    console.log(`\n[real-agent]  n=${report.meta.n} malicious=${pct(report.meta.maliciousRatio)} behavior=${report.meta.behavior} trials=${report.meta.trials}×${report.meta.tasksPerTrial} tasks`);
    console.table(Object.entries(report.methods).map(([key, m]) => ({
        method: key,
        label: m.label,
        correctness: `${pct(m.correctness.mean)} ±${pct(m.correctness.halfWidth || 0)}`,
        falseAccept: pct(m.falseAccept.mean),
        falseReject: pct(m.falseReject.mean),
        escalation: pct(m.escalationRate.mean)
    })));
    console.log('[MA3C vs baselines — paired; Δ>0 & CI≠0 & signP<0.01 ⇒ MA3C better]');
    console.table(Object.entries(report.comparisons).map(([key, c]) => ({
        comparison: key,
        'Δcorrect': c.correctness ? `${(c.correctness.meanDiff * 100).toFixed(1)}pp` : '—',
        'CI95(Δ)': c.correctness ? `[${(c.correctness.diffCi95.lower * 100).toFixed(1)}, ${(c.correctness.diffCi95.upper * 100).toFixed(1)}]pp` : '—',
        'sig': c.correctness ? (c.correctness.ciExcludesZero ? 'YES' : 'no') : '—',
        'signP': c.correctness ? c.correctness.sign.pValue : '—',
        'falseAcc↓': c.falseAcceptReduction ? `${(c.falseAcceptReduction.meanDiff * 100).toFixed(1)}pp` : '—'
    })));
}

async function main() {
    const n = asInt(readArg('n', '5'), 5);
    const malicious = Number(readArg('malicious', '0.4'));
    const trials = asInt(readArg('trials', '30'), 30);
    const tasksPerTrial = asInt(readArg('tasks', '10'), 10);
    const behavior = readArg('behavior', 'always_approve');
    const output = readArg('output', null);

    const result = { meta: { gitCommit: gitCommit(), generatedAt: new Date().toISOString() } };

    if (hasFlag('sweep')) {
        const sweep = await runRealAgentSweep({ n, trials, tasksPerTrial, behavior, maliciousRatios: [0, 0.2, 0.4, 0.6] });
        result.sweep = sweep;
        console.log('=== REAL-agent Byzantine tolerance sweep (always_approve false-accept attack) ===');
        for (const report of sweep) printReport(report);
    } else {
        const report = await runRealAgentByzantine({ n, maliciousRatio: malicious, trials, tasksPerTrial, behavior });
        result.report = report;
        printReport(report);
    }

    if (output) {
        const outputPath = path.resolve(process.cwd(), output);
        fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
        console.log(`\nSaved JSON report to ${outputPath}`);
    }
}

main().catch((error) => { console.error('Real-agent experiment failed:', error); process.exit(1); });
