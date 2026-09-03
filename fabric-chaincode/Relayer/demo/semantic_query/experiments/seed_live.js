#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ethers } = require('ethers');
const { DemoTriggerService } = require('../../trigger_service');
const { FiscoBcosMonitor } = require('../../../monitors/fisco_bcos_monitor');

function parseArgs(argv) {
    const options = {
        config: path.resolve(__dirname, '../../../config.json'),
        batchId: 'BATCH-FINANCE-001',
        supplierId: 'SUPPLIER-001',
        orderId: 'ORDER-001'
    };
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        if (argument === '--config') options.config = path.resolve(argv[++index]);
        else if (argument === '--batch') options.batchId = argv[++index];
        else if (argument === '--supplier') options.supplierId = argv[++index];
        else if (argument === '--order') options.orderId = argv[++index];
        else throw new Error(`Unknown argument '${argument}'`);
    }
    return options;
}

async function seedLive(options) {
    const config = JSON.parse(fs.readFileSync(options.config, 'utf8'));
    const fiscoChain = config.chains?.find((chain) => chain.type === 'FISCO_BCOS' && chain.enabled);
    if (!fiscoChain) throw new Error('Enabled FISCO_BCOS chain configuration is required');
    const evidenceAddress = fiscoChain.contracts?.supplyChainEvidence;
    if (!evidenceAddress) throw new Error('FISCO contracts.supplyChainEvidence is not configured');

    const triggerService = new DemoTriggerService(config, { addEvent() {} });
    const fabricPayload = {
        payloadVersion: '1.0',
        orchardBatchId: options.batchId,
        eventType: 'finance-evidence',
        eventAt: new Date().toISOString(),
        sourceSystem: 'semantic-query-live-seed',
        data: {
            order: {
                orderId: options.orderId,
                amount: 125000,
                currency: 'CNY',
                dueDate: '2026-08-20'
            },
            invoice: {
                invoiceId: 'INV-001',
                orderId: options.orderId,
                amount: 125000,
                currency: 'CNY'
            }
        }
    };
    await triggerService.putOrchardRecord(options.batchId, fabricPayload);

    const fiscoMonitor = new FiscoBcosMonitor({
        ...fiscoChain,
        relayer: config.relayer
    });
    try {
        await fiscoMonitor.initialize();
        if (!fiscoMonitor.wallet) throw new Error('FISCO relayer wallet is required to seed evidence');
        const abi = require('../../../abi/SupplyChainEvidenceRegistry.json');
        const contract = new ethers.Contract(evidenceAddress, abi, fiscoMonitor.wallet);
        const identity = {
            companyId: options.supplierId,
            active: true,
            creditEligible: true
        };
        const logistics = {
            orderId: options.orderId,
            deliveredAt: '2026-08-18',
            status: 'DELIVERED'
        };
        const identityTx = await contract.putRecord('identity', options.supplierId, JSON.stringify(identity));
        const identityReceipt = typeof identityTx.wait === 'function' ? await identityTx.wait(1) : identityTx;
        const logisticsTx = await contract.putRecord('logistics', options.orderId, JSON.stringify(logistics));
        const logisticsReceipt = typeof logisticsTx.wait === 'function' ? await logisticsTx.wait(1) : logisticsTx;
        return {
            fabric: { batchId: options.batchId },
            fisco: {
                identityTxHash: identityTx.hash || identityReceipt?.hash || null,
                logisticsTxHash: logisticsTx.hash || logisticsReceipt?.hash || null
            },
            supplierId: options.supplierId,
            orderId: options.orderId
        };
    } finally {
        if (fiscoMonitor.provider && typeof fiscoMonitor.provider.destroy === 'function') {
            fiscoMonitor.provider.destroy();
        }
    }
}

if (require.main === module) {
    seedLive(parseArgs(process.argv.slice(2)))
        .then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
        .catch((error) => {
            process.stderr.write(`${error.stack || error}\n`);
            process.exitCode = 1;
        });
}

module.exports = { parseArgs, seedLive };
