#!/usr/bin/env node

/**
 * P1 mechanism ablations — each design pillar toggled ON/OFF in the threat regime
 * it defends, using the production rep×conf weighted-vote aggregation:
 *
 *   heterogeneity  → correlated honest errors
 *   VRF rotation   → co-located collusion
 *   commit-reveal  → herding cascade
 *
 *   node scripts/run_ablation_experiments.js
 *   node scripts/run_ablation_experiments.js --seeds=500 --output=ablation.json
 *
 * See demo/experiments/ablation_experiment.js and paper §VIII (P1).
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { runAllAblations } = require('../demo/experiments/ablation_experiment');

function readArg(name, fallback = null) {
    const prefix = `--${name}=`;
    const hit = process.argv.find((item) => item.startsWith(prefix));
    return hit ? hit.slice(prefix.length) : fallback;
}
function asInt(value, fallback) { const p = Number.parseInt(value, 10); return Number.isFinite(p) ? p : fallback; }
function gitCommit() { try { return execSync('git rev-parse --short HEAD', { cwd: __dirname }).toString().trim(); } catch { return 'unknown'; } }
function pct(x) { return `${(Number(x) * 100).toFixed(1)}%`; }

function printAblation(title, regime, r) {
    console.log(`\n=== ${title} (threat: ${regime}) ===`);
    console.table([
        { config: 'ON  (mechanism enabled)', correctness: pct(r.on.correctness.mean), falseAccept: pct(r.on.falseAccept.mean), observe: pct(r.on.observe.mean) },
        { config: 'OFF (mechanism removed)', correctness: pct(r.off.correctness.mean), falseAccept: pct(r.off.falseAccept.mean), observe: pct(r.off.observe.mean) }
    ]);
    const cg = r.correctnessGain;
    const fa = r.falseAcceptReduction;
    console.log(`correctness gain (ON−OFF): ${pct(cg.meanDiff)}  CI[${pct(cg.diffCi95.lower)}, ${pct(cg.diffCi95.upper)}]  d=${cg.cohensD}  sign p=${cg.sign.pValue}`);
    console.log(`false-accept reduction (OFF−ON): ${pct(fa.meanDiff)}  CI[${pct(fa.diffCi95.lower)}, ${pct(fa.diffCi95.upper)}]  d=${fa.cohensD}  sign p=${fa.sign.pValue}`);
    console.log(`load-bearing in this regime: ${r.loadBearing ? 'YES' : 'no'}`);
}

function main() {
    const seeds = asInt(readArg('seeds', '200'), 200);
    const tasksPerSeed = asInt(readArg('tasks', '40'), 40);
    const output = readArg('output', null);

    const results = runAllAblations({
        heterogeneity: { seeds, tasksPerSeed },
        vrfRotation: { seeds, tasksPerSeed },
        commitReveal: { seeds, tasksPerSeed }
    });

    printAblation('1. Strategy heterogeneity', 'correlated honest errors (相关错误)', results.heterogeneity);
    printAblation('2. VRF rotation + org cap', 'co-located collusion (串通共址)', results.vrfRotation);
    printAblation('3. commit-reveal', 'herding cascade (从众级联)', results.commitReveal);

    if (output) {
        const payload = { meta: { gitCommit: gitCommit(), generatedAt: new Date().toISOString(), seeds, tasksPerSeed }, ...results };
        const outputPath = path.resolve(process.cwd(), output);
        fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
        console.log(`\nSaved JSON report to ${outputPath}`);
    }
}

main();
