#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { openLiveRuntime } = require('./live_runtime');
const {
    publicChainConfiguration,
    readHeight,
    runBounded,
    summarize
} = require('./run_live_benchmark');
const { REGULATORY_SCENARIOS, scenarioRecord } = require('./seed_live_regulatory');

function parseArgs(argv) {
    const options = {
        config: path.resolve(__dirname, '../../../config.json'),
        runs: 3,
        queries: 10,
        warmup: 1,
        queryConcurrency: 1,
        scenarios: [...REGULATORY_SCENARIOS],
        evidenceTimeoutMs: 10000,
        semanticTimeoutMs: 1000,
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
        else if (argument === '--runs') options.runs = Number(argv[++index]);
        else if (argument === '--queries') options.queries = Number(argv[++index]);
        else if (argument === '--warmup') options.warmup = Number(argv[++index]);
        else if (argument === '--query-concurrency') options.queryConcurrency = Number(argv[++index]);
        else if (argument === '--scenarios') options.scenarios = argv[++index].split(',').filter(Boolean);
        else if (argument === '--evidence-timeout') options.evidenceTimeoutMs = Number(argv[++index]);
        else if (argument === '--semantic-timeout') options.semanticTimeoutMs = Number(argv[++index]);
        else if (argument === '--deadline') options.deadlineMs = Number(argv[++index]);
        else if (argument === '--out') options.outDir = path.resolve(argv[++index]);
        else throw new Error(`Unknown argument '${argument}'`);
    }
    for (const field of ['runs', 'queries', 'queryConcurrency']) {
        if (!Number.isInteger(options[field]) || options[field] < 1) throw new Error(`${field} must be positive`);
    }
    if (!Number.isInteger(options.warmup) || options.warmup < 0) throw new Error('warmup must be non-negative');
    const unknown = options.scenarios.filter((scenario) => !REGULATORY_SCENARIOS.includes(scenario));
    if (unknown.length) throw new Error(`Unknown scenarios: ${unknown.join(', ')}`);
    return options;
}

function scenarioPlan(scenario, queryId) {
    if (scenario !== 'endpoint_retry') return [];
    return [{
        queryId,
        nodeId: 'entity_fabric',
        attempt: 1,
        candidate: 'fabric-peer-0',
        action: 'error',
        code: 'ENDPOINT_UNAVAILABLE',
        recoverable: true
    }];
}

function expectedBehavior(scenario, receipt) {
    if (['over_limit', 'subject_mismatch'].includes(scenario)) {
        return receipt.terminalState === 'ANCHORED' && receipt.outcome === 'UNSATISFIED';
    }
    if (scenario === 'missing_disclosure') {
        return receipt.terminalState === 'INSUFFICIENT_EVIDENCE' && receipt.outcome === 'INSUFFICIENT';
    }
    return receipt.terminalState === 'ANCHORED' && receipt.outcome === 'SATISFIED';
}

async function executeOne(runtime, options, { run, queryIndex, scenario, queryId }) {
    const record = scenarioRecord(scenario);
    const started = performance.now();
    try {
        const result = await runtime.executeRegulatory({
            queryId,
            batchId: record.batchId,
            transactionId: record.transactionId,
            policyId: record.policyId,
            faultPlan: scenarioPlan(scenario, queryId),
            evidenceTimeoutMs: options.evidenceTimeoutMs,
            semanticTimeoutMs: options.semanticTimeoutMs,
            deadlineMs: options.deadlineMs
        });
        const totalMs = Number((performance.now() - started).toFixed(3));
        const executionMs = result.execution.elapsedMs;
        const retryCount = result.execution.nodes.reduce(
            (sum, node) => sum + Math.max(0, node.attemptCount - 1), 0
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
            auditVerified: result.verification.ok,
            expectedBehavior: expectedBehavior(scenario, result.receipt),
            appliedFaults: result.appliedFaults,
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

function writeCsv(filePath, rows) {
    const fields = [
        'run', 'queryIndex', 'queryId', 'scenario', 'terminalState', 'outcome',
        'totalMs', 'executionMs', 'anchorAndPersistenceMs', 'anchorQueueWaitMs', 'anchorServiceMs',
        'retryCount', 'remoteRequestAttempts', 'receiptBytes', 'receiptRoot', 'anchorTxHash',
        'anchorBlockHeight', 'auditVerified', 'expectedBehavior', 'error'
    ];
    const cell = (value) => {
        const text = value === null || value === undefined ? '' :
            (typeof value === 'string' ? value : JSON.stringify(value));
        return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    fs.writeFileSync(filePath, `${[fields.join(','), ...rows.map((row) =>
        fields.map((field) => cell(row[field])).join(','))].join('\n')}\n`);
}

async function executeExperiment(options) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outputRoot = options.outDir || path.resolve(
        __dirname,
        '../../../../../docs/xn/experiments/semantic-query-live-regulatory-runs',
        stamp
    );
    fs.mkdirSync(outputRoot, { recursive: true });
    const databasePath = path.join(outputRoot, 'audit.db');
    const runtime = await openLiveRuntime({ configPath: options.config, dbPath: databasePath });
    const manifest = {
        schemaVersion: 'semantic-query-live-regulatory-manifest-v1',
        generatedAt: new Date().toISOString(),
        node: process.version,
        platform: `${os.platform()} ${os.release()} ${os.arch()}`,
        runs: options.runs,
        queriesPerScenarioPerRun: options.queries,
        warmupQueries: options.warmup,
        queryConcurrency: options.queryConcurrency,
        scenarios: options.scenarios,
        workload: { name: 'regulatory-disclosure-review', dagVersion: 'regulatory-review-dag-v1', nodes: 10 },
        liveEvidenceMapping: {
            Fabric: ['entity', 'license', 'disclosure'],
            FISCO_BCOS: ['transaction', 'policy']
        },
        chains: publicChainConfiguration(options.config),
        evidenceBoundary: [
            'all five business evidence nodes read pre-seeded live Fabric or FISCO BCOS state',
            'receipt roots are anchored by live FISCO contract transactions and persisted in SQLite',
            'endpoint_retry is a deterministic scheduler-boundary injection; the other scenario differences are ledger-resident records',
            'the semantic service is deterministic and local'
        ],
        initialLedgerHeights: {
            fabric: await readHeight(runtime.fabricMonitor),
            fisco: await readHeight(runtime.fiscoMonitor)
        }
    };
    fs.writeFileSync(path.join(outputRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

    const rows = [];
    const started = performance.now();
    let finalLedgerHeights;
    try {
        for (let index = 0; index < options.warmup; index += 1) {
            const queryId = `livereg-${stamp}-warmup-${index}`;
            const row = await executeOne(runtime, options, {
                run: -1, queryIndex: index, scenario: 'normal', queryId
            });
            if (row.error || !row.expectedBehavior) throw new Error(`Warmup failed: ${JSON.stringify(row)}`);
        }
        for (let run = 0; run < options.runs; run += 1) {
            for (const scenario of options.scenarios) {
                const indexes = Array.from({ length: options.queries }, (_, index) => index);
                await runBounded(indexes, options.queryConcurrency, async (queryIndex) => {
                    const queryId = `livereg-${stamp}-${run}-${scenario}-${queryIndex}`;
                    const row = await executeOne(runtime, options, { run, queryIndex, scenario, queryId });
                    rows.push(row);
                    fs.appendFileSync(path.join(outputRoot, 'raw.jsonl'), `${JSON.stringify(row)}\n`);
                    process.stdout.write(`[live-regulatory] ${scenario} ${queryIndex + 1}/${options.queries}: ` +
                        `${row.terminalState || row.error?.code} ${row.totalMs} ms\n`);
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
    const observedHeights = rows.map((row) => row.anchorBlockHeight).filter(Number.isInteger);
    if (observedHeights.length) finalLedgerHeights.fisco = Math.max(finalLedgerHeights.fisco || 0, ...observedHeights);
    const elapsedMs = Number((performance.now() - started).toFixed(3));
    const summary = {
        schemaVersion: 'semantic-query-live-regulatory-summary-v1',
        generatedAt: new Date().toISOString(),
        totalQueries: rows.length,
        completedQueries: rows.filter((row) => !row.error).length,
        expectedBehaviorQueries: rows.filter((row) => row.expectedBehavior).length,
        auditVerifiedQueries: rows.filter((row) => row.auditVerified).length,
        elapsedMs,
        measuredQueriesPerSecond: Number((rows.length / (elapsedMs / 1000)).toFixed(3)),
        ledgerHeights: { initial: manifest.initialLedgerHeights, final: finalLedgerHeights },
        byScenario: summarize(rows)
    };
    writeCsv(path.join(outputRoot, 'results.csv'), rows);
    fs.writeFileSync(path.join(outputRoot, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
    return { outputRoot, summary };
}

if (require.main === module) {
    executeExperiment(parseArgs(process.argv.slice(2)))
        .then(({ outputRoot, summary }) => process.stdout.write(`${JSON.stringify({ outputRoot, summary }, null, 2)}\n`))
        .catch((error) => {
            process.stderr.write(`${error.stack || error}\n`);
            process.exitCode = 1;
        });
}

module.exports = { executeExperiment, expectedBehavior, parseArgs, scenarioPlan };
