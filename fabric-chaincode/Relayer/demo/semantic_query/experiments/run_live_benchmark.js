#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const { openLiveRuntime } = require('./live_runtime');

const DEFAULT_SCENARIOS = Object.freeze([
    'normal',
    'fabric_endpoint_retry',
    'fisco_endpoint_retry',
    'semantic_service_timeout',
    'fabric_endpoint_exhausted',
    'semantic_disagreement'
]);

function parseArgs(argv) {
    const options = {
        config: path.resolve(__dirname, '../../../config.json'),
        batchId: 'BATCH-FINANCE-001',
        supplierId: 'SUPPLIER-001',
        orderId: 'ORDER-001',
        runs: 3,
        queries: 5,
        warmup: 1,
        queryConcurrency: 1,
        anchorWallets: 1,
        scenarios: [...DEFAULT_SCENARIOS],
        evidenceTimeoutMs: 10000,
        semanticTimeoutMs: 250,
        deadlineMs: 60000,
        outDir: null
    };
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        if (argument === '--quick') {
            options.runs = 1;
            options.queries = 1;
            options.warmup = 0;
        } else if (argument === '--config') options.config = path.resolve(argv[++index]);
        else if (argument === '--batch') options.batchId = argv[++index];
        else if (argument === '--supplier') options.supplierId = argv[++index];
        else if (argument === '--order') options.orderId = argv[++index];
        else if (argument === '--runs') options.runs = Number(argv[++index]);
        else if (argument === '--queries') options.queries = Number(argv[++index]);
        else if (argument === '--warmup') options.warmup = Number(argv[++index]);
        else if (argument === '--query-concurrency') options.queryConcurrency = Number(argv[++index]);
        else if (argument === '--anchor-wallets') options.anchorWallets = Number(argv[++index]);
        else if (argument === '--scenarios') options.scenarios = argv[++index].split(',').filter(Boolean);
        else if (argument === '--evidence-timeout') options.evidenceTimeoutMs = Number(argv[++index]);
        else if (argument === '--semantic-timeout') options.semanticTimeoutMs = Number(argv[++index]);
        else if (argument === '--deadline') options.deadlineMs = Number(argv[++index]);
        else if (argument === '--out') options.outDir = path.resolve(argv[++index]);
        else throw new Error(`Unknown argument '${argument}'`);
    }

    for (const field of ['runs', 'queries', 'queryConcurrency', 'anchorWallets']) {
        if (!Number.isInteger(options[field]) || options[field] < 1) {
            throw new Error(`--${field} must be a positive integer`);
        }
    }
    if (!Number.isInteger(options.warmup) || options.warmup < 0) {
        throw new Error('--warmup must be a non-negative integer');
    }
    for (const field of ['evidenceTimeoutMs', 'semanticTimeoutMs', 'deadlineMs']) {
        if (!Number.isFinite(options[field]) || options[field] < 1) {
            throw new Error(`${field} must be a positive number`);
        }
    }
    if (!options.scenarios.length) throw new Error('--scenarios must not be empty');
    const unknown = options.scenarios.filter((scenario) => !DEFAULT_SCENARIOS.includes(scenario));
    if (unknown.length) throw new Error(`Unknown scenarios: ${unknown.join(', ')}`);
    return options;
}

function scenarioPlan(scenario, queryId, { semanticTimeoutMs }) {
    if (scenario === 'normal') return [];
    if (scenario === 'fabric_endpoint_retry') {
        return [{
            queryId,
            nodeId: 'order_fabric',
            attempt: 1,
            candidate: 'fabric-peer-0',
            action: 'error',
            code: 'ENDPOINT_UNAVAILABLE',
            recoverable: true
        }];
    }
    if (scenario === 'fisco_endpoint_retry') {
        return [{
            queryId,
            nodeId: 'logistics_fisco',
            attempt: 1,
            candidate: 'fisco-node-0',
            action: 'error',
            code: 'ENDPOINT_UNAVAILABLE',
            recoverable: true
        }];
    }
    if (scenario === 'semantic_service_timeout') {
        return [{
            queryId,
            nodeId: 'quality_semantic',
            attempt: 1,
            candidate: 'local-semantic-a',
            action: 'timeout',
            delayMs: semanticTimeoutMs + 100
        }];
    }
    if (scenario === 'fabric_endpoint_exhausted') {
        return [
            {
                queryId,
                nodeId: 'order_fabric',
                attempt: 1,
                candidate: 'fabric-peer-0',
                action: 'error',
                code: 'ENDPOINT_UNAVAILABLE',
                recoverable: true
            },
            {
                queryId,
                nodeId: 'order_fabric',
                attempt: 2,
                candidate: 'fabric-peer-1',
                action: 'error',
                code: 'ENDPOINT_UNAVAILABLE',
                recoverable: true
            }
        ];
    }
    if (scenario === 'semantic_disagreement') {
        return [1, 2].map((attempt) => ({
            queryId,
            nodeId: 'quality_semantic',
            attempt,
            action: 'mutate',
            mutate: (result) => ({
                ...result,
                value: { ...result.value, disagreement: true }
            })
        }));
    }
    throw new Error(`Unsupported scenario '${scenario}'`);
}

function expectedBehavior(scenario, receipt) {
    if (scenario === 'fabric_endpoint_exhausted') {
        return receipt.terminalState === 'FAILED' && receipt.outcome === null;
    }
    if (scenario === 'semantic_disagreement') {
        return receipt.terminalState === 'INSUFFICIENT_EVIDENCE' && receipt.outcome === 'INSUFFICIENT';
    }
    return receipt.terminalState === 'ANCHORED' && receipt.outcome === 'SATISFIED';
}

function percentile(values, quantile) {
    if (!values.length) return null;
    const sorted = [...values].sort((left, right) => left - right);
    const position = (sorted.length - 1) * quantile;
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    const value = lower === upper
        ? sorted[lower]
        : sorted[lower] + ((sorted[upper] - sorted[lower]) * (position - lower));
    return Number(value.toFixed(3));
}

function mean(values) {
    if (!values.length) return null;
    return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(3));
}

function summarize(rows) {
    const grouped = {};
    for (const row of rows) {
        if (!grouped[row.scenario]) grouped[row.scenario] = [];
        grouped[row.scenario].push(row);
    }
    return Object.fromEntries(Object.entries(grouped).map(([scenario, values]) => {
        const completed = values.filter((row) => !row.error);
        const totalMs = completed.map((row) => row.totalMs);
        const executionMs = completed.map((row) => row.executionMs);
        const anchorAndPersistenceMs = completed.map((row) => row.anchorAndPersistenceMs);
        return [scenario, {
            queries: values.length,
            completed: completed.length,
            expectedBehavior: values.filter((row) => row.expectedBehavior).length,
            expectedBehaviorRate: Number((values.filter((row) => row.expectedBehavior).length / values.length).toFixed(4)),
            auditVerified: completed.filter((row) => row.auditVerified).length,
            terminalStates: completed.reduce((states, row) => {
                states[row.terminalState] = (states[row.terminalState] || 0) + 1;
                return states;
            }, {}),
            totalLatencyMs: {
                mean: mean(totalMs),
                p50: percentile(totalMs, 0.5),
                p95: percentile(totalMs, 0.95),
                p99: percentile(totalMs, 0.99)
            },
            executionLatencyMs: {
                mean: mean(executionMs),
                p50: percentile(executionMs, 0.5),
                p95: percentile(executionMs, 0.95)
            },
            anchorAndPersistenceMs: {
                mean: mean(anchorAndPersistenceMs),
                p50: percentile(anchorAndPersistenceMs, 0.5),
                p95: percentile(anchorAndPersistenceMs, 0.95)
            },
            meanRetries: mean(completed.map((row) => row.retryCount)),
            meanReceiptBytes: mean(completed.map((row) => row.receiptBytes)),
            anchorQueueWaitMs: {
                mean: mean(completed.map((row) => row.anchorQueueWaitMs).filter(Number.isFinite)),
                p95: percentile(completed.map((row) => row.anchorQueueWaitMs).filter(Number.isFinite), 0.95)
            },
            anchorServiceMs: {
                mean: mean(completed.map((row) => row.anchorServiceMs).filter(Number.isFinite)),
                p95: percentile(completed.map((row) => row.anchorServiceMs).filter(Number.isFinite), 0.95)
            }
        }];
    }));
}

function gitCommit() {
    try {
        return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    } catch (_error) {
        return null;
    }
}

function publicChainConfiguration(configPath) {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return (config.chains || []).filter((chain) => chain.enabled).map((chain) => ({
        chainId: chain.chainId,
        type: chain.type,
        endpoint: chain.rpc?.endpoint || chain.connection?.peerEndpoint || null,
        evidenceEndpoints: chain.rpc?.evidenceEndpoints || chain.connection?.evidenceEndpoints || {},
        channelName: chain.connection?.channelName || null,
        contracts: chain.contracts || {}
    }));
}

async function readHeight(monitor) {
    try {
        if (monitor?.provider && typeof monitor.provider.send === 'function') {
            const raw = await monitor.provider.send('eth_blockNumber', []);
            return Number(BigInt(raw));
        }
        const height = await monitor?.getLatestBlockNumber?.();
        return height === null || height === undefined ? null : Number(height);
    } catch (_error) {
        return null;
    }
}

function csvCell(value) {
    if (value === null || value === undefined) return '';
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function writeCsv(filePath, rows) {
    const fields = [
        'run', 'queryIndex', 'queryId', 'scenario', 'terminalState', 'outcome',
        'totalMs', 'executionMs', 'anchorAndPersistenceMs', 'anchorQueueWaitMs', 'anchorServiceMs', 'retryCount',
        'remoteRequestAttempts', 'receiptBytes', 'receiptRoot', 'anchorTxHash',
        'anchorBlockHeight', 'anchorPoolIndex', 'anchorSigner',
        'auditVerified', 'expectedBehavior', 'appliedFaults', 'error'
    ];
    const lines = [fields.join(',')];
    for (const row of rows) lines.push(fields.map((field) => csvCell(row[field])).join(','));
    fs.writeFileSync(filePath, `${lines.join('\n')}\n`);
}

async function executeOne(runtime, options, { run, queryIndex, scenario, queryId }) {
    const started = performance.now();
    try {
        const result = await runtime.execute({
            queryId,
            batchId: options.batchId,
            supplierId: options.supplierId,
            orderId: options.orderId,
            faultPlan: scenarioPlan(scenario, queryId, options),
            evidenceTimeoutMs: options.evidenceTimeoutMs,
            semanticTimeoutMs: options.semanticTimeoutMs,
            deadlineMs: options.deadlineMs
        });
        const totalMs = Number((performance.now() - started).toFixed(3));
        const executionMs = result.execution.elapsedMs;
        const retryCount = result.execution.nodes.reduce(
            (sum, node) => sum + Math.max(0, node.attemptCount - 1),
            0
        );
        return {
            run,
            queryIndex,
            queryId,
            scenario,
            terminalState: result.receipt.terminalState,
            outcome: result.receipt.outcome,
            totalMs,
            executionMs,
            anchorAndPersistenceMs: Number(Math.max(0, totalMs - executionMs).toFixed(3)),
            anchorQueueWaitMs: Number((result.anchor.queueWaitMs || 0).toFixed(3)),
            anchorServiceMs: Number((result.anchor.serviceMs || 0).toFixed(3)),
            retryCount,
            remoteRequestAttempts: result.execution.nodes
                .filter((node) => ['evidence', 'semantic'].includes(node.kind))
                .reduce((sum, node) => sum + node.attemptCount, 0),
            receiptBytes: Buffer.byteLength(JSON.stringify(result.receipt)),
            receiptRoot: result.receipt.receiptRoot,
            anchorTxHash: result.anchor.txHash,
            anchorBlockHeight: result.anchor.blockHeight,
            anchorPoolIndex: result.anchor.anchorPoolIndex ?? 0,
            anchorSigner: result.anchor.anchorSigner || null,
            auditVerified: result.verification.ok,
            expectedBehavior: expectedBehavior(scenario, result.receipt),
            appliedFaults: result.appliedFaults,
            nodeStates: Object.fromEntries(result.execution.nodes.map((node) => [node.nodeId, node.status])),
            error: null
        };
    } catch (error) {
        return {
            run,
            queryIndex,
            queryId,
            scenario,
            totalMs: Number((performance.now() - started).toFixed(3)),
            auditVerified: false,
            expectedBehavior: false,
            appliedFaults: [],
            error: { code: error.code || 'UNEXPECTED_ERROR', message: error.message }
        };
    }
}

async function runBounded(items, concurrency, operation) {
    let cursor = 0;
    const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
        while (cursor < items.length) {
            const index = cursor;
            cursor += 1;
            await operation(items[index], index);
        }
    });
    await Promise.all(workers);
}

async function executeExperiment(options) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outputRoot = options.outDir || path.resolve(
        __dirname,
        '../../../../../docs/xn/experiments/semantic-query-live-runs',
        stamp
    );
    fs.mkdirSync(outputRoot, { recursive: true });
    const rawPath = path.join(outputRoot, 'raw.jsonl');
    const csvPath = path.join(outputRoot, 'results.csv');
    const databasePath = path.join(outputRoot, 'audit.db');
    const manifestPath = path.join(outputRoot, 'manifest.json');
    const summaryPath = path.join(outputRoot, 'summary.json');
    const manifest = {
        schemaVersion: 'semantic-query-live-experiment-manifest-v1',
        generatedAt: new Date().toISOString(),
        gitCommit: gitCommit(),
        node: process.version,
        platform: `${os.platform()} ${os.release()} ${os.arch()}`,
        cpu: os.cpus()[0]?.model || 'unknown',
        logicalCpus: os.cpus().length,
        memoryGiB: Number((os.totalmem() / (1024 ** 3)).toFixed(1)),
        runs: options.runs,
        queriesPerScenarioPerRun: options.queries,
        warmupQueries: options.warmup,
        scenarios: options.scenarios,
        workload: {
            name: 'supply-chain-financing',
            dagVersion: 'supply-finance-dag-v1',
            nodes: 10,
            batchId: options.batchId,
            supplierId: options.supplierId,
            orderId: options.orderId
        },
        scheduler: {
            concurrency: 4,
            queryConcurrency: options.queryConcurrency,
            evidenceTimeoutMs: options.evidenceTimeoutMs,
            semanticTimeoutMs: options.semanticTimeoutMs,
            deadlineMs: options.deadlineMs
        },
        chains: publicChainConfiguration(options.config),
        evidenceBoundary: [
            'Fabric gateway reads, FISCO contract reads, receipt anchoring and SQLite audit persistence are live',
            'failure scenarios are deterministic scheduler-boundary injections, not physical host outages',
            'semantic service is the deterministic local service used by the P0 implementation'
        ]
    };

    const runtime = await openLiveRuntime({
        configPath: options.config,
        dbPath: databasePath,
        anchorWalletCount: options.anchorWallets
    });
    manifest.anchoring = {
        walletCount: options.anchorWallets,
        signerAddresses: runtime.receiptAnchor.signerAddresses || [runtime.fiscoMonitor.wallet.address],
        assignment: options.anchorWallets === 1 ? 'single-wallet-serialized' : 'round-robin-per-wallet-serialized'
    };
    manifest.initialLedgerHeights = {
        fabric: await readHeight(runtime.fabricMonitor),
        fisco: await readHeight(runtime.fiscoMonitor)
    };
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const rows = [];
    const experimentStarted = performance.now();
    let finalLedgerHeights = { fabric: null, fisco: null };
    try {
        for (let index = 0; index < options.warmup; index += 1) {
            const queryId = `livebench-${stamp}-warmup-${index}`;
            const warmup = await executeOne(runtime, options, {
                run: -1,
                queryIndex: index,
                scenario: 'normal',
                queryId
            });
            if (warmup.error || !warmup.expectedBehavior) {
                throw new Error(`Warmup query failed: ${JSON.stringify(warmup.error || warmup)}`);
            }
        }

        for (let run = 0; run < options.runs; run += 1) {
            for (const scenario of options.scenarios) {
                const queryIndexes = Array.from({ length: options.queries }, (_, index) => index);
                await runBounded(queryIndexes, options.queryConcurrency, async (queryIndex) => {
                    const queryId = `livebench-${stamp}-${run}-${scenario}-${queryIndex}`;
                    const row = await executeOne(runtime, options, { run, queryIndex, scenario, queryId });
                    rows.push(row);
                    fs.appendFileSync(rawPath, `${JSON.stringify(row)}\n`);
                    process.stdout.write(
                        `[live-benchmark] ${scenario} ${queryIndex + 1}/${options.queries}: ` +
                        `${row.terminalState || row.error?.code} ${row.totalMs} ms\n`
                    );
                });
            }
        }
    } finally {
        finalLedgerHeights = {
            fabric: await readHeight(runtime.fabricMonitor),
            fisco: await readHeight(runtime.fiscoMonitor)
        };
        await runtime.close();
    }

    const elapsedMs = Number((performance.now() - experimentStarted).toFixed(3));
    const observedAnchorHeights = rows
        .map((row) => row.anchorBlockHeight)
        .filter((height) => Number.isInteger(height));
    if (observedAnchorHeights.length) {
        finalLedgerHeights.fisco = Math.max(
            finalLedgerHeights.fisco ?? 0,
            ...observedAnchorHeights
        );
    }
    const summary = {
        schemaVersion: 'semantic-query-live-experiment-summary-v1',
        generatedAt: new Date().toISOString(),
        totalQueries: rows.length,
        queryConcurrency: options.queryConcurrency,
        anchorWallets: options.anchorWallets,
        completedQueries: rows.filter((row) => !row.error).length,
        expectedBehaviorQueries: rows.filter((row) => row.expectedBehavior).length,
        elapsedMs,
        measuredQueriesPerSecond: Number((rows.length / (elapsedMs / 1000)).toFixed(3)),
        auditDatabaseBytes: fs.statSync(databasePath).size,
        ledgerHeights: {
            initial: manifest.initialLedgerHeights,
            final: finalLedgerHeights
        },
        byScenario: summarize(rows)
    };
    writeCsv(csvPath, rows);
    fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
    return { outputRoot, summary };
}

if (require.main === module) {
    executeExperiment(parseArgs(process.argv.slice(2)))
        .then(({ outputRoot, summary }) => {
            process.stdout.write(`${JSON.stringify({
                outputRoot,
                totalQueries: summary.totalQueries,
                completedQueries: summary.completedQueries,
                expectedBehaviorQueries: summary.expectedBehaviorQueries
            }, null, 2)}\n`);
        })
        .catch((error) => {
            process.stderr.write(`${error.stack || error}\n`);
            process.exitCode = 1;
        });
}

module.exports = {
    DEFAULT_SCENARIOS,
    executeExperiment,
    expectedBehavior,
    parseArgs,
    percentile,
    publicChainConfiguration,
    readHeight,
    runBounded,
    scenarioPlan,
    summarize
};
