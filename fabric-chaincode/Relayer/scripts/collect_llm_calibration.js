#!/usr/bin/env node

/**
 * Collect LLM calibration parameters for the comparison simulator.
 *
 *   # mock smoke test (no key needed):
 *   node scripts/collect_llm_calibration.js --output=demo/experiments/calibration/calibration.json
 *
 *   # real measurement (run on the WSL host with a backend configured):
 *   AGENT_LLM_BACKEND=ollama  AGENT_LLM_MODEL=llama3.1:8b \
 *     node scripts/collect_llm_calibration.js --repeats=10 --arbiter-k=5 --output=…/calibration.json
 *   AGENT_LLM_BACKEND=anthropic ANTHROPIC_API_KEY=… \
 *     node scripts/collect_llm_calibration.js --output=…/calibration.json
 *
 * Writes calibration.json with calibratedParams {honestErrorRate, arbiterErrorFactor,
 * meanConfidenceCorrect, meanConfidenceWrong} that comparative_runner picks up via
 * CALIBRATION_FILE.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { createLLMClientFromEnv } = require('../demo/agents/llm_client');
const { buildCalibrationCases, collectCalibration } = require('../demo/experiments/calibration/llm_calibration');

function readArg(name, fallback = null) {
    const prefix = `--${name}=`;
    const hit = process.argv.find((item) => item.startsWith(prefix));
    return hit ? hit.slice(prefix.length) : fallback;
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

async function main() {
    const repeats = asInt(readArg('repeats', '5'), 5);
    const arbiterK = asInt(readArg('arbiter-k', '5'), 5);
    const output = readArg('output', null);

    const client = createLLMClientFromEnv(process.env);
    const cases = buildCalibrationCases({ repeats });

    if (client.backend === 'mock') {
        console.log('⚠️  backend = mock (no AGENT_LLM_BACKEND/key). Numbers are a PIPELINE SMOKE TEST,');
        console.log('   not real LLM error rates. Re-run on the WSL host with a real backend.\n');
    }
    console.log(`Running ${cases.length} labeled cases through backend=${client.backend} model=${client.model} (arbiterK=${arbiterK})…`);

    const result = await collectCalibration({ client, cases, arbiterK });
    result.meta = { gitCommit: gitCommit(), generatedAt: new Date().toISOString(), repeats };

    console.log('\n[Verifier]', result.verifier);
    console.log('[Arbiter ]', result.arbiter);
    console.log('[Calibrated params → simulator]', result.calibratedParams);
    console.log('\n[By tamper type]');
    console.table(result.byTamper);

    if (output) {
        const outputPath = path.resolve(process.cwd(), output);
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
        console.log(`\nSaved calibration to ${outputPath}`);
        console.log('Use it:  CALIBRATION_FILE=' + output + ' node scripts/run_comparative_experiments.js …');
    }
}

main().catch((error) => {
    console.error('Calibration failed:', error);
    process.exit(1);
});
