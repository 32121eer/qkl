#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

function round(value, digits = 6) {
    return Number(Number(value).toFixed(digits));
}

function compareRows(singleRows, multiRows) {
    const multiByConcurrency = new Map(multiRows.map((row) => [row.concurrency, row]));
    return singleRows.map((single) => {
        const multi = multiByConcurrency.get(single.concurrency);
        if (!multi) throw new Error(`Missing multi-wallet row for concurrency ${single.concurrency}`);
        return {
            concurrency: single.concurrency,
            singleThroughput: single.throughput,
            multiThroughput: multi.throughput,
            throughputGainRate: round((multi.throughput / single.throughput) - 1),
            singleP95Ms: single.p95Ms,
            multiP95Ms: multi.p95Ms,
            p95ReductionRate: round(1 - (multi.p95Ms / single.p95Ms)),
            singleAnchorQueueP95Ms: single.anchorQueueP95Ms,
            multiAnchorQueueP95Ms: multi.anchorQueueP95Ms,
            anchorQueueReductionRate: round(1 - (multi.anchorQueueP95Ms / single.anchorQueueP95Ms))
        };
    });
}

function csv(rows) {
    const fields = Object.keys(rows[0] || {});
    return `${fields.join(',')}\n${rows.map((row) => fields.map((field) => row[field]).join(',')).join('\n')}\n`;
}

function main(argv = process.argv.slice(2)) {
    if (argv.length !== 3) {
        throw new Error('Usage: compare_anchor_strategies.js SINGLE_SUMMARY MULTI_SUMMARY OUTPUT_JSON');
    }
    const [singlePath, multiPath, outputPath] = argv.map((value) => path.resolve(value));
    const single = JSON.parse(fs.readFileSync(singlePath, 'utf8'));
    const multi = JSON.parse(fs.readFileSync(multiPath, 'utf8'));
    const rows = compareRows(single.rows, multi.rows);
    const report = {
        schemaVersion: 'semantic-query-anchor-strategy-comparison-v1',
        generatedAt: new Date().toISOString(),
        baseline: { summary: singlePath, walletCount: 1 },
        treatment: { summary: multiPath, walletCount: multi.configuration?.anchorWallets || null },
        rows,
        baselineSaturationPoint: single.saturationPoint,
        treatmentSaturationPoint: multi.saturationPoint,
        evidenceBoundary: [
            'Both runs use the same host, workload, concurrency levels, repetitions and measured query count',
            'Runs occurred on different dates and are not randomized interleaved trials',
            'Additional wallets are ephemeral experiment-only signers; no private keys are persisted',
            'The comparison measures this prototype and does not estimate FISCO-BCOS platform capacity'
        ]
    };
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
    fs.writeFileSync(outputPath.replace(/\.json$/i, '.csv'), csv(rows));
    process.stdout.write(`${outputPath}\n`);
    return report;
}

if (require.main === module) {
    try {
        main();
    } catch (error) {
        process.stderr.write(`${error.stack || error}\n`);
        process.exitCode = 1;
    }
}

module.exports = { compareRows, csv, main };
