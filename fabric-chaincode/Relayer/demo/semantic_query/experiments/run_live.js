#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { openLiveRuntime } = require('./live_runtime');

function parseArgs(argv) {
    const options = {
        config: path.resolve(__dirname, '../../../config.json'),
        batchId: null,
        supplierId: null,
        orderId: null,
        dbPath: path.resolve(process.cwd(), '.demo', 'semantic-audit-live.db')
    };
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        if (argument === '--config') options.config = path.resolve(argv[++index]);
        else if (argument === '--batch') options.batchId = argv[++index];
        else if (argument === '--supplier') options.supplierId = argv[++index];
        else if (argument === '--order') options.orderId = argv[++index];
        else if (argument === '--db') options.dbPath = path.resolve(argv[++index]);
        else throw new Error(`Unknown argument '${argument}'`);
    }
    for (const field of ['batchId', 'supplierId', 'orderId']) {
        if (!options[field]) throw new Error(`--${field === 'batchId' ? 'batch' : field.replace('Id', '')} is required`);
    }
    return options;
}

async function runLive(options) {
    const runtime = await openLiveRuntime({ configPath: options.config, dbPath: options.dbPath });
    try {
        const queryId = `live-${Date.now()}-${options.orderId}`;
        const result = await runtime.execute({
            queryId,
            batchId: options.batchId,
            supplierId: options.supplierId,
            orderId: options.orderId
        });
        return {
            queryId,
            state: result.receipt.terminalState,
            outcome: result.receipt.outcome,
            receiptRoot: result.receipt.receiptRoot,
            anchorTxHash: result.anchor.txHash,
            anchorBlockHeight: result.anchor.blockHeight,
            auditDb: options.dbPath
        };
    } finally {
        await runtime.close();
    }
}

if (require.main === module) {
    runLive(parseArgs(process.argv.slice(2)))
        .then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
        .catch((error) => {
            process.stderr.write(`${error.stack || error}\n`);
            process.exitCode = 1;
        });
}

module.exports = { parseArgs, runLive };
