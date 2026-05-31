#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const {
    runAllExperiments
} = require('../demo/experiments/ma3c_wbft_simulator');

function readArg(name, fallback = null) {
    const prefix = `--${name}=`;
    const hit = process.argv.find((item) => item.startsWith(prefix));
    if (!hit) {
        return fallback;
    }
    return hit.slice(prefix.length);
}

function asInt(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function buildOptions() {
    const seed = asInt(readArg('seed', '20260417'), 20260417);
    const trials = asInt(readArg('trials', '40'), 40);
    const output = readArg('output', null);

    return {
        seed,
        output,
        convergence: {
            seed,
            trials,
            sizes: [7, 15, 31, 61],
            maliciousRatio: Number(readArg('convergence-malicious', '0.2'))
        },
        resilience: {
            seed: seed + 1000,
            trials: asInt(readArg('resilience-trials', String(Math.max(60, trials))), Math.max(60, trials)),
            n: asInt(readArg('resilience-n', '15'), 15),
            maliciousRatios: [0.1, 0.2, 0.3]
        },
        newAgentEvolution: {
            seed: seed + 2000,
            n: asInt(readArg('evolution-n', '15'), 15),
            maliciousRatio: Number(readArg('evolution-malicious', '0.2')),
            warmupRounds: asInt(readArg('warmup-rounds', '24'), 24),
            observeRounds: asInt(readArg('observe-rounds', '40'), 40)
        }
    };
}

function printSection(title, rows) {
    console.log(`\n[${title}]`);
    console.table(rows);
}

function main() {
    const options = buildOptions();
    const result = runAllExperiments(options);

    printSection('Consensus Convergence', result.convergence);
    printSection('Resilience', result.resilience);
    printSection('New Agent Evolution', [{
        agentCount: result.newAgentEvolution.agentCount,
        maliciousRatio: result.newAgentEvolution.maliciousRatio,
        warmupRounds: result.newAgentEvolution.warmupRounds,
        observeRounds: result.newAgentEvolution.observeRounds,
        roundsToTopQuartile: result.newAgentEvolution.roundsToTopQuartile,
        finalWeight: result.newAgentEvolution.finalWeight
    }]);

    if (options.output) {
        const outputPath = path.resolve(process.cwd(), options.output);
        fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
        console.log(`\nSaved JSON report to ${outputPath}`);
    }
}

main();
