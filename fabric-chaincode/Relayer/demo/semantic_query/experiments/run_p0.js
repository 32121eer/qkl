#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const { DagScheduler } = require('../dag_scheduler');
const { FaultInjector } = require('../fault_injector');
const { buildAuditReceipt, hashValue } = require('../audit_receipt');
const { SemanticAuditStore } = require('../audit_store');
const { createSupplyFinanceDag } = require('../supply_finance_workload');
const { LocalReceiptAnchor } = require('../receipt_anchor');

const BASE_SEED = 20260824;

function parseArgs(argv) {
    const options = { runs: 5, queries: 20, outDir: null };
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        if (argument === '--quick') {
            options.runs = 1;
            options.queries = 2;
        } else if (argument === '--runs') options.runs = Number(argv[++index]);
        else if (argument === '--queries') options.queries = Number(argv[++index]);
        else if (argument === '--out') options.outDir = path.resolve(argv[++index]);
        else throw new Error(`Unknown argument '${argument}'`);
    }
    if (!Number.isInteger(options.runs) || options.runs < 1) throw new Error('--runs must be a positive integer');
    if (!Number.isInteger(options.queries) || options.queries < 1) throw new Error('--queries must be a positive integer');
    return options;
}

function scenarioPlan(name, queryId) {
    if (name === 'normal') return [];
    if (name === 'single_endpoint_down') {
        return [{
            queryId, nodeId: 'order_fabric', attempt: 1, candidate: 'fabric-peer-0',
            action: 'error', code: 'ENDPOINT_UNAVAILABLE', recoverable: true
        }];
    }
    if (name === 'double_endpoint_down') {
        return [
            {
                queryId, nodeId: 'order_fabric', attempt: 1, candidate: 'fabric-peer-0',
                action: 'error', code: 'ENDPOINT_UNAVAILABLE', recoverable: true
            },
            {
                queryId, nodeId: 'order_fabric', attempt: 2, candidate: 'fabric-peer-1',
                action: 'error', code: 'ENDPOINT_UNAVAILABLE', recoverable: true
            }
        ];
    }
    if (name === 'index_lag') {
        return [{
            queryId, nodeId: 'logistics_fisco', attempt: 1, candidate: 'fisco-node-0',
            action: 'error', code: 'INDEX_LAG', recoverable: true
        }];
    }
    if (name === 'service_timeout') {
        return [{ queryId, nodeId: 'quality_semantic', attempt: 1, action: 'timeout', delayMs: 150 }];
    }
    if (name === 'wrong_input_root') {
        return [{
            queryId, nodeId: 'quality_semantic', attempt: 1, action: 'mutate',
            mutate: (result) => ({ ...result, inputRoot: hashValue('wrong-input-root') })
        }];
    }
    if (name === 'expired_evidence') {
        return [{
            queryId, nodeId: 'order_fabric', attempt: 1, action: 'mutate',
            mutate: (result) => ({ ...result, validUntil: '2000-01-01T00:00:00.000Z' })
        }];
    }
    if (name === 'missing_field') {
        return [{
            queryId, nodeId: 'invoice_fabric', attempt: 1, action: 'mutate',
            mutate: (result) => {
                const copy = { ...result };
                delete copy.amount;
                return copy;
            }
        }];
    }
    if (name === 'correlated_disagreement') {
        return [1, 2].map((attempt) => ({
            queryId, nodeId: 'quality_semantic', attempt, action: 'mutate',
            mutate: (result) => ({ ...result, value: { ...result.value, disagreement: true } })
        }));
    }
    throw new Error(`Unknown experiment scenario '${name}'`);
}

function gitCommit() {
    try {
        return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
            cwd: path.resolve(__dirname, '../../../../..')
        }).toString().trim();
    } catch (_error) {
        return 'unknown';
    }
}

function percentile(values, fraction) {
    if (!values.length) return null;
    const sorted = values.slice().sort((left, right) => left - right);
    const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1);
    return Number(sorted[index].toFixed(3));
}

function makeEvidence(result) {
    return Object.entries(result.outputs)
        .filter(([nodeId]) => result.nodes.find((node) => node.nodeId === nodeId)?.kind === 'evidence')
        .map(([nodeId, value]) => {
            const captured = result.artifacts?.[nodeId]?.evidence;
            if (captured) return { ...captured, nodeId };
            return {
                evidenceId: hashValue({ queryId: result.queryId, nodeId, payloadHash: hashValue(value) }),
                queryId: result.queryId,
                nodeId,
                payloadHash: hashValue(value),
                storageRef: `sqlite://${result.queryId}/evidence/${nodeId}`,
                sourceType: nodeId.split('_').slice(-1)[0]
            };
        });
}

function makeServiceOutputs(result) {
    const captured = Object.entries(result.artifacts || {})
        .filter(([, artifact]) => artifact.serviceOutput)
        .map(([nodeId, artifact]) => ({
            ...artifact.serviceOutput,
            nodeId,
            outputHash: artifact.serviceOutput.outputHash || hashValue(artifact.serviceOutput)
        }));
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

function summarize(rows) {
    const byScenario = {};
    for (const row of rows) {
        if (!byScenario[row.scenario]) byScenario[row.scenario] = [];
        byScenario[row.scenario].push(row);
    }
    return Object.fromEntries(Object.entries(byScenario).map(([scenario, values]) => {
        const elapsed = values.map((row) => row.elapsedMs);
        const correct = values.filter((row) => row.expectedBehavior).length;
        return [scenario, {
            queries: values.length,
            correctBehavior: correct,
            correctBehaviorRate: Number((correct / values.length).toFixed(4)),
            auditVerified: values.filter((row) => row.auditVerified).length,
            tamperDetected: values.filter((row) => row.tamperDetected).length,
            p50Ms: percentile(elapsed, 0.5),
            p95Ms: percentile(elapsed, 0.95),
            p99Ms: percentile(elapsed, 0.99),
            meanRetries: Number((values.reduce((sum, row) => sum + row.retryCount, 0) / values.length).toFixed(3))
        }];
    }));
}

function expectedBehavior(scenario, result) {
    if (['double_endpoint_down', 'missing_field', 'correlated_disagreement'].includes(scenario)) {
        return ['FAILED', 'INSUFFICIENT_EVIDENCE'].includes(result.terminalState);
    }
    return result.terminalState === 'READY_TO_ANCHOR' && result.outcome === 'SATISFIED';
}

async function executeExperiment(options) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outputRoot = options.outDir || path.resolve(
        __dirname,
        '../../../../../docs/xn/experiments/semantic-query-runs',
        stamp
    );
    fs.mkdirSync(outputRoot, { recursive: true });
    const rawPath = path.join(outputRoot, 'raw.jsonl');
    const databasePath = path.join(outputRoot, 'audit.db');
    const store = new SemanticAuditStore({ dbPath: databasePath });
    const anchorer = new LocalReceiptAnchor();
    const scenarios = [
        'normal', 'single_endpoint_down', 'double_endpoint_down', 'index_lag', 'expired_evidence',
        'missing_field', 'wrong_input_root', 'service_timeout', 'correlated_disagreement'
    ];
    const manifest = {
        schemaVersion: 'semantic-query-experiment-manifest-v1',
        generatedAt: new Date().toISOString(),
        gitCommit: gitCommit(),
        baseSeed: BASE_SEED,
        node: process.version,
        platform: `${os.platform()} ${os.release()} ${os.arch()}`,
        cpu: os.cpus()[0]?.model || 'unknown',
        logicalCpus: os.cpus().length,
        memoryGiB: Number((os.totalmem() / (1024 ** 3)).toFixed(1)),
        runs: options.runs,
        queriesPerScenarioPerRun: options.queries,
        scenarios,
        scheduler: { concurrency: 4, defaultTimeoutMs: 100, deadlineMs: 1000 },
        workload: { name: 'supply-chain-financing', dagVersion: 'supply-finance-dag-v1', nodes: 10 },
        anchorMode: 'local-test-anchor',
        evidenceBoundary: [
            'real hashing, DAG execution, SQLite persistence, mutation detection and bounded retries',
            'local deterministic adapters and semantic service; no live Fabric/FISCO outage',
            'local test anchor only; not an on-chain transaction measurement'
        ]
    };
    fs.writeFileSync(path.join(outputRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

    const rows = [];
    try {
        for (let run = 0; run < options.runs; run += 1) {
            for (const scenario of scenarios) {
                for (let queryIndex = 0; queryIndex < options.queries; queryIndex += 1) {
                    const queryId = `sq-${BASE_SEED}-${run}-${scenario}-${queryIndex}`;
                    const injector = new FaultInjector(scenarioPlan(scenario, queryId));
                    const scheduler = new DagScheduler({
                        concurrency: 4,
                        defaultTimeoutMs: 100,
                        deadlineMs: 1000,
                        faultInjector: injector
                    });
                    const started = performance.now();
                    const result = await scheduler.execute({
                        queryId,
                        nodes: createSupplyFinanceDag(),
                        rootNodeId: 'financing_root'
                    });
                    const elapsedMs = performance.now() - started;
                    const terminalState = result.terminalState === 'READY_TO_ANCHOR'
                        ? 'ANCHORED'
                        : result.terminalState;
                    const receipt = buildAuditReceipt({
                        queryId,
                        queryDigest: hashValue({ workload: 'supply-chain-financing', queryIndex }),
                        dagVersion: 'supply-finance-dag-v1',
                        rootNodeId: 'financing_root',
                        terminalState,
                        outcome: result.outcome,
                        nodes: result.nodes,
                        evidence: makeEvidence(result),
                        serviceOutputs: makeServiceOutputs(result),
                        recoveries: injector.applied,
                        events: result.events,
                        startedAt: result.startedAt,
                        completedAt: result.completedAt
                    });
                    const anchor = await anchorer.anchor(receipt);
                    await store.saveReceipt(receipt, anchor);
                    const verified = await store.verifyStoredReceipt(queryId, receipt.receiptRoot);
                    const tampered = await store.loadReceipt(queryId);
                    const target = tampered.nodes.find((node) => node.status === 'SUCCEEDED') || tampered.nodes[0];
                    target.outputHash = hashValue(`tampered:${queryId}`);
                    const { verifyAuditReceipt } = require('../audit_receipt');
                    const tamperCheck = verifyAuditReceipt(tampered, { anchoredRoot: receipt.receiptRoot });
                    const retryCount = result.nodes.reduce((sum, node) => sum + Math.max(0, node.attemptCount - 1), 0);
                    const row = {
                        run,
                        queryIndex,
                        queryId,
                        scenario,
                        seed: BASE_SEED + run,
                        terminalState,
                        outcome: result.outcome,
                        elapsedMs: Number(elapsedMs.toFixed(3)),
                        retryCount,
                        remoteRequestAttempts: result.nodes
                            .filter((node) => ['evidence', 'semantic'].includes(node.kind))
                            .reduce((sum, node) => sum + node.attemptCount, 0),
                        receiptBytes: Buffer.byteLength(JSON.stringify(receipt)),
                        receiptRoot: receipt.receiptRoot,
                        auditVerified: verified.ok,
                        tamperDetected: !tamperCheck.ok,
                        expectedBehavior: expectedBehavior(scenario, result),
                        appliedFaults: injector.applied,
                        nodeStates: Object.fromEntries(result.nodes.map((node) => [node.nodeId, node.status]))
                    };
                    rows.push(row);
                    fs.appendFileSync(rawPath, `${JSON.stringify(row)}\n`);
                }
            }
        }
        const summary = {
            manifest: path.basename(path.join(outputRoot, 'manifest.json')),
            raw: path.basename(rawPath),
            totalQueries: rows.length,
            byScenario: summarize(rows)
        };
        fs.writeFileSync(path.join(outputRoot, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
        return { outputRoot, summary };
    } finally {
        await store.close();
    }
}

if (require.main === module) {
    executeExperiment(parseArgs(process.argv.slice(2)))
        .then(({ outputRoot, summary }) => {
            process.stdout.write(`${JSON.stringify({ outputRoot, totalQueries: summary.totalQueries }, null, 2)}\n`);
        })
        .catch((error) => {
            process.stderr.write(`${error.stack || error}\n`);
            process.exitCode = 1;
        });
}

module.exports = { parseArgs, scenarioPlan, executeExperiment };
