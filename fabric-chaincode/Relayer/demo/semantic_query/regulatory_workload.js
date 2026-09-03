const { makeError } = require('./dag_scheduler');

const DEFAULT_REGULATORY_FIXTURE = Object.freeze({
    entity: { entityId: 'ENTITY-001', active: true, jurisdiction: 'CN' },
    license: { entityId: 'ENTITY-001', licenseType: 'TRADE', validUntil: '2027-12-31' },
    transaction: {
        transactionId: 'TX-001', entityId: 'ENTITY-001', amount: 480000,
        currency: 'CNY', occurredAt: '2026-08-20T08:00:00.000Z'
    },
    policy: { policyId: 'POLICY-001', currency: 'CNY', maximumAmount: 500000 },
    disclosure: {
        disclosureId: 'DISC-001', transactionId: 'TX-001', filed: true,
        exceptionText: ''
    }
});

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function evidenceExecutor(recordName, fixture, delayMs) {
    return async () => {
        if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
        return clone(fixture[recordName]);
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
        return result;
    };
}

function createRegulatoryReviewDag({
    fixture = DEFAULT_REGULATORY_FIXTURE,
    serviceDelayMs = 2,
    evidenceTimeoutMs = 100,
    semanticTimeoutMs = 100,
    adapters = {},
    evidenceQueries = {}
} = {}) {
    const data = clone(fixture);
    const local = Object.fromEntries(
        Object.keys(data).map((name) => [name, evidenceExecutor(name, data, 1)])
    );
    return [
        {
            id: 'entity_fabric', kind: 'evidence', deps: [], version: 'fabric-entity-v1',
            candidates: ['fabric-peer-0', 'fabric-peer-1'], maxAttempts: 2, timeoutMs: evidenceTimeoutMs,
            execute: adapterEvidenceExecutor(adapters.fabric, evidenceQueries.entity, local.entity),
            validate: validateEvidence(['entityId', 'active', 'jurisdiction'])
        },
        {
            id: 'license_fabric', kind: 'evidence', deps: [], version: 'fabric-license-v1',
            candidates: ['fabric-peer-0', 'fabric-peer-1'], maxAttempts: 2, timeoutMs: evidenceTimeoutMs,
            execute: adapterEvidenceExecutor(adapters.fabric, evidenceQueries.license, local.license),
            validate: validateEvidence(['entityId', 'licenseType', 'validUntil'])
        },
        {
            id: 'transaction_fisco', kind: 'evidence', deps: [], version: 'fisco-transaction-v1',
            candidates: ['fisco-node-0', 'fisco-node-1'], maxAttempts: 2, timeoutMs: evidenceTimeoutMs,
            execute: adapterEvidenceExecutor(adapters.fisco, evidenceQueries.transaction, local.transaction),
            validate: validateEvidence(['transactionId', 'entityId', 'amount', 'currency', 'occurredAt'])
        },
        {
            id: 'policy_document', kind: 'evidence', deps: [], version: 'policy-document-v1',
            candidates: adapters.fisco ? ['fisco-node-0', 'fisco-node-1'] : ['policy-store-0'],
            maxAttempts: adapters.fisco ? 2 : 1, timeoutMs: evidenceTimeoutMs,
            execute: adapterEvidenceExecutor(adapters.fisco, evidenceQueries.policy, local.policy),
            validate: validateEvidence(['policyId', 'currency', 'maximumAmount'])
        },
        {
            id: 'disclosure_document', kind: 'evidence', deps: [], version: 'disclosure-document-v1',
            candidates: adapters.fabric ? ['fabric-peer-0', 'fabric-peer-1'] : ['document-store-0'],
            maxAttempts: adapters.fabric ? 2 : 1, timeoutMs: evidenceTimeoutMs,
            execute: adapterEvidenceExecutor(adapters.fabric, evidenceQueries.disclosure, local.disclosure),
            validate: validateEvidence(['disclosureId', 'transactionId', 'filed'])
        },
        {
            id: 'entity_rule', kind: 'rule', deps: ['entity_fabric', 'license_fabric'],
            version: 'entity-eligibility-rule-v1',
            execute: (_node, { inputs }) => ({
                passed: inputs.entity_fabric.active &&
                    inputs.entity_fabric.entityId === inputs.license_fabric.entityId &&
                    Date.parse(inputs.license_fabric.validUntil) >= Date.parse('2026-08-20')
            })
        },
        {
            id: 'limit_rule', kind: 'rule', deps: ['transaction_fisco', 'policy_document'],
            version: 'transaction-limit-rule-v1',
            execute: (_node, { inputs }) => ({
                passed: inputs.transaction_fisco.currency === inputs.policy_document.currency &&
                    inputs.transaction_fisco.amount <= inputs.policy_document.maximumAmount
            })
        },
        {
            id: 'subject_rule', kind: 'rule', deps: ['entity_fabric', 'transaction_fisco'],
            version: 'transaction-subject-rule-v1',
            execute: (_node, { inputs }) => ({
                passed: inputs.entity_fabric.entityId === inputs.transaction_fisco.entityId
            })
        },
        {
            id: 'disclosure_semantic', kind: 'semantic', deps: ['transaction_fisco', 'disclosure_document'],
            version: 'disclosure-semantic-v1', candidates: ['regulatory-service-a', 'regulatory-service-b'],
            maxAttempts: 2, timeoutMs: semanticTimeoutMs,
            execute: async (_node, invocation) => {
                if (serviceDelayMs) await new Promise((resolve) => setTimeout(resolve, serviceDelayMs));
                const disclosure = invocation.inputs.disclosure_document;
                const transaction = invocation.inputs.transaction_fisco;
                return {
                    inputRoot: invocation.inputRoot,
                    value: {
                        passed: disclosure.filed &&
                            disclosure.transactionId === transaction.transactionId &&
                            !disclosure.exceptionText,
                        rationale: disclosure.exceptionText || 'disclosure is complete'
                    },
                    serviceOutput: {
                        serviceOutputId: `${invocation.queryId}:disclosure_semantic:${invocation.attempt}`,
                        serviceId: invocation.candidate,
                        serviceVersion: 'disclosure-semantic-v1',
                        inputRoot: invocation.inputRoot
                    }
                };
            }
        },
        {
            id: 'regulatory_root', kind: 'root',
            deps: ['entity_rule', 'limit_rule', 'subject_rule', 'disclosure_semantic'],
            version: 'regulatory-review-policy-v1',
            execute: (_node, { inputs }) => ({
                outcome: Object.values(inputs).every((value) => value.passed) ? 'SATISFIED' : 'UNSATISFIED',
                predicate: 'transaction-regulatory-compliant'
            })
        }
    ];
}

module.exports = { DEFAULT_REGULATORY_FIXTURE, createRegulatoryReviewDag };
