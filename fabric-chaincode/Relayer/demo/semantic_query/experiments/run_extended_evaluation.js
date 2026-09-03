#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { DagScheduler } = require('../dag_scheduler');
const { FaultInjector } = require('../fault_injector');
const { createSupplyFinanceDag } = require('../supply_finance_workload');
const {
    DEFAULT_REGULATORY_FIXTURE,
    createRegulatoryReviewDag
} = require('../regulatory_workload');
const { selectServices } = require('../service_scheduler');

const BASE_SEED = 20260831;

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function parseArgs(argv) {
    const options = { runs: 5, queries: 20, quick: false, outDir: null };
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        if (argument === '--quick') {
            options.quick = true;
            options.runs = 1;
            options.queries = 2;
        } else if (argument === '--runs') options.runs = Number(argv[++index]);
        else if (argument === '--queries') options.queries = Number(argv[++index]);
        else if (argument === '--out') options.outDir = path.resolve(argv[++index]);
        else throw new Error(`Unknown argument '${argument}'`);
    }
    for (const field of ['runs', 'queries']) {
        if (!Number.isInteger(options[field]) || options[field] < 1) {
            throw new Error(`--${field} must be a positive integer`);
        }
    }
    return options;
}

function mean(values) {
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values, fraction) {
    if (!values.length) return null;
    const sorted = [...values].sort((left, right) => left - right);
    const position = (sorted.length - 1) * fraction;
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    return lower === upper
        ? sorted[lower]
        : sorted[lower] + ((sorted[upper] - sorted[lower]) * (position - lower));
}

function summarizeMs(values) {
    return {
        n: values.length,
        mean: Number(mean(values).toFixed(3)),
        p50: Number(percentile(values, 0.5).toFixed(3)),
        p95: Number(percentile(values, 0.95).toFixed(3)),
        p99: Number(percentile(values, 0.99).toFixed(3))
    };
}

function randomGenerator(seed) {
    let state = seed >>> 0;
    return () => {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        return (state >>> 0) / 0x100000000;
    };
}

function regulatoryScenario(name, queryId) {
    const fixture = clone(DEFAULT_REGULATORY_FIXTURE);
    let expectedTerminal = 'READY_TO_ANCHOR';
    let expectedOutcome = 'SATISFIED';
    let plan = [];
    if (name === 'over_limit') {
        fixture.transaction.amount = fixture.policy.maximumAmount + 1;
        expectedOutcome = 'UNSATISFIED';
    } else if (name === 'subject_mismatch') {
        fixture.transaction.entityId = 'ENTITY-OTHER';
        expectedOutcome = 'UNSATISFIED';
    } else if (name === 'missing_disclosure') {
        delete fixture.disclosure.filed;
        expectedTerminal = 'INSUFFICIENT_EVIDENCE';
        expectedOutcome = 'INSUFFICIENT';
    } else if (name === 'endpoint_retry') {
        plan = [{
            queryId, nodeId: 'transaction_fisco', attempt: 1, candidate: 'fisco-node-0',
            action: 'error', code: 'ENDPOINT_UNAVAILABLE', recoverable: true
        }];
    } else if (name !== 'normal') throw new Error(`Unknown regulatory scenario '${name}'`);
    return { fixture, plan, expectedTerminal, expectedOutcome };
}

async function runRegulatoryWorkload(options) {
    const scenarios = ['normal', 'over_limit', 'subject_mismatch', 'missing_disclosure', 'endpoint_retry'];
    const rows = [];
    for (const scenario of scenarios) {
        for (let index = 0; index < options.queries * options.runs; index += 1) {
            const queryId = `reg-${scenario}-${index}`;
            const spec = regulatoryScenario(scenario, queryId);
            const started = performance.now();
            const result = await new DagScheduler({
                concurrency: 4,
                faultInjector: new FaultInjector(spec.plan)
            }).execute({
                queryId,
                nodes: createRegulatoryReviewDag({ fixture: spec.fixture, serviceDelayMs: 0 }),
                rootNodeId: 'regulatory_root'
            });
            const expected = result.terminalState === spec.expectedTerminal && result.outcome === spec.expectedOutcome;
            rows.push({
                scenario,
                queryId,
                elapsedMs: performance.now() - started,
                terminalState: result.terminalState,
                outcome: result.outcome,
                expected,
                retries: result.nodes.reduce((sum, node) => sum + Math.max(0, node.attemptCount - 1), 0)
            });
        }
    }
    return scenarios.map((scenario) => {
        const selected = rows.filter((row) => row.scenario === scenario);
        return {
            scenario,
            ...summarizeMs(selected.map((row) => row.elapsedMs)),
            expected: selected.filter((row) => row.expected).length,
            expectedRate: selected.filter((row) => row.expected).length / selected.length,
            terminals: selected.reduce((counts, row) => {
                counts[row.terminalState] = (counts[row.terminalState] || 0) + 1;
                return counts;
            }, {}),
            meanRetries: mean(selected.map((row) => row.retries))
        };
    });
}

function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildShapeDag({ nodeCount, shape, evidenceBytes, nodeDelayMs = 1 }) {
    if (nodeCount < 3) throw new Error('nodeCount must be at least 3');
    const payload = 'x'.repeat(evidenceBytes);
    const nodes = [];
    const makeExecutor = (isLeaf) => async (_node, { inputs }) => {
        if (nodeDelayMs) await wait(nodeDelayMs);
        return isLeaf
            ? { passed: true, payload }
            : { passed: Object.values(inputs).every((value) => value.passed) };
    };
    if (shape === 'wide') {
        for (let index = 0; index < nodeCount - 1; index += 1) {
            nodes.push({ id: `n${index}`, kind: 'evidence', deps: [], execute: makeExecutor(true) });
        }
        nodes.push({
            id: 'root', kind: 'root', deps: nodes.map((node) => node.id),
            execute: async (_node, { inputs }) => ({
                outcome: Object.values(inputs).every((value) => value.passed) ? 'SATISFIED' : 'UNSATISFIED'
            })
        });
    } else if (shape === 'deep') {
        nodes.push({ id: 'n0', kind: 'evidence', deps: [], execute: makeExecutor(true) });
        for (let index = 1; index < nodeCount - 1; index += 1) {
            nodes.push({ id: `n${index}`, kind: 'rule', deps: [`n${index - 1}`], execute: makeExecutor(false) });
        }
        nodes.push({
            id: 'root', kind: 'root', deps: [`n${nodeCount - 2}`],
            execute: async (_node, { inputs }) => ({
                outcome: Object.values(inputs).every((value) => value.passed) ? 'SATISFIED' : 'UNSATISFIED'
            })
        });
    } else if (shape === 'balanced') {
        for (let index = 0; index < nodeCount - 1; index += 1) {
            const children = [2 * index + 1, 2 * index + 2]
                .filter((child) => child < nodeCount - 1)
                .map((child) => `n${child}`);
            nodes.push({
                id: `n${index}`,
                kind: children.length ? 'rule' : 'evidence',
                deps: children,
                execute: makeExecutor(!children.length)
            });
        }
        nodes.push({
            id: 'root', kind: 'root', deps: ['n0'],
            execute: async (_node, { inputs }) => ({ outcome: inputs.n0.passed ? 'SATISFIED' : 'UNSATISFIED' })
        });
    } else throw new Error(`Unknown DAG shape '${shape}'`);
    return nodes;
}

async function runDagShapeBenchmark(options) {
    const shapes = ['wide', 'balanced', 'deep'];
    const nodeCounts = options.quick ? [8, 16] : [16, 32, 64];
    const evidenceSizes = options.quick ? [256] : [256, 4096, 16384];
    const rows = [];
    for (const shape of shapes) {
        for (const nodeCount of nodeCounts) {
            for (const evidenceBytes of evidenceSizes) {
                const elapsed = [];
                const cpuStarted = process.cpuUsage();
                const rssStarted = process.memoryUsage().rss;
                for (let index = 0; index < options.runs * options.queries; index += 1) {
                    const started = performance.now();
                    const result = await new DagScheduler({ concurrency: 8, deadlineMs: 30000 }).execute({
                        queryId: `shape-${shape}-${nodeCount}-${evidenceBytes}-${index}`,
                        nodes: buildShapeDag({ nodeCount, shape, evidenceBytes }),
                        rootNodeId: 'root'
                    });
                    if (result.outcome !== 'SATISFIED') throw new Error('Unexpected DAG-shape outcome');
                    elapsed.push(performance.now() - started);
                }
                const cpu = process.cpuUsage(cpuStarted);
                rows.push({
                    shape, nodeCount, evidenceBytes,
                    ...summarizeMs(elapsed),
                    cpuMs: Number(((cpu.user + cpu.system) / 1000).toFixed(3)),
                    rssDeltaBytes: process.memoryUsage().rss - rssStarted
                });
            }
        }
    }
    return rows;
}

async function runWithLimit(total, concurrency, execute) {
    let next = 0;
    const durations = [];
    async function worker() {
        while (true) {
            const index = next;
            next += 1;
            if (index >= total) return;
            const started = performance.now();
            await execute(index);
            durations.push(performance.now() - started);
        }
    }
    const started = performance.now();
    await Promise.all(Array.from({ length: concurrency }, worker));
    return { durations, wallMs: performance.now() - started };
}

async function runQueryConcurrencyBenchmark(options) {
    const levels = options.quick ? [1, 2] : [1, 2, 4, 8, 16];
    const total = options.quick ? 4 : 40;
    const rows = [];
    for (const concurrency of levels) {
        const perQuery = [];
        const throughput = [];
        for (let run = 0; run < options.runs; run += 1) {
            const result = await runWithLimit(total, concurrency, async (index) => {
                const execution = await new DagScheduler({ concurrency: 4 }).execute({
                    queryId: `concurrency-${concurrency}-${run}-${index}`,
                    nodes: createSupplyFinanceDag({ serviceDelayMs: 8 }),
                    rootNodeId: 'financing_root'
                });
                if (execution.outcome !== 'SATISFIED') throw new Error('Unexpected concurrency outcome');
            });
            perQuery.push(...result.durations);
            throughput.push(total / (result.wallMs / 1000));
        }
        rows.push({
            concurrency,
            queries: total * options.runs,
            throughputMean: Number(mean(throughput).toFixed(3)),
            latency: summarizeMs(perQuery)
        });
    }
    return rows;
}

function cachedDag(cacheEnabled, cache, counters) {
    return createSupplyFinanceDag({ serviceDelayMs: 0 }).map((node) => {
        if (node.kind !== 'evidence') return node;
        const delegate = node.execute;
        return {
            ...node,
            execute: async (...args) => {
                const key = `${node.id}:${node.version}:fixture-v1`;
                if (cacheEnabled && cache.has(key)) {
                    counters.hits += 1;
                    return clone(cache.get(key));
                }
                counters.remoteFetches += 1;
                const value = await delegate(...args);
                if (cacheEnabled) cache.set(key, clone(value));
                return value;
            }
        };
    });
}

async function runCacheAblation(options) {
    const rows = [];
    for (const cacheEnabled of [false, true]) {
        const cache = new Map();
        const counters = { hits: 0, remoteFetches: 0 };
        const elapsed = [];
        for (let index = 0; index < options.runs * options.queries; index += 1) {
            const started = performance.now();
            await new DagScheduler({ concurrency: 4 }).execute({
                queryId: `cache-${cacheEnabled}-${index}`,
                nodes: cachedDag(cacheEnabled, cache, counters),
                rootNodeId: 'financing_root'
            });
            elapsed.push(performance.now() - started);
        }
        rows.push({ cacheEnabled, ...counters, ...summarizeMs(elapsed) });
    }
    return rows;
}

async function runRetryAblation(options) {
    const rows = [];
    for (const recoveryEnabled of [false, true]) {
        let successfulQueries = 0;
        const elapsed = [];
        let attempts = 0;
        const terminalCounts = {};
        for (let index = 0; index < options.runs * options.queries; index += 1) {
            const queryId = `retry-${recoveryEnabled}-${index}`;
            const nodes = createSupplyFinanceDag({ serviceDelayMs: 0 }).map((node) => (
                recoveryEnabled ? node : { ...node, maxAttempts: 1, candidates: (node.candidates || []).slice(0, 1) }
            ));
            const injector = new FaultInjector([{
                queryId, nodeId: 'order_fabric', attempt: 1, candidate: 'fabric-peer-0',
                action: 'error', code: 'ENDPOINT_UNAVAILABLE', recoverable: true
            }]);
            const started = performance.now();
            const result = await new DagScheduler({ concurrency: 4, faultInjector: injector }).execute({
                queryId, nodes, rootNodeId: 'financing_root'
            });
            elapsed.push(performance.now() - started);
            attempts += result.nodes.reduce((sum, node) => sum + node.attemptCount, 0);
            terminalCounts[result.terminalState] = (terminalCounts[result.terminalState] || 0) + 1;
            if (result.outcome === 'SATISFIED') successfulQueries += 1;
        }
        const total = options.runs * options.queries;
        rows.push({
            recoveryEnabled,
            successfulQueries,
            total,
            querySuccessRate: successfulQueries / total,
            terminalCounts,
            meanNodeAttempts: attempts / total,
            latency: summarizeMs(elapsed)
        });
    }
    return rows;
}

function hhi(counts) {
    const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
    return Object.values(counts).reduce((sum, value) => sum + ((value / total) ** 2), 0);
}

function gini(counts) {
    const values = Object.values(counts).sort((left, right) => left - right);
    const total = values.reduce((sum, value) => sum + value, 0);
    const weighted = values.reduce((sum, value, index) => sum + ((index + 1) * value), 0);
    return ((2 * weighted) / (values.length * total)) - ((values.length + 1) / values.length);
}

function runServiceSchedulingAblation(options) {
    const serviceTemplates = [
        { serviceId: 'a', reliability: 0.96, latencyMs: 20, organization: 'org-1', modelFamily: 'model-x' },
        { serviceId: 'b', reliability: 0.93, latencyMs: 16, organization: 'org-1', modelFamily: 'model-x' },
        { serviceId: 'c', reliability: 0.90, latencyMs: 24, organization: 'org-2', modelFamily: 'model-y' },
        { serviceId: 'd', reliability: 0.87, latencyMs: 30, organization: 'org-3', modelFamily: 'model-z' }
    ];
    const tasks = options.quick ? 20 : 1000;
    const strategies = [
        { name: 'fixed_single', strategy: 'fixed', count: 1 },
        { name: 'reliability_single', strategy: 'reliability', count: 1 },
        { name: 'reliability_load_diversity', strategy: 'reliability_load_diversity', count: 2 }
    ];
    // Common random numbers make strategy comparisons use the same task-level
    // family outages and service-level availability draws.
    const random = randomGenerator(BASE_SEED);
    const modelFamilies = [...new Set(serviceTemplates.map((service) => service.modelFamily))];
    const faultScenarios = Array.from({ length: tasks }, () => ({
        familyOutages: Object.fromEntries(modelFamilies.map((family) => [family, random() < 0.08])),
        serviceDraws: Object.fromEntries(serviceTemplates.map((service) => [service.serviceId, random()]))
    }));
    return strategies.map((spec) => {
        const calls = Object.fromEntries(serviceTemplates.map((service) => [service.serviceId, 0]));
        let availableTasks = 0;
        for (let task = 0; task < tasks; task += 1) {
            const services = serviceTemplates.map((service) => ({
                ...service,
                load: calls[service.serviceId] / Math.max(1, task + 1)
            }));
            const selected = selectServices(services, spec);
            selected.forEach((service) => { calls[service.serviceId] += 1; });
            const scenario = faultScenarios[task];
            const available = selected.some((service) => (
                !scenario.familyOutages[service.modelFamily]
                && scenario.serviceDraws[service.serviceId] < service.reliability
            ));
            if (available) availableTasks += 1;
        }
        return {
            strategy: spec.name,
            tasks,
            calls,
            callsPerTask: spec.count,
            availabilityRate: availableTasks / tasks,
            maxProviderShare: Math.max(...Object.values(calls)) / Object.values(calls).reduce((a, b) => a + b, 0),
            hhi: hhi(calls),
            gini: gini(calls)
        };
    });
}

function writeCsv(filePath, rows) {
    if (!rows.length) return;
    const fields = [...new Set(rows.flatMap((row) => Object.keys(row)))];
    const cell = (value) => {
        const text = typeof value === 'object' ? JSON.stringify(value) : String(value ?? '');
        return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    fs.writeFileSync(filePath, `${fields.join(',')}\n${rows.map((row) => fields.map((field) => cell(row[field])).join(',')).join('\n')}\n`);
}

async function execute(options) {
    const outputRoot = options.outDir || path.resolve(
        __dirname,
        '../../../../../docs/xn/experiments/semantic-query-extended-evaluation'
    );
    fs.mkdirSync(outputRoot, { recursive: true });
    const report = {
        meta: {
            generatedAt: new Date().toISOString(),
            baseSeed: BASE_SEED,
            node: process.version,
            platform: `${os.platform()} ${os.release()} ${os.arch()}`,
            cpu: os.cpus()[0]?.model || 'unknown',
            logicalCpus: os.cpus().length,
            memoryGiB: Number((os.totalmem() / (1024 ** 3)).toFixed(1)),
            runs: options.runs,
            queriesPerConfigurationPerRun: options.queries
        },
        evidenceBoundary: [
            'all measurements in this report are local executable experiments',
            'the regulatory workload uses deterministic generated fixtures, not live-chain records',
            'DAG-shape and concurrency results use controlled local service delays',
            'service scheduling availability uses a seeded fault model and is exploratory, not a real-LLM result'
        ],
        regulatoryWorkload: await runRegulatoryWorkload(options),
        dagShape: await runDagShapeBenchmark(options),
        queryConcurrency: await runQueryConcurrencyBenchmark(options),
        cacheAblation: await runCacheAblation(options),
        retryAblation: await runRetryAblation(options),
        serviceSchedulingAblation: runServiceSchedulingAblation(options)
    };
    fs.writeFileSync(path.join(outputRoot, 'results.json'), `${JSON.stringify(report, null, 2)}\n`);
    writeCsv(path.join(outputRoot, 'regulatory_workload.csv'), report.regulatoryWorkload);
    writeCsv(path.join(outputRoot, 'dag_shape.csv'), report.dagShape);
    writeCsv(path.join(outputRoot, 'query_concurrency.csv'), report.queryConcurrency);
    writeCsv(path.join(outputRoot, 'mechanism_ablation.csv'), [
        ...report.cacheAblation.map((row) => ({ mechanism: 'cache', ...row })),
        ...report.retryAblation.map((row) => ({ mechanism: 'retry', ...row })),
        ...report.serviceSchedulingAblation.map((row) => ({ mechanism: 'service_scheduling', ...row }))
    ]);
    return { outputRoot, report };
}

if (require.main === module) {
    execute(parseArgs(process.argv.slice(2)))
        .then(({ outputRoot }) => process.stdout.write(`${outputRoot}\n`))
        .catch((error) => {
            process.stderr.write(`${error.stack || error}\n`);
            process.exitCode = 1;
        });
}

module.exports = {
    buildShapeDag,
    execute,
    parseArgs,
    regulatoryScenario,
    runServiceSchedulingAblation
};
