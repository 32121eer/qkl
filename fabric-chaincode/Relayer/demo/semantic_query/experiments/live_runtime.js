'use strict';

const fs = require('node:fs');
const FabricMonitor = require('../../../monitors/fabric_monitor');
const { FiscoBcosMonitor } = require('../../../monitors/fisco_bcos_monitor');
const { DemoTriggerService } = require('../../trigger_service');
const { SemanticAuditStore } = require('../audit_store');
const { DagScheduler } = require('../dag_scheduler');
const { FaultInjector } = require('../fault_injector');
const {
    createFabricAdapterFromRuntime,
    createFiscoAdapterFromRuntime
} = require('../evidence_adapters');
const { createFiscoReceiptAnchorPoolFromRuntime } = require('../receipt_anchor');
const { SemanticQueryEngine } = require('../semantic_query_engine');
const { createRegulatoryReviewDag } = require('../regulatory_workload');
const { createSupplyFinanceDag } = require('../supply_finance_workload');

function enabledChain(config, type) {
    const chain = config.chains?.find((candidate) => candidate.type === type && candidate.enabled);
    if (!chain) throw new Error(`Enabled ${type} chain configuration is required`);
    return chain;
}

function createEvidenceQueries({ batchId, supplierId, orderId, evidenceAddress }) {
    return {
        order: {
            functionName: 'GetOrchardRecord',
            args: [batchId],
            resource: `orchard:${batchId}:order`,
            payloadPath: 'payload.data.order',
            predicateBinding: 'invoice.amount<=order.amount'
        },
        invoice: {
            functionName: 'GetOrchardRecord',
            args: [batchId],
            resource: `orchard:${batchId}:invoice`,
            payloadPath: 'payload.data.invoice',
            predicateBinding: 'invoice.amount<=order.amount'
        },
        identity: {
            contractName: 'SupplyChainEvidenceRegistry',
            contractAddress: evidenceAddress,
            functionName: 'getRecord',
            args: ['identity', supplierId],
            resource: `identity:${supplierId}`,
            predicateBinding: 'supplier.active&&supplier.creditEligible'
        },
        logistics: {
            contractName: 'SupplyChainEvidenceRegistry',
            contractAddress: evidenceAddress,
            functionName: 'getRecord',
            args: ['logistics', orderId],
            resource: `logistics:${orderId}`,
            predicateBinding: 'logistics.deliveredAt<=order.dueDate'
        }
    };
}

function createRegulatoryEvidenceQueries({ batchId, transactionId, policyId, evidenceAddress }) {
    return {
        entity: {
            functionName: 'GetOrchardRecord',
            args: [batchId],
            resource: `regulatory:${batchId}:entity`,
            payloadPath: 'payload.data.entity',
            predicateBinding: 'entity.active&&entity.entityId==license.entityId'
        },
        license: {
            functionName: 'GetOrchardRecord',
            args: [batchId],
            resource: `regulatory:${batchId}:license`,
            payloadPath: 'payload.data.license',
            predicateBinding: 'license.validUntil>=transaction.occurredAt'
        },
        disclosure: {
            functionName: 'GetOrchardRecord',
            args: [batchId],
            resource: `regulatory:${batchId}:disclosure`,
            payloadPath: 'payload.data.disclosure',
            predicateBinding: 'disclosure.filed&&disclosure.transactionId==transaction.transactionId'
        },
        transaction: {
            contractName: 'SupplyChainEvidenceRegistry',
            contractAddress: evidenceAddress,
            functionName: 'getRecord',
            args: ['regulatory-transaction', transactionId],
            resource: `regulatory-transaction:${transactionId}`,
            predicateBinding: 'transaction.amount<=policy.maximumAmount&&transaction.entityId==entity.entityId'
        },
        policy: {
            contractName: 'SupplyChainEvidenceRegistry',
            contractAddress: evidenceAddress,
            functionName: 'getRecord',
            args: ['regulatory-policy', policyId],
            resource: `regulatory-policy:${policyId}`,
            predicateBinding: 'transaction.currency==policy.currency&&transaction.amount<=policy.maximumAmount'
        }
    };
}

async function closeRuntime({ fabricMonitor, fiscoMonitor, store }) {
    const tasks = [];
    if (store) tasks.push(store.close().catch(() => {}));
    if (fabricMonitor) tasks.push(fabricMonitor.resetConnection().catch(() => {}));
    if (fiscoMonitor?.provider && typeof fiscoMonitor.provider.destroy === 'function') {
        tasks.push(Promise.resolve().then(() => fiscoMonitor.provider.destroy()).catch(() => {}));
    }
    await Promise.all(tasks);
}

class LiveSemanticQueryRuntime {
    constructor({ config, fabricChain, fiscoChain, fabricMonitor, fiscoMonitor, store, anchorWalletCount = 1 }) {
        this.config = config;
        this.fabricChain = fabricChain;
        this.fiscoChain = fiscoChain;
        this.fabricMonitor = fabricMonitor;
        this.fiscoMonitor = fiscoMonitor;
        this.store = store;
        this.evidenceAddress = fiscoChain.contracts.supplyChainEvidence;

        const triggerService = new DemoTriggerService(config, { addEvent() {} });
        this.adapters = {
            fabric: createFabricAdapterFromRuntime({
                triggerService,
                monitor: fabricMonitor,
                candidateConnections: fabricChain.connection?.evidenceEndpoints || {}
            }),
            fisco: createFiscoAdapterFromRuntime({
                monitor: fiscoMonitor,
                candidateEndpoints: fiscoChain.rpc?.evidenceEndpoints || {},
                contracts: {
                    SupplyChainEvidenceRegistry: {
                        address: this.evidenceAddress,
                        abi: require('../../../abi/SupplyChainEvidenceRegistry.json')
                    }
                }
            })
        };
        this.receiptAnchor = createFiscoReceiptAnchorPoolFromRuntime({
            config,
            monitor: fiscoMonitor,
            walletCount: anchorWalletCount
        });
    }

    async execute({
        queryId,
        batchId,
        supplierId,
        orderId,
        faultPlan = [],
        evidenceTimeoutMs = 10000,
        semanticTimeoutMs = 5000,
        deadlineMs = 60000,
        concurrency = 4
    }) {
        const faultInjector = new FaultInjector(faultPlan);
        const scheduler = new DagScheduler({
            concurrency,
            defaultTimeoutMs: evidenceTimeoutMs,
            deadlineMs,
            faultInjector
        });
        const engine = new SemanticQueryEngine({
            scheduler,
            auditStore: this.store,
            receiptAnchor: this.receiptAnchor
        });
        const evidenceQueries = createEvidenceQueries({
            batchId,
            supplierId,
            orderId,
            evidenceAddress: this.evidenceAddress
        });
        const result = await engine.execute({
            queryId,
            queryDefinition: {
                template: 'supply-chain-financing-v1',
                batchId,
                supplierId,
                orderId
            },
            dagVersion: 'supply-finance-dag-v1',
            nodes: createSupplyFinanceDag({
                adapters: this.adapters,
                evidenceQueries,
                serviceDelayMs: 0,
                evidenceTimeoutMs,
                semanticTimeoutMs
            }),
            rootNodeId: 'financing_root'
        });
        return { ...result, appliedFaults: faultInjector.applied };
    }

    async executeRegulatory({
        queryId,
        batchId,
        transactionId,
        policyId,
        faultPlan = [],
        evidenceTimeoutMs = 10000,
        semanticTimeoutMs = 5000,
        deadlineMs = 60000,
        concurrency = 5
    }) {
        const faultInjector = new FaultInjector(faultPlan);
        const scheduler = new DagScheduler({
            concurrency,
            defaultTimeoutMs: evidenceTimeoutMs,
            deadlineMs,
            faultInjector
        });
        const engine = new SemanticQueryEngine({
            scheduler,
            auditStore: this.store,
            receiptAnchor: this.receiptAnchor
        });
        const evidenceQueries = createRegulatoryEvidenceQueries({
            batchId,
            transactionId,
            policyId,
            evidenceAddress: this.evidenceAddress
        });
        const result = await engine.execute({
            queryId,
            queryDefinition: {
                template: 'regulatory-disclosure-review-v1',
                batchId,
                transactionId,
                policyId
            },
            dagVersion: 'regulatory-review-dag-v1',
            nodes: createRegulatoryReviewDag({
                adapters: this.adapters,
                evidenceQueries,
                serviceDelayMs: 0,
                evidenceTimeoutMs,
                semanticTimeoutMs
            }),
            rootNodeId: 'regulatory_root'
        });
        return { ...result, appliedFaults: faultInjector.applied };
    }

    async close() {
        this.adapters.fisco?.close?.();
        await closeRuntime(this);
    }
}

async function openLiveRuntime({ configPath, dbPath, anchorWalletCount = 1 }) {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const fabricChain = enabledChain(config, 'FABRIC');
    const fiscoChain = enabledChain(config, 'FISCO_BCOS');
    if (!fiscoChain.contracts?.supplyChainEvidence) {
        throw new Error('FISCO contracts.supplyChainEvidence is not configured');
    }
    if (!fiscoChain.contracts?.semanticAuditAnchor) {
        throw new Error('FISCO contracts.semanticAuditAnchor is not configured');
    }

    const fabricMonitor = new FabricMonitor(fabricChain);
    const fiscoMonitor = new FiscoBcosMonitor({ ...fiscoChain, relayer: config.relayer });
    const store = new SemanticAuditStore({ dbPath });
    try {
        await Promise.all([fabricMonitor.initialize(), fiscoMonitor.initialize()]);
        const initialFabricHeight = await fabricMonitor.getLatestBlockNumber();
        if (Number.isInteger(initialFabricHeight) && initialFabricHeight >= 0) {
            fabricMonitor.latestObservedBlockNumber = initialFabricHeight;
        }
        return new LiveSemanticQueryRuntime({
            config,
            fabricChain,
            fiscoChain,
            fabricMonitor,
            fiscoMonitor,
            store,
            anchorWalletCount
        });
    } catch (error) {
        await closeRuntime({ fabricMonitor, fiscoMonitor, store });
        throw error;
    }
}

module.exports = {
    LiveSemanticQueryRuntime,
    closeRuntime,
    createEvidenceQueries,
    createRegulatoryEvidenceQueries,
    enabledChain,
    openLiveRuntime
};
