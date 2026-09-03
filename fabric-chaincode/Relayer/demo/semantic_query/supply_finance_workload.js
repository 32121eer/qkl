const { makeError } = require('./dag_scheduler');

const DEFAULT_FIXTURE = Object.freeze({
    identity: { companyId: 'SUPPLIER-001', active: true, creditEligible: true },
    order: { orderId: 'ORDER-001', amount: 125000, currency: 'CNY', dueDate: '2026-08-20' },
    invoice: { invoiceId: 'INV-001', orderId: 'ORDER-001', amount: 125000, currency: 'CNY' },
    logistics: { orderId: 'ORDER-001', deliveredAt: '2026-08-18', status: 'DELIVERED' },
    quality: { reportId: 'QC-001', orderId: 'ORDER-001', conclusion: 'PASS', exceptionText: '' }
});

function copy(value) {
    return JSON.parse(JSON.stringify(value));
}

function evidenceExecutor(recordName, fixture, delayMs) {
    return async () => {
        if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
        return copy(fixture[recordName]);
    };
}

function adapterEvidenceExecutor(adapter, querySpec, fallback) {
    if (!adapter) return fallback;
    if (!querySpec) throw new Error('A query specification is required when an evidence adapter is configured');
    return (_node, invocation) => adapter.fetch({
        ...querySpec,
        queryId: invocation.queryId,
        candidate: invocation.candidate
    });
}

function validateEvidence(requiredFields) {
    return (result) => {
        for (const field of requiredFields) {
            if (result?.[field] === undefined || result?.[field] === null) {
                throw makeError('MISSING_FIELD', `Evidence field '${field}' is missing`, { insufficient: true });
            }
        }
        if (result.validUntil && Date.parse(result.validUntil) < Date.now()) {
            throw makeError('EXPIRED_EVIDENCE', 'Evidence is expired', { recoverable: true, insufficient: true });
        }
        return result;
    };
}

function createSupplyFinanceDag({
    fixture = DEFAULT_FIXTURE,
    serviceDelayMs = 2,
    evidenceTimeoutMs = 100,
    semanticTimeoutMs = 100,
    adapters = {},
    evidenceQueries = {}
} = {}) {
    const data = copy(fixture);
    const local = {
        identity: evidenceExecutor('identity', data, 1),
        order: evidenceExecutor('order', data, 1),
        invoice: evidenceExecutor('invoice', data, 1),
        logistics: evidenceExecutor('logistics', data, 1),
        quality: evidenceExecutor('quality', data, 1)
    };
    return [
        {
            id: 'identity_fisco', kind: 'evidence', deps: [], version: 'fisco-adapter-v1',
            candidates: ['fisco-node-0', 'fisco-node-1'], maxAttempts: 2, timeoutMs: evidenceTimeoutMs,
            execute: adapterEvidenceExecutor(adapters.fisco, evidenceQueries.identity, local.identity),
            validate: validateEvidence(['companyId', 'active', 'creditEligible'])
        },
        {
            id: 'order_fabric', kind: 'evidence', deps: [], version: 'fabric-adapter-v1',
            candidates: ['fabric-peer-0', 'fabric-peer-1'], maxAttempts: 2, timeoutMs: evidenceTimeoutMs,
            execute: adapterEvidenceExecutor(adapters.fabric, evidenceQueries.order, local.order),
            validate: validateEvidence(['orderId', 'amount', 'currency', 'dueDate'])
        },
        {
            id: 'invoice_fabric', kind: 'evidence', deps: [], version: 'fabric-adapter-v1',
            candidates: ['fabric-peer-0', 'fabric-peer-1'], maxAttempts: 2, timeoutMs: evidenceTimeoutMs,
            execute: adapterEvidenceExecutor(adapters.fabric, evidenceQueries.invoice, local.invoice),
            validate: validateEvidence(['invoiceId', 'orderId', 'amount', 'currency'])
        },
        {
            id: 'logistics_fisco', kind: 'evidence', deps: [], version: 'fisco-adapter-v1',
            candidates: ['fisco-node-0', 'fisco-node-1'], maxAttempts: 2, timeoutMs: evidenceTimeoutMs,
            execute: adapterEvidenceExecutor(adapters.fisco, evidenceQueries.logistics, local.logistics),
            validate: validateEvidence(['orderId', 'deliveredAt', 'status'])
        },
        {
            id: 'quality_document', kind: 'evidence', deps: [], version: 'document-adapter-v1',
            candidates: ['document-store-0'], maxAttempts: 1, timeoutMs: evidenceTimeoutMs,
            execute: adapterEvidenceExecutor(adapters.document, evidenceQueries.quality, local.quality),
            validate: validateEvidence(['reportId', 'orderId', 'conclusion'])
        },
        {
            id: 'qualification_rule', kind: 'rule', deps: ['identity_fisco'], version: 'qualification-rule-v1',
            execute: (_node, { inputs }) => ({ passed: inputs.identity_fisco.active && inputs.identity_fisco.creditEligible })
        },
        {
            id: 'amount_rule', kind: 'rule', deps: ['order_fabric', 'invoice_fabric'], version: 'amount-rule-v1',
            execute: (_node, { inputs }) => ({
                passed: inputs.order_fabric.orderId === inputs.invoice_fabric.orderId &&
                    inputs.order_fabric.amount === inputs.invoice_fabric.amount &&
                    inputs.order_fabric.currency === inputs.invoice_fabric.currency
            })
        },
        {
            id: 'delivery_rule', kind: 'rule', deps: ['order_fabric', 'logistics_fisco'], version: 'delivery-rule-v1',
            execute: (_node, { inputs }) => ({
                passed: inputs.logistics_fisco.status === 'DELIVERED' &&
                    Date.parse(inputs.logistics_fisco.deliveredAt) <= Date.parse(inputs.order_fabric.dueDate)
            })
        },
        {
            id: 'quality_semantic', kind: 'semantic', deps: ['quality_document'], version: 'quality-semantic-v1',
            candidates: ['local-semantic-a', 'local-semantic-b'], maxAttempts: 2, timeoutMs: semanticTimeoutMs,
            execute: async (_node, invocation) => {
                if (serviceDelayMs) await new Promise((resolve) => setTimeout(resolve, serviceDelayMs));
                const report = invocation.inputs.quality_document;
                return {
                    inputRoot: invocation.inputRoot,
                    value: {
                        passed: report.conclusion === 'PASS' && !report.exceptionText,
                        rationale: report.exceptionText || 'quality report passed'
                    },
                    serviceOutput: {
                        serviceOutputId: `${invocation.queryId}:quality_semantic:${invocation.attempt}`,
                        serviceId: invocation.candidate,
                        serviceVersion: 'quality-semantic-v1',
                        inputRoot: invocation.inputRoot
                    }
                };
            },
            validate: (output) => {
                if (output?.disagreement) {
                    throw makeError('SEMANTIC_DISAGREEMENT', 'Semantic services remain in conflict', {
                        recoverable: true,
                        insufficient: true
                    });
                }
                return output;
            }
        },
        {
            id: 'financing_root', kind: 'root',
            deps: ['qualification_rule', 'amount_rule', 'delivery_rule', 'quality_semantic'],
            version: 'financing-policy-v1',
            execute: (_node, { inputs }) => ({
                outcome: Object.values(inputs).every((value) => value.passed) ? 'SATISFIED' : 'UNSATISFIED',
                predicate: 'supply-chain-financing-eligible'
            })
        }
    ];
}

module.exports = { DEFAULT_FIXTURE, createSupplyFinanceDag };
