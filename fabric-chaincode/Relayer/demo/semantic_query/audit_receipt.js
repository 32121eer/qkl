const { stableStringify, sha256Hex } = require('../query/query_commitment');

const RECEIPT_SCHEMA_VERSION = 'semantic-audit-receipt-v1';

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function hashValue(value) {
    return sha256Hex(stableStringify(value));
}

function withoutField(value, field) {
    const copy = { ...value };
    delete copy[field];
    return copy;
}

function normalizeHashedRecords(records, idField, hashField) {
    return (records || [])
        .map((record, index) => {
            const normalized = clone(record);
            if (!normalized[idField]) normalized[idField] = `${idField}-${index}`;
            delete normalized[hashField];
            return { ...normalized, [hashField]: hashValue(normalized) };
        })
        .sort((left, right) => String(left[idField]).localeCompare(String(right[idField])));
}

function buildNodeRecords(nodes) {
    const byId = new Map();
    for (const source of nodes || []) {
        const nodeId = source.nodeId || source.id;
        if (!nodeId) throw new Error('Every audit node requires nodeId or id');
        if (byId.has(nodeId)) throw new Error(`Duplicate audit node '${nodeId}'`);
        byId.set(nodeId, source);
    }

    const built = new Map();
    const visiting = new Set();

    function visit(nodeId) {
        if (built.has(nodeId)) return built.get(nodeId);
        if (visiting.has(nodeId)) throw new Error(`Cycle detected at audit node '${nodeId}'`);
        const source = byId.get(nodeId);
        if (!source) throw new Error(`Missing audit dependency '${nodeId}'`);

        visiting.add(nodeId);
        const deps = [...new Set(source.deps || [])].sort();
        const dependencyRecords = deps.map(visit);
        const core = {
            nodeId,
            kind: source.kind || 'unknown',
            deps,
            inputHashes: dependencyRecords.map((record) => record.nodeHash),
            outputHash: source.outputHash || hashValue(source.output ?? null),
            version: source.version || 'unversioned',
            status: source.status || 'UNKNOWN',
            startedAt: source.startedAt || null,
            completedAt: source.completedAt || null,
            attemptCount: Number(source.attemptCount || 0),
            endpoint: source.endpoint || null,
            errorCode: source.errorCode || null
        };
        const record = { ...core, nodeHash: hashValue(core) };
        visiting.delete(nodeId);
        built.set(nodeId, record);
        return record;
    }

    for (const nodeId of byId.keys()) visit(nodeId);
    return [...built.values()].sort((left, right) => left.nodeId.localeCompare(right.nodeId));
}

function buildAuditReceipt({
    queryId,
    queryDigest,
    dagVersion,
    rootNodeId,
    terminalState,
    outcome = null,
    nodes = [],
    evidence = [],
    serviceOutputs = [],
    conflicts = [],
    recoveries = [],
    events = [],
    startedAt = null,
    completedAt = null
} = {}) {
    if (!queryId) throw new Error('queryId is required');
    if (!queryDigest) throw new Error('queryDigest is required');
    if (!dagVersion) throw new Error('dagVersion is required');
    if (!rootNodeId) throw new Error('rootNodeId is required');
    if (!terminalState) throw new Error('terminalState is required');

    const body = {
        schemaVersion: RECEIPT_SCHEMA_VERSION,
        queryId,
        queryDigest,
        dagVersion,
        rootNodeId,
        terminalState,
        outcome,
        nodes: buildNodeRecords(nodes),
        evidence: normalizeHashedRecords(evidence, 'evidenceId', 'evidenceHash'),
        serviceOutputs: normalizeHashedRecords(serviceOutputs, 'serviceOutputId', 'serviceOutputHash'),
        conflicts: clone(conflicts || []),
        recoveries: clone(recoveries || []),
        events: clone(events || []).sort((left, right) => Number(left.seq || 0) - Number(right.seq || 0)),
        startedAt,
        completedAt
    };

    if (!body.nodes.some((node) => node.nodeId === rootNodeId)) {
        throw new Error(`Root audit node '${rootNodeId}' is missing`);
    }

    return { ...body, receiptRoot: hashValue(body) };
}

function verifyAuditReceipt(receipt, { anchoredRoot = null } = {}) {
    const issues = [];
    if (!receipt || typeof receipt !== 'object') {
        return { ok: false, issues: [{ code: 'MISSING_RECEIPT' }] };
    }

    const body = withoutField(receipt, 'receiptRoot');
    const computedRoot = hashValue(body);
    if (receipt.receiptRoot !== computedRoot) {
        issues.push({ code: 'RECEIPT_ROOT_MISMATCH' });
    }
    if (anchoredRoot && anchoredRoot !== computedRoot) {
        issues.push({ code: 'ANCHOR_ROOT_MISMATCH' });
    }
    if (receipt.schemaVersion !== RECEIPT_SCHEMA_VERSION) {
        issues.push({ code: 'UNSUPPORTED_RECEIPT_SCHEMA' });
    }

    const nodes = Array.isArray(receipt.nodes) ? receipt.nodes : [];
    const byId = new Map(nodes.map((node) => [node.nodeId, node]));
    if (!byId.has(receipt.rootNodeId)) issues.push({ code: 'MISSING_ROOT_NODE', nodeId: receipt.rootNodeId });

    for (const node of nodes) {
        const computedNodeHash = hashValue(withoutField(node, 'nodeHash'));
        if (node.nodeHash !== computedNodeHash) {
            issues.push({ code: 'NODE_HASH_MISMATCH', nodeId: node.nodeId });
        }
        const deps = Array.isArray(node.deps) ? node.deps : [];
        const inputHashes = Array.isArray(node.inputHashes) ? node.inputHashes : [];
        if (deps.length !== inputHashes.length) {
            issues.push({ code: 'INPUT_HASH_COUNT_MISMATCH', nodeId: node.nodeId });
        }
        deps.forEach((dep, index) => {
            const dependency = byId.get(dep);
            if (!dependency) issues.push({ code: 'MISSING_DEPENDENCY', nodeId: node.nodeId, dependency: dep });
            else if (inputHashes[index] !== dependency.nodeHash) {
                issues.push({ code: 'DEPENDENCY_HASH_MISMATCH', nodeId: node.nodeId, dependency: dep });
            }
        });
    }

    for (const record of receipt.evidence || []) {
        const computed = hashValue(withoutField(record, 'evidenceHash'));
        if (record.evidenceHash !== computed) {
            issues.push({ code: 'EVIDENCE_HASH_MISMATCH', evidenceId: record.evidenceId });
        }
    }
    for (const record of receipt.serviceOutputs || []) {
        const computed = hashValue(withoutField(record, 'serviceOutputHash'));
        if (record.serviceOutputHash !== computed) {
            issues.push({ code: 'SERVICE_OUTPUT_HASH_MISMATCH', serviceOutputId: record.serviceOutputId });
        }
    }

    return { ok: issues.length === 0, computedRoot, issues };
}

module.exports = {
    RECEIPT_SCHEMA_VERSION,
    buildAuditReceipt,
    verifyAuditReceipt,
    hashValue
};
