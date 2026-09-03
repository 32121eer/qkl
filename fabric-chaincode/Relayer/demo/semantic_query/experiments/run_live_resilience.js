#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const { promisify } = require('node:util');
const { openLiveRuntime } = require('./live_runtime');
const { percentile, publicChainConfiguration } = require('./run_live_benchmark');

const execFileAsync = promisify(execFile);
const RESILIENCE_SCENARIOS = Object.freeze([
    'fabric_network_partition',
    'fisco_node_resync',
    'fisco_correlated_pause',
    'material_store_outage',
    'audit_store_outage'
]);

function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs(argv) {
    const options = {
        config: path.resolve(__dirname, '../../../config.json'),
        batchId: 'BATCH-FINANCE-001',
        supplierId: 'SUPPLIER-001',
        orderId: 'ORDER-001',
        repetitions: 1,
        scenarios: [...RESILIENCE_SCENARIOS],
        evidenceTimeoutMs: 1500,
        semanticTimeoutMs: 1000,
        deadlineMs: 30000,
        fabricContainer: 'peer0.org1.example.com',
        fabricNetwork: 'fabric_test',
        fiscoContainer: 'qkl-fisco-nodes',
        fiscoPrimaryNode: 'node0',
        fiscoSecondaryNode: 'node1',
        fiscoPrimaryEndpoint: 'http://127.0.0.1:8542',
        fiscoReferenceEndpoint: 'http://127.0.0.1:8545',
        settleMs: 300,
        correlatedOutageMs: 3500,
        recoveryTimeoutMs: 30000,
        recoveryPollMs: 250,
        outDir: null
    };
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        if (argument === '--config') options.config = path.resolve(argv[++index]);
        else if (argument === '--batch') options.batchId = argv[++index];
        else if (argument === '--supplier') options.supplierId = argv[++index];
        else if (argument === '--order') options.orderId = argv[++index];
        else if (argument === '--repetitions') options.repetitions = Number(argv[++index]);
        else if (argument === '--scenarios') options.scenarios = argv[++index].split(',').filter(Boolean);
        else if (argument === '--evidence-timeout') options.evidenceTimeoutMs = Number(argv[++index]);
        else if (argument === '--semantic-timeout') options.semanticTimeoutMs = Number(argv[++index]);
        else if (argument === '--deadline') options.deadlineMs = Number(argv[++index]);
        else if (argument === '--fabric-container') options.fabricContainer = argv[++index];
        else if (argument === '--fabric-network') options.fabricNetwork = argv[++index];
        else if (argument === '--fisco-container') options.fiscoContainer = argv[++index];
        else if (argument === '--fisco-primary-node') options.fiscoPrimaryNode = argv[++index];
        else if (argument === '--fisco-secondary-node') options.fiscoSecondaryNode = argv[++index];
        else if (argument === '--fisco-primary-endpoint') options.fiscoPrimaryEndpoint = argv[++index];
        else if (argument === '--fisco-reference-endpoint') options.fiscoReferenceEndpoint = argv[++index];
        else if (argument === '--settle-ms') options.settleMs = Number(argv[++index]);
        else if (argument === '--correlated-outage-ms') options.correlatedOutageMs = Number(argv[++index]);
        else if (argument === '--recovery-timeout') options.recoveryTimeoutMs = Number(argv[++index]);
        else if (argument === '--recovery-poll') options.recoveryPollMs = Number(argv[++index]);
        else if (argument === '--out') options.outDir = path.resolve(argv[++index]);
        else throw new Error(`Unknown argument '${argument}'`);
    }
    if (!Number.isInteger(options.repetitions) || options.repetitions < 1) {
        throw new Error('--repetitions must be a positive integer');
    }
    const unknown = options.scenarios.filter((scenario) => !RESILIENCE_SCENARIOS.includes(scenario));
    if (!options.scenarios.length || unknown.length) {
        throw new Error(`Unknown or empty resilience scenarios: ${unknown.join(', ')}`);
    }
    for (const field of [
        'evidenceTimeoutMs', 'semanticTimeoutMs', 'deadlineMs', 'settleMs',
        'correlatedOutageMs', 'recoveryTimeoutMs', 'recoveryPollMs'
    ]) {
        if (!Number.isFinite(options[field]) || options[field] < 0) {
            throw new Error(`${field} must be a non-negative number`);
        }
    }
    for (const field of ['fiscoPrimaryNode', 'fiscoSecondaryNode']) {
        if (!/^node[0-3]$/.test(options[field])) throw new Error(`${field} must be node0..node3`);
    }
    if (options.fiscoPrimaryNode === options.fiscoSecondaryNode) {
        throw new Error('FISCO primary and secondary nodes must differ');
    }
    return options;
}

async function docker(args) {
    const { stdout, stderr } = await execFileAsync('docker', args, { timeout: 30000 });
    return `${stdout || ''}${stderr || ''}`.trim();
}

async function dockerNetworks(container) {
    const text = await docker(['inspect', '--format', '{{json .NetworkSettings.Networks}}', container]);
    return JSON.parse(text);
}

async function ensureNetworkAttachment(network, container, attached) {
    const networks = await dockerNetworks(container);
    const isAttached = Boolean(networks[network]);
    if (isAttached === attached) return false;
    if (attached) await docker(['network', 'connect', network, container]);
    else await docker(['network', 'disconnect', network, container]);
    return true;
}

async function nodeState(container, node) {
    const status = await docker(['exec', container, '/opt/docker/node-control.sh', node, 'status']);
    const match = status.match(/state=([^\s]+)/);
    if (!match) throw new Error(`Cannot parse ${node} state from '${status}'`);
    return match[1];
}

async function setNodePaused(container, node, paused) {
    const state = await nodeState(container, node);
    if ((state === 'T') === paused) return false;
    await docker(['exec', container, '/opt/docker/node-control.sh', node, paused ? 'pause' : 'resume']);
    return true;
}

async function rpcBlockNumber(endpoint, timeoutMs = 3000) {
    const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
        signal: AbortSignal.timeout(timeoutMs)
    });
    if (!response.ok) throw new Error(`RPC ${endpoint} returned HTTP ${response.status}`);
    const body = await response.json();
    if (body.error) throw new Error(`RPC ${endpoint}: ${body.error.message || JSON.stringify(body.error)}`);
    const height = Number.parseInt(body.result, 16);
    if (!Number.isInteger(height) || height < 0) throw new Error(`Invalid block height '${body.result}'`);
    return height;
}

async function waitForFiscoResync({ primaryEndpoint, referenceEndpoint, timeoutMs, pollMs, readHeight = rpcBlockNumber }) {
    const started = performance.now();
    const referenceHeight = await readHeight(referenceEndpoint);
    let primaryHeight = null;
    let attempts = 0;
    let lastError = null;
    while (performance.now() - started <= timeoutMs) {
        attempts += 1;
        try {
            primaryHeight = await readHeight(primaryEndpoint);
            if (primaryHeight >= referenceHeight) {
                return {
                    synchronized: true,
                    primaryHeight,
                    referenceHeight,
                    attempts,
                    elapsedMs: Number((performance.now() - started).toFixed(3))
                };
            }
        } catch (error) {
            lastError = error;
        }
        await wait(pollMs);
    }
    return {
        synchronized: false,
        primaryHeight,
        referenceHeight,
        attempts,
        elapsedMs: Number((performance.now() - started).toFixed(3)),
        error: lastError ? lastError.message : null
    };
}

function nodeStates(result) {
    return Object.fromEntries((result.execution?.nodes || []).map((node) => [node.nodeId, {
        status: node.status,
        attempts: node.attemptCount,
        endpoint: node.endpoint,
        errorCode: node.errorCode
    }]));
}

function primaryProbeVerified(result) {
    if (result.receipt?.terminalState !== 'ANCHORED' || result.receipt?.outcome !== 'SATISFIED') return false;
    const nodes = nodeStates(result);
    return nodes.order_fabric?.endpoint === 'fabric-peer-0'
        && nodes.order_fabric?.attempts === 1
        && nodes.invoice_fabric?.endpoint === 'fabric-peer-0'
        && nodes.invoice_fabric?.attempts === 1
        && nodes.identity_fisco?.endpoint === 'fisco-node-0'
        && nodes.identity_fisco?.attempts === 1
        && nodes.logistics_fisco?.endpoint === 'fisco-node-0'
        && nodes.logistics_fisco?.attempts === 1
        && result.verification?.ok === true;
}

function failoverVerified(result, family) {
    if (result.receipt?.terminalState !== 'ANCHORED' || result.receipt?.outcome !== 'SATISFIED') return false;
    const nodes = nodeStates(result);
    const ids = family === 'fabric'
        ? ['order_fabric', 'invoice_fabric']
        : ['identity_fisco', 'logistics_fisco'];
    const endpoint = family === 'fabric' ? 'fabric-peer-1' : 'fisco-node-1';
    return ids.every((nodeId) => nodes[nodeId]?.status === 'SUCCEEDED'
        && nodes[nodeId]?.attempts === 2
        && nodes[nodeId]?.endpoint === endpoint);
}

function correlatedFailureVerified(result) {
    const nodes = nodeStates(result);
    return ['FAILED', 'INSUFFICIENT_EVIDENCE'].includes(result.receipt?.terminalState)
        && ['identity_fisco', 'logistics_fisco'].every((nodeId) =>
            nodes[nodeId]?.status !== 'SUCCEEDED' && nodes[nodeId]?.attempts === 2
        )
        && result.verification?.ok === true;
}

function materialFailureVerified(result) {
    const nodes = nodeStates(result);
    return ['FAILED', 'INSUFFICIENT_EVIDENCE'].includes(result.receipt?.terminalState)
        && nodes.quality_document?.status !== 'SUCCEEDED'
        && nodes.quality_document?.attempts === 1
        && nodes.quality_document?.errorCode === 'MATERIAL_STORE_UNAVAILABLE'
        && result.verification?.ok === true;
}

function compactResult(result) {
    return {
        queryId: result.receipt?.queryId || null,
        terminalState: result.receipt?.terminalState || null,
        outcome: result.receipt?.outcome || null,
        elapsedMs: result.execution?.elapsedMs ?? null,
        receiptRoot: result.receipt?.receiptRoot || null,
        anchorTxHash: result.anchor?.txHash || null,
        anchorBlockHeight: result.anchor?.blockHeight ?? null,
        auditVerified: result.verification?.ok === true,
        nodeStates: nodeStates(result)
    };
}

async function executeQuery(runtime, options, queryId, faultPlan = []) {
    return runtime.execute({
        queryId,
        batchId: options.batchId,
        supplierId: options.supplierId,
        orderId: options.orderId,
        faultPlan,
        evidenceTimeoutMs: options.evidenceTimeoutMs,
        semanticTimeoutMs: options.semanticTimeoutMs,
        deadlineMs: options.deadlineMs
    });
}

async function recoveryProbe(runtime, options, queryId) {
    const result = await executeQuery(runtime, options, queryId);
    return { ...compactResult(result), primaryEndpointsVerified: primaryProbeVerified(result) };
}

async function runFabricNetworkPartition(runtime, options, queryId, controlEvents) {
    const initialNetworks = await dockerNetworks(options.fabricContainer);
    if (!initialNetworks[options.fabricNetwork]) {
        throw new Error(`${options.fabricContainer} is not attached to ${options.fabricNetwork}`);
    }
    await ensureNetworkAttachment(options.fabricNetwork, options.fabricContainer, false);
    controlEvents.push({
        action: 'network_disconnect', target: options.fabricContainer,
        network: options.fabricNetwork, at: new Date().toISOString()
    });
    let result;
    try {
        await wait(options.settleMs);
        result = await executeQuery(runtime, options, queryId);
    } finally {
        await ensureNetworkAttachment(options.fabricNetwork, options.fabricContainer, true);
        controlEvents.push({
            action: 'network_connect', target: options.fabricContainer,
            network: options.fabricNetwork, at: new Date().toISOString()
        });
        await wait(options.settleMs);
    }
    const probe = await recoveryProbe(runtime, options, `${queryId}-recovery-probe`);
    return {
        result,
        probe,
        scenarioVerified: failoverVerified(result, 'fabric') && probe.primaryEndpointsVerified,
        recovery: { networkReattached: Boolean((await dockerNetworks(options.fabricContainer))[options.fabricNetwork]) }
    };
}

async function runFiscoNodeResync(runtime, options, queryId, controlEvents) {
    const beforeHeight = await rpcBlockNumber(options.fiscoPrimaryEndpoint);
    await setNodePaused(options.fiscoContainer, options.fiscoPrimaryNode, true);
    controlEvents.push({
        action: 'pause', target: `${options.fiscoContainer}:${options.fiscoPrimaryNode}`,
        at: new Date().toISOString(), beforeHeight
    });
    let result;
    try {
        await wait(options.settleMs);
        result = await executeQuery(runtime, options, queryId);
    } finally {
        await setNodePaused(options.fiscoContainer, options.fiscoPrimaryNode, false);
        controlEvents.push({
            action: 'resume', target: `${options.fiscoContainer}:${options.fiscoPrimaryNode}`,
            at: new Date().toISOString()
        });
    }
    const resync = await waitForFiscoResync({
        primaryEndpoint: options.fiscoPrimaryEndpoint,
        referenceEndpoint: options.fiscoReferenceEndpoint,
        timeoutMs: options.recoveryTimeoutMs,
        pollMs: options.recoveryPollMs
    });
    const probe = await recoveryProbe(runtime, options, `${queryId}-recovery-probe`);
    return {
        result,
        probe,
        scenarioVerified: failoverVerified(result, 'fisco') && resync.synchronized && probe.primaryEndpointsVerified,
        recovery: { beforeHeight, resync }
    };
}

async function resumeNodes(options, nodes, controlEvents) {
    for (const node of [...nodes].reverse()) {
        try {
            if (await setNodePaused(options.fiscoContainer, node, false)) {
                controlEvents.push({
                    action: 'resume', target: `${options.fiscoContainer}:${node}`,
                    at: new Date().toISOString()
                });
            }
        } catch (error) {
            controlEvents.push({
                action: 'resume_failed', target: `${options.fiscoContainer}:${node}`,
                at: new Date().toISOString(), error: error.message
            });
        }
    }
}

async function runFiscoCorrelatedPause(runtime, options, queryId, controlEvents) {
    const nodes = [options.fiscoPrimaryNode, options.fiscoSecondaryNode];
    const beforeHeight = await rpcBlockNumber(options.fiscoReferenceEndpoint);
    for (const node of nodes) {
        if (await setNodePaused(options.fiscoContainer, node, true)) {
            controlEvents.push({
                action: 'pause', target: `${options.fiscoContainer}:${node}`,
                at: new Date().toISOString(), beforeHeight
            });
        }
    }
    let settled;
    try {
        await wait(options.settleMs);
        const execution = executeQuery(runtime, options, queryId).then(
            (value) => ({ ok: true, value }),
            (error) => ({ ok: false, error })
        );
        await wait(options.correlatedOutageMs);
        await resumeNodes(options, nodes, controlEvents);
        settled = await execution;
    } finally {
        await resumeNodes(options, nodes, controlEvents);
    }
    if (!settled.ok) throw settled.error;
    const result = settled.value;
    const resync = await waitForFiscoResync({
        primaryEndpoint: options.fiscoPrimaryEndpoint,
        referenceEndpoint: options.fiscoReferenceEndpoint,
        timeoutMs: options.recoveryTimeoutMs,
        pollMs: options.recoveryPollMs
    });
    const probe = await recoveryProbe(runtime, options, `${queryId}-recovery-probe`);
    return {
        result,
        probe,
        scenarioVerified: correlatedFailureVerified(result) && resync.synchronized && probe.primaryEndpointsVerified,
        recovery: { beforeHeight, outageMs: options.correlatedOutageMs, resync }
    };
}

async function runAuditStoreOutage(runtime, options, queryId, controlEvents) {
    const originalSave = runtime.store.saveReceipt.bind(runtime.store);
    let injected = false;
    runtime.store.saveReceipt = async () => {
        injected = true;
        const error = new Error('injected audit persistence outage');
        error.code = 'SQLITE_IOERR';
        throw error;
    };
    let failure;
    try {
        await executeQuery(runtime, options, queryId);
    } catch (error) {
        failure = error;
    } finally {
        runtime.store.saveReceipt = originalSave;
    }
    if (!failure || failure.code !== 'AUDIT_PERSISTENCE_FAILED') {
        throw failure || new Error('Audit persistence outage was not observed');
    }
    controlEvents.push({
        action: 'audit_persistence_failure', target: runtime.store.dbPath,
        at: new Date().toISOString(), code: failure.cause?.code || null
    });
    await originalSave(failure.receipt, failure.anchor);
    const verification = await runtime.store.verifyStoredReceipt(queryId, failure.receipt.receiptRoot);
    const result = {
        execution: failure.execution,
        receipt: failure.receipt,
        anchor: failure.anchor,
        verification
    };
    controlEvents.push({
        action: 'audit_persistence_recovered', target: runtime.store.dbPath,
        at: new Date().toISOString()
    });
    const anchors = await runtime.store.listAnchors(queryId);
    return {
        result,
        probe: null,
        scenarioVerified: injected && verification.ok && anchors.length === 1,
        recovery: { persistenceRecovered: verification.ok, storedAnchors: anchors.length }
    };
}

async function runMaterialStoreOutage(runtime, options, queryId, controlEvents) {
    const faultPlan = [{
        id: `${queryId}-material-store-outage`,
        queryId,
        nodeId: 'quality_document',
        attempt: 1,
        candidate: 'document-store-0',
        action: 'error',
        code: 'MATERIAL_STORE_UNAVAILABLE',
        message: 'injected external material store outage',
        insufficient: true
    }];
    controlEvents.push({
        action: 'material_store_failure_injection',
        target: 'document-store-0',
        at: new Date().toISOString(),
        boundary: 'scheduler'
    });
    const result = await executeQuery(runtime, options, queryId, faultPlan);
    return {
        result,
        probe: null,
        scenarioVerified: materialFailureVerified(result),
        recovery: { conservativeTerminal: result.receipt?.terminalState || null }
    };
}

async function executeScenario(scenario, runtime, options, queryId, controlEvents) {
    if (scenario === 'fabric_network_partition') {
        return runFabricNetworkPartition(runtime, options, queryId, controlEvents);
    }
    if (scenario === 'fisco_node_resync') {
        return runFiscoNodeResync(runtime, options, queryId, controlEvents);
    }
    if (scenario === 'fisco_correlated_pause') {
        return runFiscoCorrelatedPause(runtime, options, queryId, controlEvents);
    }
    if (scenario === 'material_store_outage') {
        return runMaterialStoreOutage(runtime, options, queryId, controlEvents);
    }
    if (scenario === 'audit_store_outage') {
        return runAuditStoreOutage(runtime, options, queryId, controlEvents);
    }
    throw new Error(`Unsupported resilience scenario '${scenario}'`);
}

function summarize(rows, scenarios = RESILIENCE_SCENARIOS) {
    return Object.fromEntries(scenarios.map((scenario) => {
        const values = rows.filter((row) => row.scenario === scenario);
        const completed = values.filter((row) => !row.error);
        const latencies = completed.map((row) => row.totalMs);
        const resyncTimes = completed
            .map((row) => row.recovery?.resync?.elapsedMs)
            .filter(Number.isFinite);
        return [scenario, {
            repetitions: values.length,
            completed: completed.length,
            expectedBehavior: completed.filter((row) => row.scenarioVerified).length,
            auditVerified: completed.filter((row) => row.result?.auditVerified).length,
            recoveryProbeVerified: completed.filter((row) => row.probe?.primaryEndpointsVerified).length,
            p50Ms: latencies.length ? percentile(latencies, 0.5) : null,
            p95Ms: latencies.length ? percentile(latencies, 0.95) : null,
            resyncP95Ms: resyncTimes.length ? percentile(resyncTimes, 0.95) : null
        }];
    }));
}

function csvValue(value) {
    const text = value === null || value === undefined ? '' : String(value);
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function resultsCsv(rows) {
    const fields = [
        'scenario', 'repetition', 'queryId', 'totalMs', 'terminalState', 'outcome',
        'scenarioVerified', 'auditVerified', 'probeVerified', 'resyncMs', 'anchorBlockHeight', 'error'
    ];
    const lines = [fields.join(',')];
    for (const row of rows) {
        const values = {
            scenario: row.scenario,
            repetition: row.repetition,
            queryId: row.queryId,
            totalMs: row.totalMs,
            terminalState: row.result?.terminalState,
            outcome: row.result?.outcome,
            scenarioVerified: row.scenarioVerified,
            auditVerified: row.result?.auditVerified,
            probeVerified: row.probe?.primaryEndpointsVerified,
            resyncMs: row.recovery?.resync?.elapsedMs,
            anchorBlockHeight: row.result?.anchorBlockHeight,
            error: row.error?.message
        };
        lines.push(fields.map((field) => csvValue(values[field])).join(','));
    }
    return `${lines.join('\n')}\n`;
}

async function gitCommit() {
    try {
        const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { timeout: 5000 });
        return stdout.trim();
    } catch (_error) {
        return null;
    }
}

async function executeExperiment(options) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outputRoot = options.outDir || path.resolve(
        __dirname,
        '../../../../../docs/xn/experiments/semantic-query-live-resilience-runs',
        stamp
    );
    fs.mkdirSync(outputRoot, { recursive: true });
    const databasePath = path.join(outputRoot, 'audit.db');
    const rawPath = path.join(outputRoot, 'raw.jsonl');
    const runtime = await openLiveRuntime({ configPath: options.config, dbPath: databasePath });
    const rows = [];
    try {
        for (const scenario of options.scenarios) {
            for (let repetition = 0; repetition < options.repetitions; repetition += 1) {
                const queryId = `resilience-${stamp}-${scenario}-${repetition}`;
                const controlEvents = [];
                const started = performance.now();
                let row;
                try {
                    const outcome = await executeScenario(scenario, runtime, options, queryId, controlEvents);
                    row = {
                        scenario,
                        repetition,
                        queryId,
                        totalMs: Number((performance.now() - started).toFixed(3)),
                        scenarioVerified: outcome.scenarioVerified,
                        result: compactResult(outcome.result),
                        probe: outcome.probe,
                        recovery: outcome.recovery,
                        controlEvents,
                        error: null
                    };
                } catch (error) {
                    row = {
                        scenario,
                        repetition,
                        queryId,
                        totalMs: Number((performance.now() - started).toFixed(3)),
                        scenarioVerified: false,
                        result: null,
                        probe: null,
                        recovery: null,
                        controlEvents,
                        error: { code: error.code || 'RESILIENCE_EXPERIMENT_ERROR', message: error.message }
                    };
                }
                rows.push(row);
                fs.appendFileSync(rawPath, `${JSON.stringify(row)}\n`);
                process.stdout.write(
                    `[live-resilience] ${scenario} ${repetition + 1}/${options.repetitions}: ` +
                    `${row.scenarioVerified ? 'verified' : row.error?.code || 'unexpected'} ${row.totalMs} ms\n`
                );
            }
        }
    } finally {
        await ensureNetworkAttachment(options.fabricNetwork, options.fabricContainer, true).catch(() => {});
        await resumeNodes(options, [options.fiscoPrimaryNode, options.fiscoSecondaryNode], []).catch(() => {});
        await runtime.close();
    }

    const manifest = {
        schemaVersion: 'semantic-query-live-resilience-manifest-v1',
        generatedAt: new Date().toISOString(),
        gitCommit: await gitCommit(),
        node: process.version,
        platform: `${os.platform()} ${os.release()} ${os.arch()}`,
        cpu: os.cpus()[0]?.model || null,
        logicalCpus: os.cpus().length,
        memoryGiB: Number((os.totalmem() / (1024 ** 3)).toFixed(2)),
        scenarios: options.scenarios,
        repetitions: options.repetitions,
        scheduler: {
            evidenceTimeoutMs: options.evidenceTimeoutMs,
            semanticTimeoutMs: options.semanticTimeoutMs,
            deadlineMs: options.deadlineMs
        },
        physicalControls: {
            fabricNetwork: options.fabricNetwork,
            fabricContainer: options.fabricContainer,
            fiscoContainer: options.fiscoContainer,
            fiscoNodes: [options.fiscoPrimaryNode, options.fiscoSecondaryNode],
            correlatedOutageMs: options.correlatedOutageMs,
            recoveryTimeoutMs: options.recoveryTimeoutMs,
            recoveryPollMs: options.recoveryPollMs
        },
        chains: publicChainConfiguration(options.config),
        auditDatabase: databasePath,
        evidenceBoundary: [
            'Fabric network isolation uses docker network disconnect/connect on the primary peer',
            'FISCO node outages use SIGSTOP/SIGCONT against real node processes inside the four-node container',
            'correlated FISCO outage pauses both configured evidence endpoints and restores them before the pending anchor can commit',
            'material-store outage is a deterministic scheduler-boundary injection against the single document-store candidate; the prototype has no independently deployed material-store service',
            'audit-store outage is a deterministic fail-once persistence injection after a live FISCO anchor; recovery reuses the same receipt and anchor without a duplicate transaction',
            'all evidence reads, recovery probes, receipt anchors and successful audit writes use the live dual-chain runtime'
        ]
    };
    const summary = {
        schemaVersion: 'semantic-query-live-resilience-summary-v1',
        generatedAt: new Date().toISOString(),
        scenarioExecutions: rows.length,
        expectedBehavior: rows.filter((row) => row.scenarioVerified).length,
        failedExecutions: rows.filter((row) => row.error).length,
        storedReceipts: await new Promise((resolve, reject) => {
            const sqlite3 = require('sqlite3');
            const db = new sqlite3.Database(databasePath, sqlite3.OPEN_READONLY);
            db.get('SELECT COUNT(*) AS count FROM audit_queries', (error, result) => {
                db.close();
                if (error) reject(error);
                else resolve(result.count);
            });
        }),
        byScenario: summarize(rows, options.scenarios)
    };
    fs.writeFileSync(path.join(outputRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    fs.writeFileSync(path.join(outputRoot, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
    fs.writeFileSync(path.join(outputRoot, 'results.csv'), resultsCsv(rows));
    return { outputRoot, databasePath, summary };
}

if (require.main === module) {
    executeExperiment(parseArgs(process.argv.slice(2)))
        .then(({ outputRoot, databasePath, summary }) => {
            process.stdout.write(`${JSON.stringify({ outputRoot, databasePath, ...summary }, null, 2)}\n`);
        })
        .catch((error) => {
            process.stderr.write(`${error.stack || error}\n`);
            process.exitCode = 1;
        });
}

module.exports = {
    RESILIENCE_SCENARIOS,
    correlatedFailureVerified,
    failoverVerified,
    materialFailureVerified,
    parseArgs,
    primaryProbeVerified,
    resultsCsv,
    summarize,
    waitForFiscoResync
};
