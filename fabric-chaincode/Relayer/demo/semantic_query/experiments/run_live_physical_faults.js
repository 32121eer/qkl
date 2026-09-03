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
const PHYSICAL_SCENARIOS = Object.freeze(['fabric_peer_paused', 'fisco_node_paused']);

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
        scenarios: [...PHYSICAL_SCENARIOS],
        evidenceTimeoutMs: 1500,
        semanticTimeoutMs: 1000,
        deadlineMs: 30000,
        fabricContainer: 'peer0.org1.example.com',
        fiscoContainer: 'qkl-fisco-nodes',
        fiscoNode: 'node0',
        settleMs: 300,
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
        else if (argument === '--fisco-container') options.fiscoContainer = argv[++index];
        else if (argument === '--fisco-node') options.fiscoNode = argv[++index];
        else if (argument === '--settle-ms') options.settleMs = Number(argv[++index]);
        else if (argument === '--out') options.outDir = path.resolve(argv[++index]);
        else throw new Error(`Unknown argument '${argument}'`);
    }
    if (!Number.isInteger(options.repetitions) || options.repetitions < 1) {
        throw new Error('--repetitions must be a positive integer');
    }
    const unknown = options.scenarios.filter((scenario) => !PHYSICAL_SCENARIOS.includes(scenario));
    if (!options.scenarios.length || unknown.length) {
        throw new Error(`Unknown or empty physical scenarios: ${unknown.join(', ')}`);
    }
    for (const field of ['evidenceTimeoutMs', 'semanticTimeoutMs', 'deadlineMs', 'settleMs']) {
        if (!Number.isFinite(options[field]) || options[field] < 0) {
            throw new Error(`${field} must be a non-negative number`);
        }
    }
    if (!/^node[0-3]$/.test(options.fiscoNode)) throw new Error('--fisco-node must be node0..node3');
    return options;
}

async function docker(args) {
    const { stdout, stderr } = await execFileAsync('docker', args, { timeout: 30000 });
    return `${stdout || ''}${stderr || ''}`.trim();
}

async function assertContainerReady(container, { requireUnpaused = true } = {}) {
    const state = await docker(['inspect', '--format', '{{.State.Running}} {{.State.Paused}}', container]);
    const [running, paused] = state.split(/\s+/);
    if (running !== 'true') throw new Error(`Container '${container}' is not running`);
    if (requireUnpaused && paused === 'true') throw new Error(`Container '${container}' is already paused`);
    return { running: true, paused: paused === 'true' };
}

async function withPhysicalFault(scenario, options, handler) {
    const control = [];
    if (scenario === 'fabric_peer_paused') {
        await assertContainerReady(options.fabricContainer);
        const pausedAt = new Date().toISOString();
        control.push({ action: 'pause', target: options.fabricContainer, at: pausedAt });
        await docker(['pause', options.fabricContainer]);
        try {
            await wait(options.settleMs);
            return await handler(control);
        } finally {
            await docker(['unpause', options.fabricContainer]);
            control.push({ action: 'resume', target: options.fabricContainer, at: new Date().toISOString() });
        }
    }
    if (scenario === 'fisco_node_paused') {
        await assertContainerReady(options.fiscoContainer);
        const status = await docker([
            'exec', options.fiscoContainer, '/opt/docker/node-control.sh', options.fiscoNode, 'status'
        ]);
        if (/state=T/.test(status)) throw new Error(`${options.fiscoNode} is already paused`);
        await docker(['exec', options.fiscoContainer, '/opt/docker/node-control.sh', options.fiscoNode, 'pause']);
        control.push({ action: 'pause', target: `${options.fiscoContainer}:${options.fiscoNode}`, at: new Date().toISOString() });
        try {
            await wait(options.settleMs);
            return await handler(control);
        } finally {
            await docker(['exec', options.fiscoContainer, '/opt/docker/node-control.sh', options.fiscoNode, 'resume']);
            control.push({
                action: 'resume',
                target: `${options.fiscoContainer}:${options.fiscoNode}`,
                at: new Date().toISOString()
            });
        }
    }
    throw new Error(`Unsupported physical scenario '${scenario}'`);
}

function expectedPhysicalFailover(scenario, result) {
    if (result.receipt?.terminalState !== 'ANCHORED' || result.receipt?.outcome !== 'SATISFIED') return false;
    const nodes = Object.fromEntries(result.execution.nodes.map((node) => [node.nodeId, node]));
    if (scenario === 'fabric_peer_paused') {
        return ['order_fabric', 'invoice_fabric'].every((nodeId) =>
            nodes[nodeId]?.status === 'SUCCEEDED' &&
            nodes[nodeId]?.attemptCount === 2 &&
            nodes[nodeId]?.endpoint === 'fabric-peer-1'
        );
    }
    if (scenario === 'fisco_node_paused') {
        return ['identity_fisco', 'logistics_fisco'].every((nodeId) =>
            nodes[nodeId]?.status === 'SUCCEEDED' &&
            nodes[nodeId]?.attemptCount === 2 &&
            nodes[nodeId]?.endpoint === 'fisco-node-1'
        );
    }
    return false;
}

function summarize(rows) {
    return Object.fromEntries(PHYSICAL_SCENARIOS.map((scenario) => {
        const values = rows.filter((row) => row.scenario === scenario);
        const completed = values.filter((row) => !row.error);
        const latencies = completed.map((row) => row.totalMs);
        return [scenario, {
            queries: values.length,
            completed: completed.length,
            physicalFailoverVerified: completed.filter((row) => row.physicalFailoverVerified).length,
            auditVerified: completed.filter((row) => row.auditVerified).length,
            meanMs: latencies.length
                ? Number((latencies.reduce((sum, value) => sum + value, 0) / latencies.length).toFixed(3))
                : null,
            p50Ms: percentile(latencies, 0.5),
            p95Ms: percentile(latencies, 0.95),
            meanRetries: completed.length
                ? Number((completed.reduce((sum, row) => sum + row.retryCount, 0) / completed.length).toFixed(3))
                : null
        }];
    }));
}

async function executeExperiment(options) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outputRoot = options.outDir || path.resolve(
        __dirname,
        '../../../../../docs/xn/experiments/semantic-query-physical-fault-runs',
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
                const queryId = `physical-${stamp}-${scenario}-${repetition}`;
                const started = performance.now();
                let controlEvents = [];
                let row;
                try {
                    const result = await withPhysicalFault(scenario, options, async (events) => {
                        controlEvents = events;
                        return runtime.execute({
                            queryId,
                            batchId: options.batchId,
                            supplierId: options.supplierId,
                            orderId: options.orderId,
                            evidenceTimeoutMs: options.evidenceTimeoutMs,
                            semanticTimeoutMs: options.semanticTimeoutMs,
                            deadlineMs: options.deadlineMs
                        });
                    });
                    const totalMs = Number((performance.now() - started).toFixed(3));
                    const retryCount = result.execution.nodes.reduce(
                        (sum, node) => sum + Math.max(0, node.attemptCount - 1),
                        0
                    );
                    row = {
                        scenario,
                        repetition,
                        queryId,
                        terminalState: result.receipt.terminalState,
                        outcome: result.receipt.outcome,
                        totalMs,
                        executionMs: result.execution.elapsedMs,
                        retryCount,
                        physicalFailoverVerified: expectedPhysicalFailover(scenario, result),
                        auditVerified: result.verification.ok,
                        receiptRoot: result.receipt.receiptRoot,
                        anchorTxHash: result.anchor.txHash,
                        anchorBlockHeight: result.anchor.blockHeight,
                        nodeStates: Object.fromEntries(result.execution.nodes.map((node) => [node.nodeId, {
                            status: node.status,
                            attempts: node.attemptCount,
                            endpoint: node.endpoint,
                            errorCode: node.errorCode
                        }])),
                        controlEvents,
                        error: null
                    };
                } catch (error) {
                    row = {
                        scenario,
                        repetition,
                        queryId,
                        totalMs: Number((performance.now() - started).toFixed(3)),
                        physicalFailoverVerified: false,
                        auditVerified: false,
                        controlEvents,
                        error: { code: error.code || 'PHYSICAL_EXPERIMENT_ERROR', message: error.message }
                    };
                }
                rows.push(row);
                fs.appendFileSync(rawPath, `${JSON.stringify(row)}\n`);
                process.stdout.write(
                    `[physical-fault] ${scenario} ${repetition + 1}/${options.repetitions}: ` +
                    `${row.terminalState || row.error?.code} ${row.totalMs} ms\n`
                );
            }
        }
    } finally {
        await runtime.close();
    }

    const manifest = {
        schemaVersion: 'semantic-query-physical-fault-manifest-v1',
        generatedAt: new Date().toISOString(),
        node: process.version,
        platform: `${os.platform()} ${os.release()} ${os.arch()}`,
        scenarios: options.scenarios,
        repetitions: options.repetitions,
        timeoutMs: options.evidenceTimeoutMs,
        targets: {
            fabric: options.fabricContainer,
            fisco: `${options.fiscoContainer}:${options.fiscoNode}`
        },
        chains: publicChainConfiguration(options.config),
        evidenceBoundary: [
            'target peer or node process is physically paused and resumed through Docker',
            'no scheduler fault plan is used',
            'alternate endpoint reads, audit persistence and FISCO receipt anchoring are live'
        ]
    };
    const summary = {
        schemaVersion: 'semantic-query-physical-fault-summary-v1',
        generatedAt: new Date().toISOString(),
        totalQueries: rows.length,
        physicalFailoverVerified: rows.filter((row) => row.physicalFailoverVerified).length,
        auditVerified: rows.filter((row) => row.auditVerified).length,
        byScenario: summarize(rows)
    };
    fs.writeFileSync(path.join(outputRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    fs.writeFileSync(path.join(outputRoot, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
    return { outputRoot, summary };
}

if (require.main === module) {
    executeExperiment(parseArgs(process.argv.slice(2)))
        .then(({ outputRoot, summary }) => {
            process.stdout.write(`${JSON.stringify({ outputRoot, ...summary }, null, 2)}\n`);
        })
        .catch((error) => {
            process.stderr.write(`${error.stack || error}\n`);
            process.exitCode = 1;
        });
}

module.exports = {
    PHYSICAL_SCENARIOS,
    assertContainerReady,
    executeExperiment,
    expectedPhysicalFailover,
    parseArgs,
    summarize,
    withPhysicalFault
};
