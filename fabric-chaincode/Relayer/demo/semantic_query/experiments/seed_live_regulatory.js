#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ethers } = require('ethers');
const { DemoTriggerService } = require('../../trigger_service');
const { FiscoBcosMonitor } = require('../../../monitors/fisco_bcos_monitor');

const REGULATORY_SCENARIOS = Object.freeze([
    'normal',
    'over_limit',
    'subject_mismatch',
    'missing_disclosure',
    'endpoint_retry'
]);

function parseArgs(argv) {
    const options = { config: path.resolve(__dirname, '../../../config.json') };
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        if (argument === '--config') options.config = path.resolve(argv[++index]);
        else throw new Error(`Unknown argument '${argument}'`);
    }
    return options;
}

function scenarioRecord(scenario) {
    if (!REGULATORY_SCENARIOS.includes(scenario)) throw new Error(`Unknown scenario '${scenario}'`);
    const suffix = scenario.replaceAll('_', '-').toUpperCase();
    const entityId = 'ENTITY-REG-001';
    const transactionId = `TX-REG-${suffix}`;
    const policyId = `POLICY-REG-${suffix}`;
    const batchId = `BATCH-REG-${suffix}`;
    const transaction = {
        transactionId,
        entityId: scenario === 'subject_mismatch' ? 'ENTITY-REG-OTHER' : entityId,
        amount: scenario === 'over_limit' ? 500001 : 480000,
        currency: 'CNY',
        occurredAt: '2026-08-20T08:00:00.000Z'
    };
    const disclosure = {
        disclosureId: `DISC-REG-${suffix}`,
        transactionId,
        filed: true,
        exceptionText: ''
    };
    if (scenario === 'missing_disclosure') delete disclosure.filed;
    return {
        scenario,
        batchId,
        transactionId,
        policyId,
        fabricPayload: {
            payloadVersion: '1.0',
            orchardBatchId: batchId,
            eventType: 'regulatory-evidence',
            eventAt: '2026-08-20T08:00:00.000Z',
            sourceSystem: 'semantic-query-live-regulatory-seed',
            data: {
                entity: { entityId, active: true, jurisdiction: 'CN' },
                license: { entityId, licenseType: 'TRADE', validUntil: '2027-12-31' },
                disclosure
            }
        },
        transaction,
        policy: { policyId, currency: 'CNY', maximumAmount: 500000 }
    };
}

async function seedLiveRegulatory(options) {
    const config = JSON.parse(fs.readFileSync(options.config, 'utf8'));
    const fiscoChain = config.chains?.find((chain) => chain.type === 'FISCO_BCOS' && chain.enabled);
    if (!fiscoChain) throw new Error('Enabled FISCO_BCOS chain configuration is required');
    const evidenceAddress = fiscoChain.contracts?.supplyChainEvidence;
    if (!evidenceAddress) throw new Error('FISCO contracts.supplyChainEvidence is not configured');

    const records = REGULATORY_SCENARIOS.map(scenarioRecord);
    const triggerService = new DemoTriggerService(config, { addEvent() {} });
    for (const record of records) {
        await triggerService.putOrchardRecord(record.batchId, record.fabricPayload);
    }

    const fiscoMonitor = new FiscoBcosMonitor({ ...fiscoChain, relayer: config.relayer });
    const transactions = [];
    try {
        await fiscoMonitor.initialize();
        if (!fiscoMonitor.wallet) throw new Error('FISCO relayer wallet is required to seed evidence');
        const abi = require('../../../abi/SupplyChainEvidenceRegistry.json');
        const contract = new ethers.Contract(evidenceAddress, abi, fiscoMonitor.wallet);
        for (const record of records) {
            for (const [category, recordId, payload] of [
                ['regulatory-transaction', record.transactionId, record.transaction],
                ['regulatory-policy', record.policyId, record.policy]
            ]) {
                const tx = await contract.putRecord(category, recordId, JSON.stringify(payload));
                const receipt = typeof tx.wait === 'function' ? await tx.wait(1) : tx;
                transactions.push({
                    scenario: record.scenario,
                    category,
                    recordId,
                    txHash: tx.hash || receipt?.hash || null,
                    blockHeight: Number(receipt?.blockNumber ?? receipt?.blockHeight ?? 0) || null
                });
            }
        }
    } finally {
        if (fiscoMonitor.provider && typeof fiscoMonitor.provider.destroy === 'function') {
            fiscoMonitor.provider.destroy();
        }
    }

    return {
        evidenceAddress,
        records: records.map(({ scenario, batchId, transactionId, policyId }) => ({
            scenario, batchId, transactionId, policyId
        })),
        transactions
    };
}

if (require.main === module) {
    seedLiveRegulatory(parseArgs(process.argv.slice(2)))
        .then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
        .catch((error) => {
            process.stderr.write(`${error.stack || error}\n`);
            process.exitCode = 1;
        });
}

module.exports = { REGULATORY_SCENARIOS, parseArgs, scenarioRecord, seedLiveRegulatory };
