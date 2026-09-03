const { DagScheduler } = require('./dag_scheduler');
const { buildAuditReceipt, hashValue } = require('./audit_receipt');

function collectEvidence(result) {
    return Object.entries(result.outputs || {})
        .filter(([nodeId]) => result.nodes.find((node) => node.nodeId === nodeId)?.kind === 'evidence')
        .map(([nodeId, value]) => {
            const captured = result.artifacts?.[nodeId]?.evidence;
            if (captured) return { ...captured, nodeId };
            return {
                evidenceId: hashValue({ queryId: result.queryId, nodeId, payloadHash: hashValue(value) }),
                queryId: result.queryId,
                nodeId,
                payloadHash: hashValue(value),
                storageRef: `generated://${result.queryId}/${nodeId}`,
                sourceType: 'LOCAL_TEST_DATA'
            };
        });
}

function collectServiceOutputs(result) {
    const captured = Object.entries(result.artifacts || {})
        .filter(([, artifact]) => artifact.serviceOutput)
        .map(([nodeId, artifact]) => ({ ...artifact.serviceOutput, nodeId }));
    if (captured.length) return captured;
    return result.nodes
        .filter((node) => node.kind === 'semantic' && node.status === 'SUCCEEDED')
        .map((node) => ({
            serviceOutputId: `${result.queryId}:${node.nodeId}:${node.attemptCount}`,
            nodeId: node.nodeId,
            serviceId: node.endpoint,
            serviceVersion: node.version,
            outputHash: node.outputHash
        }));
}

class SemanticQueryEngine {
    constructor({ scheduler, auditStore, receiptAnchor } = {}) {
        this.scheduler = scheduler || new DagScheduler();
        if (!auditStore) throw new Error('SemanticQueryEngine requires auditStore');
        if (!receiptAnchor || typeof receiptAnchor.anchor !== 'function') {
            throw new Error('SemanticQueryEngine requires receiptAnchor');
        }
        this.auditStore = auditStore;
        this.receiptAnchor = receiptAnchor;
    }

    async execute({
        queryId,
        queryDefinition,
        queryDigest,
        dagVersion,
        nodes,
        rootNodeId,
        context = {},
        conflicts = []
    } = {}) {
        const digest = queryDigest || hashValue(queryDefinition || { queryId, dagVersion });
        const execution = await this.scheduler.execute({ queryId, nodes, rootNodeId, context });
        const terminalState = execution.terminalState === 'READY_TO_ANCHOR'
            ? 'ANCHORED'
            : execution.terminalState;
        const receipt = buildAuditReceipt({
            queryId,
            queryDigest: digest,
            dagVersion,
            rootNodeId,
            terminalState,
            outcome: execution.outcome,
            nodes: execution.nodes,
            evidence: collectEvidence(execution),
            serviceOutputs: collectServiceOutputs(execution),
            conflicts,
            recoveries: execution.events.filter((event) => ['NODE_RETRYING', 'NODE_TERMINATED'].includes(event.type)),
            events: execution.events,
            startedAt: execution.startedAt,
            completedAt: execution.completedAt
        });

        let anchor;
        try {
            anchor = await this.receiptAnchor.anchor(receipt);
        } catch (cause) {
            const error = new Error(`Receipt anchoring failed for '${queryId}': ${cause.message}`);
            error.code = 'RECEIPT_ANCHOR_FAILED';
            error.cause = cause;
            error.receipt = receipt;
            throw error;
        }
        try {
            await this.auditStore.saveReceipt(receipt, anchor);
        } catch (cause) {
            const error = new Error(`Audit persistence failed for '${queryId}': ${cause.message}`);
            error.code = 'AUDIT_PERSISTENCE_FAILED';
            error.cause = cause;
            error.execution = execution;
            error.receipt = receipt;
            error.anchor = anchor;
            throw error;
        }
        const verification = await this.auditStore.verifyStoredReceipt(queryId, receipt.receiptRoot);
        if (!verification.ok) {
            const error = new Error(`Stored audit receipt verification failed for '${queryId}'`);
            error.code = 'STORED_RECEIPT_INVALID';
            error.verification = verification;
            throw error;
        }
        return { execution, receipt, anchor, verification };
    }
}

module.exports = { SemanticQueryEngine, collectEvidence, collectServiceOutputs };
