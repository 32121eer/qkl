const { hashValue } = require('./audit_receipt');

const TERMINAL_NODE_STATES = new Set(['SUCCEEDED', 'FAILED', 'INSUFFICIENT', 'SKIPPED']);

function makeError(code, message, options = {}) {
    const error = new Error(message || code);
    error.code = code;
    error.recoverable = Boolean(options.recoverable);
    error.insufficient = Boolean(options.insufficient);
    return error;
}

function validateDag(nodes) {
    if (!Array.isArray(nodes) || !nodes.length) throw new Error('DAG requires at least one node');
    const byId = new Map();
    for (const node of nodes) {
        if (!node.id) throw new Error('Every DAG node requires an id');
        if (byId.has(node.id)) throw new Error(`Duplicate DAG node '${node.id}'`);
        byId.set(node.id, node);
    }
    for (const node of nodes) {
        for (const dependency of node.deps || []) {
            if (!byId.has(dependency)) throw new Error(`Node '${node.id}' has missing dependency '${dependency}'`);
        }
    }

    const visited = new Set();
    const visiting = new Set();
    function visit(id) {
        if (visited.has(id)) return;
        if (visiting.has(id)) throw new Error(`DAG cycle detected at '${id}'`);
        visiting.add(id);
        for (const dependency of byId.get(id).deps || []) visit(dependency);
        visiting.delete(id);
        visited.add(id);
    }
    for (const id of byId.keys()) visit(id);
    return byId;
}

function withTimeout(promise, timeoutMs, details) {
    let timer;
    const timeout = new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(makeError(
            'NODE_TIMEOUT',
            `Node '${details.nodeId}' exceeded ${timeoutMs} ms`,
            { recoverable: true }
        )), timeoutMs);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

class DagScheduler {
    constructor({ concurrency = 4, defaultTimeoutMs = 5000, deadlineMs = 60000, faultInjector = null } = {}) {
        this.concurrency = Math.max(1, Number(concurrency) || 1);
        this.defaultTimeoutMs = Math.max(1, Number(defaultTimeoutMs) || 5000);
        this.deadlineMs = Math.max(1, Number(deadlineMs) || 60000);
        this.faultInjector = faultInjector;
    }

    async execute({ queryId, nodes, rootNodeId, context = {} } = {}) {
        if (!queryId) throw new Error('queryId is required');
        const definitions = validateDag(nodes);
        if (!definitions.has(rootNodeId)) throw new Error(`Unknown root node '${rootNodeId}'`);

        const startedAtMs = Date.now();
        const startedAt = new Date(startedAtMs).toISOString();
        const deadlineAt = startedAtMs + this.deadlineMs;
        const events = [];
        const records = new Map();
        const outputs = new Map();
        const artifacts = new Map();
        const active = new Map();
        let sequence = 0;
        let queryState = 'CREATED';

        const emit = (type, details = {}) => {
            events.push({ seq: sequence, ts: new Date().toISOString(), type, ...details });
            sequence += 1;
        };
        const setQueryState = (state, details = {}) => {
            if (queryState === state) return;
            queryState = state;
            emit('QUERY_STATE', { state, ...details });
        };

        for (const node of nodes) {
            records.set(node.id, {
                nodeId: node.id,
                kind: node.kind || 'unknown',
                deps: [...new Set(node.deps || [])],
                version: node.version || 'unversioned',
                status: 'PENDING',
                startedAt: null,
                completedAt: null,
                attemptCount: 0,
                endpoint: null,
                errorCode: null,
                outputHash: null
            });
        }
        emit('QUERY_STATE', { state: 'CREATED' });
        setQueryState('FETCHING');

        const runNode = async (definition) => {
            const record = records.get(definition.id);
            const candidates = definition.candidates?.length ? definition.candidates : [null];
            const maxAttempts = Math.max(1, Number(definition.maxAttempts || candidates.length || 1));
            const execute = definition.execute || context.executeNode;
            if (typeof execute !== 'function') {
                record.status = 'FAILED';
                record.errorCode = 'MISSING_EXECUTOR';
                record.completedAt = new Date().toISOString();
                return;
            }

            for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
                if (Date.now() >= deadlineAt) {
                    record.status = 'FAILED';
                    record.errorCode = 'DEADLINE_EXCEEDED';
                    record.completedAt = new Date().toISOString();
                    return;
                }
                const candidate = candidates[Math.min(attempt - 1, candidates.length - 1)];
                record.status = 'RUNNING';
                record.attemptCount = attempt;
                record.endpoint = candidate;
                if (!record.startedAt) record.startedAt = new Date().toISOString();
                emit('NODE_STARTED', { nodeId: definition.id, attempt, candidate });

                if (definition.kind === 'rule') setQueryState('VALIDATING', { nodeId: definition.id });
                if (definition.kind === 'semantic') setQueryState('SEMANTIC', { nodeId: definition.id });
                if (definition.kind === 'root' || definition.kind === 'resolver') {
                    setQueryState('RESOLVING', { nodeId: definition.id });
                }

                const inputValues = Object.fromEntries((definition.deps || []).map((id) => [id, outputs.get(id)]));
                const inputRoot = hashValue(inputValues);
                const invocation = {
                    queryId,
                    attempt,
                    candidate,
                    inputs: inputValues,
                    inputRoot,
                    context
                };
                const delegate = () => execute(definition, invocation);
                const invoked = this.faultInjector
                    ? () => this.faultInjector.execute(definition, invocation, delegate)
                    : delegate;
                const remainingMs = Math.max(1, deadlineAt - Date.now());
                const timeoutMs = Math.min(Number(definition.timeoutMs || this.defaultTimeoutMs), remainingMs);

                try {
                    const result = await withTimeout(Promise.resolve().then(invoked), timeoutMs, { nodeId: definition.id });
                    if (definition.kind === 'semantic' && result?.inputRoot !== inputRoot) {
                        throw makeError('WRONG_INPUT_ROOT', 'Semantic service returned a mismatched input root', {
                            recoverable: true
                        });
                    }
                    let output = result && Object.prototype.hasOwnProperty.call(result, 'value')
                        ? result.value
                        : result;
                    if (typeof definition.validate === 'function') {
                        output = await definition.validate(output, invocation, result);
                    }
                    const nodeArtifacts = result && typeof result === 'object'
                        ? {
                            evidence: result.evidence || null,
                            serviceOutput: result.serviceOutput || null,
                            metadata: result.metadata || null
                        }
                        : null;
                    if (nodeArtifacts && Object.values(nodeArtifacts).some(Boolean)) {
                        artifacts.set(definition.id, nodeArtifacts);
                    }
                    outputs.set(definition.id, output);
                    record.outputHash = hashValue(output ?? null);
                    record.status = 'SUCCEEDED';
                    record.errorCode = null;
                    record.completedAt = new Date().toISOString();
                    emit('NODE_SUCCEEDED', { nodeId: definition.id, attempt, candidate, outputHash: record.outputHash });
                    return;
                } catch (error) {
                    record.errorCode = error.code || 'NODE_EXECUTION_ERROR';
                    const canRetry = Boolean(error.recoverable) && attempt < maxAttempts && Date.now() < deadlineAt;
                    if (canRetry) {
                        record.status = 'RETRYING';
                        emit('NODE_RETRYING', {
                            nodeId: definition.id,
                            attempt,
                            candidate,
                            errorCode: record.errorCode
                        });
                        continue;
                    }
                    record.status = error.insufficient || definition.failureMode === 'insufficient'
                        ? 'INSUFFICIENT'
                        : 'FAILED';
                    record.completedAt = new Date().toISOString();
                    emit('NODE_TERMINATED', {
                        nodeId: definition.id,
                        attempt,
                        candidate,
                        status: record.status,
                        errorCode: record.errorCode
                    });
                    return;
                }
            }
        };

        while ([...records.values()].some((record) => !TERMINAL_NODE_STATES.has(record.status))) {
            let changed = false;
            for (const definition of nodes) {
                const record = records.get(definition.id);
                if (record.status !== 'PENDING') continue;
                const dependencyRecords = (definition.deps || []).map((id) => records.get(id));
                if (!dependencyRecords.every((dependency) => TERMINAL_NODE_STATES.has(dependency.status))) continue;
                const blocked = dependencyRecords.find((dependency) => dependency.status !== 'SUCCEEDED');
                if (blocked) {
                    record.status = definition.required === false ? 'SKIPPED' :
                        (blocked.status === 'FAILED' ? 'FAILED' : 'INSUFFICIENT');
                    record.errorCode = 'DEPENDENCY_UNAVAILABLE';
                    record.completedAt = new Date().toISOString();
                    emit('NODE_BLOCKED', { nodeId: definition.id, dependency: blocked.nodeId, status: record.status });
                    changed = true;
                } else if (active.size < this.concurrency) {
                    record.status = 'READY';
                    emit('NODE_READY', { nodeId: definition.id });
                    const promise = runNode(definition).finally(() => active.delete(definition.id));
                    active.set(definition.id, promise);
                    changed = true;
                }
            }

            if (active.size) {
                await Promise.race(active.values());
                continue;
            }
            if (!changed) throw new Error('DAG scheduler reached a non-progress state');
        }

        const root = records.get(rootNodeId);
        let terminalState;
        let outcome = null;
        if (root.status === 'SUCCEEDED') {
            terminalState = 'READY_TO_ANCHOR';
            outcome = outputs.get(rootNodeId)?.outcome || outputs.get(rootNodeId) || null;
            setQueryState('RESOLVING');
        } else if (root.status === 'INSUFFICIENT') {
            terminalState = 'INSUFFICIENT_EVIDENCE';
            outcome = 'INSUFFICIENT';
            setQueryState(terminalState);
        } else {
            terminalState = 'FAILED';
            setQueryState(terminalState);
        }

        const completedAt = new Date().toISOString();
        return {
            queryId,
            terminalState,
            outcome,
            rootNodeId,
            nodes: [...records.values()],
            outputs: Object.fromEntries(outputs),
            artifacts: Object.fromEntries(artifacts),
            events,
            startedAt,
            completedAt,
            elapsedMs: Date.parse(completedAt) - Date.parse(startedAt)
        };
    }
}

module.exports = { DagScheduler, validateDag, makeError };
