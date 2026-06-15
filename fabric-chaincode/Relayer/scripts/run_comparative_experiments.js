#!/usr/bin/env node

/**
 * Runs the MA3C vs baselines (B0–B3) head-to-head comparison and prints
 * correctness/falseAccept tables plus paired-significance verdicts.
 *
 * Examples:
 *   node scripts/run_comparative_experiments.js
 *   node scripts/run_comparative_experiments.js --n=5 --seeds=300 --output=cmp.json
 *   node scripts/run_comparative_experiments.js --sweep
 *
 * Reproducibility: every run is fully determined by --seed; the resolved options,
 * git commit and raw results are written when --output is given.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const {
    runDecisionComparison,
    runSequentialComparison,
    runToleranceSweep,
    loadCalibration
} = require('../demo/experiments/comparative_runner');

function readArg(name, fallback = null) {
    const prefix = `--${name}=`;
    const hit = process.argv.find((item) => item.startsWith(prefix));
    return hit ? hit.slice(prefix.length) : fallback;
}

function hasFlag(name) {
    return process.argv.includes(`--${name}`);
}

function asInt(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function gitCommit() {
    try {
        return execSync('git rev-parse --short HEAD', { cwd: __dirname }).toString().trim();
    } catch {
        return 'unknown';
    }
}

function pct(value) {
    return `${(Number(value) * 100).toFixed(1)}%`;
}

function printMethodTable(title, report) {
    console.log(`\n[${title}]  n=${report.meta.n} malicious=${pct(report.meta.maliciousRatio)} θ=${report.meta.threshold} seeds=${report.meta.seeds}`);
    const rows = Object.entries(report.methods).map(([key, m]) => ({
        method: key,
        label: m.label,
        correctness: `${pct(m.correctness.mean)} ±${pct(m.correctness.halfWidth || 0)}`,
        falseAccept: pct(m.falseAccept.mean),
        falseReject: pct(m.falseReject.mean),
        ...(m.lateCorrectness ? { lateCorrectness: pct(m.lateCorrectness.mean) } : {}),
        ...(m.escalationRate ? { escalation: pct(m.escalationRate.mean) } : {}),
        ...(m.avgLatencyMs ? { avgLatency: `${(m.avgLatencyMs.mean / 1000).toFixed(1)}s` } : {})
    }));
    console.table(rows);
}

function printComparisons(report) {
    const rows = Object.entries(report.comparisons).map(([key, c]) => {
        const cc = c.correctness;
        return {
            comparison: key,
            'Δcorrect': cc ? `${(cc.meanDiff * 100).toFixed(1)}pp` : '—',
            'CI95(Δ)': cc ? `[${(cc.diffCi95.lower * 100).toFixed(1)}, ${(cc.diffCi95.upper * 100).toFixed(1)}]pp` : '—',
            'sig(CI≠0)': cc ? (cc.ciExcludesZero ? 'YES' : 'no') : '—',
            'cohensD': cc ? cc.cohensD : '—',
            'signP': cc ? cc.sign.pValue : '—',
            'falseAcc↓': c.falseAcceptReduction ? `${(c.falseAcceptReduction.meanDiff * 100).toFixed(2)}pp` : '—'
        };
    });
    console.log('\n[MA3C vs baselines — paired]  Δ>0 & CI≠0 & signP<0.01 ⇒ MA3C significantly better');
    console.table(rows);
}

function main() {
    const seed = asInt(readArg('seed', '20260417'), 20260417);
    const n = asInt(readArg('n', '5'), 5);
    const seeds = asInt(readArg('seeds', '200'), 200);
    const tasksPerSeed = asInt(readArg('tasks', '20'), 20);
    const maliciousRatio = Number(readArg('malicious', '0.4'));
    // honest-error default comes from calibration.json (CALIBRATION_FILE) when present.
    const calibrated = loadCalibration();
    const honestErrorRate = Number(readArg('honest-error', String(calibrated?.honestErrorRate ?? 0)));
    const enableArbitration = !hasFlag('no-arbitration');
    const output = readArg('output', null);

    const result = { meta: { seed, gitCommit: gitCommit(), generatedAt: new Date().toISOString() } };

    result.meta.enableArbitration = enableArbitration;
    result.meta.honestErrorRate = honestErrorRate;
    result.meta.calibration = calibrated ? { source: process.env.CALIBRATION_FILE, ...calibrated } : null;
    console.log(calibrated
        ? `Calibration: ${process.env.CALIBRATION_FILE} (honestErrorRate=${honestErrorRate}, arbiterErrorFactor=${calibrated.arbiterErrorFactor})`
        : `Calibration: none (honestErrorRate=${honestErrorRate}; set CALIBRATION_FILE to use measured LLM params)`);
    if (hasFlag('sweep')) {
        const sweep = runToleranceSweep({ n, seeds, tasksPerSeed, honestErrorRate, enableArbitration, baseSeed: seed });
        result.toleranceSweep = sweep;
        console.log('\n=== Tolerance sweep (correctness vs malicious ratio) ===');
        for (const report of sweep) {
            printMethodTable('decision', report);
            printComparisons(report);
        }
    } else {
        const decision = runDecisionComparison({ n, maliciousRatio, seeds, tasksPerSeed, honestErrorRate, enableArbitration, baseSeed: seed });
        const sequential = runSequentialComparison({ n: Math.max(7, n), maliciousRatio: 0.3, seeds: Math.min(seeds, 100), honestErrorRate, enableArbitration, baseSeed: seed });
        result.decision = decision;
        result.sequential = sequential;

        console.log('\n=== E2: decision-rule comparison (fresh reputation) ===');
        printMethodTable('decision', decision);
        printComparisons(decision);

        console.log('\n=== Sequential comparison (reputation evolves; adaptive-trust advantage) ===');
        printMethodTable('sequential', sequential);
        printComparisons(sequential);
    }

    if (output) {
        const outputPath = path.resolve(process.cwd(), output);
        fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
        console.log(`\nSaved JSON report to ${outputPath}`);
    }
}

main();
