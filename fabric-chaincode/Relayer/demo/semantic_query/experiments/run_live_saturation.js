#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const { executeExperiment, parseArgs: parseLiveArgs, percentile } = require('./run_live_benchmark');

const DEFAULT_CONTAINERS = Object.freeze([]);

function parseArgs(argv) {
    const options = {
        levels: [1, 2, 4, 8],
        runs: 3,
        queries: 20,
        warmup: 2,
        sampleMs: 1000,
        anchorWallets: 1,
        outDir: null,
        quick: false
    };
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        if (argument === '--quick') {
            options.levels = [1, 2];
            options.runs = 1;
            options.queries = 2;
            options.warmup = 0;
            options.quick = true;
        } else if (argument === '--levels') {
            options.levels = argv[++index].split(',').map(Number);
        } else if (argument === '--runs') options.runs = Number(argv[++index]);
        else if (argument === '--queries') options.queries = Number(argv[++index]);
        else if (argument === '--warmup') options.warmup = Number(argv[++index]);
        else if (argument === '--sample-ms') options.sampleMs = Number(argv[++index]);
        else if (argument === '--anchor-wallets') options.anchorWallets = Number(argv[++index]);
        else if (argument === '--out') options.outDir = path.resolve(argv[++index]);
        else throw new Error(`Unknown argument '${argument}'`);
    }
    if (!options.levels.length || options.levels.some((value) => !Number.isInteger(value) || value < 1)) {
        throw new Error('--levels must be a comma-separated list of positive integers');
    }
    for (const field of ['runs', 'queries', 'sampleMs', 'anchorWallets']) {
        if (!Number.isInteger(options[field]) || options[field] < 1) throw new Error(`--${field} must be positive`);
    }
    if (!Number.isInteger(options.warmup) || options.warmup < 0) throw new Error('--warmup must be non-negative');
    return options;
}

function dockerStats(containers = DEFAULT_CONTAINERS) {
    return new Promise((resolve) => {
        execFile('docker', ['stats', '--no-stream', '--format', '{{json .}}', ...containers], {
            timeout: 10000,
            maxBuffer: 1024 * 1024
        }, (error, stdout) => {
            if (error) return resolve([]);
            const rows = stdout.trim().split('\n').filter(Boolean).flatMap((line) => {
                try {
                    return [JSON.parse(line)];
                } catch (_error) {
                    return [];
                }
            });
            resolve(rows);
        });
    });
}

function parsePercent(value) {
    const parsed = Number.parseFloat(String(value || '').replace('%', ''));
    return Number.isFinite(parsed) ? parsed : null;
}

function parseBytes(value) {
    const match = String(value || '').trim().match(/^([0-9.]+)\s*([KMGT]?i?B)$/i);
    if (!match) return null;
    const amount = Number(match[1]);
    const unit = match[2].toUpperCase();
    const factors = {
        B: 1,
        KB: 1000,
        KIB: 1024,
        MB: 1000 ** 2,
        MIB: 1024 ** 2,
        GB: 1000 ** 3,
        GIB: 1024 ** 3,
        TB: 1000 ** 4,
        TIB: 1024 ** 4
    };
    return factors[unit] ? amount * factors[unit] : null;
}

function summarizeNumbers(values) {
    const clean = values.filter(Number.isFinite);
    if (!clean.length) return { n: 0, mean: null, p95: null, max: null };
    return {
        n: clean.length,
        mean: clean.reduce((sum, value) => sum + value, 0) / clean.length,
        p95: percentile(clean, 0.95),
        max: Math.max(...clean)
    };
}

function summarizeResources(samples) {
    const byContainer = {};
    for (const sample of samples) {
        for (const row of sample.docker) {
            const name = row.Name || row.Container;
            if (!name) continue;
            if (!byContainer[name]) byContainer[name] = { cpu: [], memoryBytes: [] };
            byContainer[name].cpu.push(parsePercent(row.CPUPerc));
            byContainer[name].memoryBytes.push(parseBytes(String(row.MemUsage || '').split('/')[0]));
        }
    }
    return {
        sampleCount: samples.length,
        hostLoad1: summarizeNumbers(samples.map((sample) => sample.hostLoad1)),
        benchmarkProcessRssBytes: summarizeNumbers(samples.map((sample) => sample.processRssBytes)),
        containers: Object.fromEntries(Object.entries(byContainer).map(([name, values]) => [name, {
            cpuPercent: summarizeNumbers(values.cpu),
            memoryBytes: summarizeNumbers(values.memoryBytes)
        }]))
    };
}

function startSampler(sampleMs) {
    const samples = [];
    let stopped = false;
    let sampling = false;
    const sample = async () => {
        if (sampling || stopped) return;
        sampling = true;
        const docker = await dockerStats();
        samples.push({
            at: new Date().toISOString(),
            hostLoad1: os.loadavg()[0],
            processRssBytes: process.memoryUsage().rss,
            docker
        });
        sampling = false;
    };
    const timer = setInterval(sample, sampleMs);
    sample();
    return async () => {
        stopped = true;
        clearInterval(timer);
        while (sampling) await new Promise((resolve) => setTimeout(resolve, 10));
        return samples;
    };
}

function saturationPoint(rows) {
    for (let index = 1; index < rows.length; index += 1) {
        const previous = rows[index - 1];
        const current = rows[index];
        const throughputGain = (current.throughput - previous.throughput) / previous.throughput;
        const latencyGain = (current.p95Ms - previous.p95Ms) / previous.p95Ms;
        if (throughputGain < 0.1 && latencyGain > 0.25) {
            return { concurrency: current.concurrency, throughputGain, latencyGain };
        }
    }
    return null;
}

async function execute(options) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outputRoot = options.outDir || path.resolve(
        __dirname,
        '../../../../../docs/xn/experiments/semantic-query-live-concurrency-runs',
        stamp
    );
    fs.mkdirSync(outputRoot, { recursive: true });
    const rows = [];
    for (const concurrency of options.levels) {
        const levelRoot = path.join(outputRoot, `c${concurrency}`);
        const liveOptions = parseLiveArgs([
            '--runs', String(options.runs),
            '--queries', String(options.queries),
            '--warmup', String(options.warmup),
            '--scenarios', 'normal',
            '--query-concurrency', String(concurrency),
            '--anchor-wallets', String(options.anchorWallets),
            '--out', levelRoot
        ]);
        const stopSampler = startSampler(options.sampleMs);
        const started = performance.now();
        const { summary } = await executeExperiment(liveOptions);
        const samples = await stopSampler();
        const wallMs = performance.now() - started;
        const normal = summary.byScenario.normal;
        const row = {
            concurrency,
            queries: summary.totalQueries,
            completed: summary.completedQueries,
            expected: summary.expectedBehaviorQueries,
            throughput: summary.measuredQueriesPerSecond,
            p50Ms: normal.totalLatencyMs.p50,
            p95Ms: normal.totalLatencyMs.p95,
            p99Ms: normal.totalLatencyMs.p99,
            executionP95Ms: normal.executionLatencyMs.p95,
            anchorQueueP95Ms: normal.anchorQueueWaitMs.p95,
            anchorServiceP95Ms: normal.anchorServiceMs.p95,
            wallMs,
            ledgerHeights: summary.ledgerHeights,
            resources: summarizeResources(samples)
        };
        rows.push(row);
        fs.writeFileSync(path.join(levelRoot, 'resource_samples.json'), `${JSON.stringify(samples, null, 2)}\n`);
        process.stdout.write(`[live-saturation] c=${concurrency} throughput=${row.throughput} p95=${row.p95Ms} ms\n`);
    }
    const report = {
        schemaVersion: 'semantic-query-live-saturation-v1',
        generatedAt: new Date().toISOString(),
        evidenceBoundary: [
            'Fabric/FISCO reads, FISCO anchoring and SQLite persistence are live',
            'all levels use the normal supply-chain-financing workload on one host',
            options.anchorWallets === 1
                ? 'FISCO anchoring is serialized through one wallet to prevent nonce races'
                : `${options.anchorWallets} FISCO wallets are assigned round-robin; submissions remain serialized within each wallet`,
            'container statistics are sampled with docker stats and may perturb the workload slightly'
        ],
        configuration: options,
        rows,
        saturationPoint: saturationPoint(rows)
    };
    fs.writeFileSync(path.join(outputRoot, 'summary.json'), `${JSON.stringify(report, null, 2)}\n`);
    const fields = ['concurrency', 'queries', 'completed', 'expected', 'throughput', 'p50Ms', 'p95Ms', 'p99Ms', 'executionP95Ms', 'anchorQueueP95Ms', 'anchorServiceP95Ms'];
    fs.writeFileSync(path.join(outputRoot, 'summary.csv'), `${fields.join(',')}\n${rows.map((row) => fields.map((field) => row[field]).join(',')).join('\n')}\n`);
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

module.exports = { execute, parseArgs, parseBytes, parsePercent, saturationPoint, summarizeResources };
