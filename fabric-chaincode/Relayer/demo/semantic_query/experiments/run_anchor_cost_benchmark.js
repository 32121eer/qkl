#!/usr/bin/env node
'use strict';

/* Real-FISCO cost experiment. It never synthesizes gas values: if the RPC or
 * benchmark contract is unavailable it exits before writing a result report. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ethers } = require('ethers');

const ROOT_ABI = [
    'function anchorReceipt(bytes32,bytes32,bytes32,uint8,uint8)'
];
const PER_SERVICE_ABI = [
    'function registerQuery(bytes32,bytes32)',
    'function logServiceOutput(bytes32,bytes32,bytes32,bytes32,uint8)',
    'function finalizeQuery(bytes32,bytes32,uint8)',
    'function escalate(bytes32,bytes32)'
];

function digest(value) {
    return ethers.keccak256(ethers.toUtf8Bytes(value));
}

function percentile(values, fraction) {
    const ordered = [...values].sort((a, b) => a - b);
    const index = (ordered.length - 1) * fraction;
    const low = Math.floor(index); const high = Math.ceil(index);
    return ordered[low] + ((ordered[high] - ordered[low]) * (index - low));
}

function summarize(rows) {
    const groups = new Map();
    for (const row of rows) {
        const key = `${row.scheme}:${row.operation}:${row.serviceCount}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(row);
    }
    return [...groups.entries()].map(([key, values]) => {
        const [scheme, operation, count] = key.split(':');
        const gas = values.map((row) => Number(row.gasUsed));
        const bytes = values.map((row) => row.calldataBytes);
        return {
            scheme, operation, serviceCount: Number(count), n: values.length,
            gasUsed: { min: Math.min(...gas), p50: percentile(gas, 0.5), p95: percentile(gas, 0.95), max: Math.max(...gas) },
            calldataBytes: { min: Math.min(...bytes), p50: percentile(bytes, 0.5), p95: percentile(bytes, 0.95), max: Math.max(...bytes) }
        };
    });
}

function parseArgs(argv) {
    const options = { config: path.resolve(__dirname, '../../../config.json'), contract: null, repetitions: 100, warmup: 10, serviceCounts: [1, 2, 4, 8], out: null };
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--config') options.config = path.resolve(argv[++i]);
        else if (arg === '--contract') options.contract = argv[++i];
        else if (arg === '--repetitions') options.repetitions = Number(argv[++i]);
        else if (arg === '--warmup') options.warmup = Number(argv[++i]);
        else if (arg === '--service-counts') options.serviceCounts = argv[++i].split(',').map(Number);
        else if (arg === '--out') options.out = path.resolve(argv[++i]);
        else throw new Error(`Unknown argument '${arg}'`);
    }
    if (!options.contract || !ethers.isAddress(options.contract)) throw new Error('--contract must be a deployed PerServiceAuditLog address');
    if (!Number.isInteger(options.repetitions) || options.repetitions < 1) throw new Error('--repetitions must be positive');
    return options;
}

async function submit(contract, method, args, meta) {
    const tx = await contract[method](...args);
    const receipt = await tx.wait(1);
    return { ...meta, txHash: tx.hash, blockNumber: Number(receipt.blockNumber), gasUsed: receipt.gasUsed.toString(), calldataBytes: (tx.data.length - 2) / 2 };
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    const config = JSON.parse(fs.readFileSync(options.config, 'utf8'));
    const chain = config.chains.find((item) => item.type === 'FISCO_BCOS' && item.enabled);
    if (!chain?.rpc?.endpoint || !config.relayer?.privateKey || !chain.contracts?.semanticAuditAnchor) throw new Error('FISCO endpoint, relayer key, and semanticAuditAnchor must be configured');
    const probe = await fetch(chain.rpc.endpoint, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1 }),
        signal: AbortSignal.timeout(3000)
    });
    if (!probe.ok) throw new Error(`FISCO RPC preflight failed with HTTP ${probe.status}`);
    const provider = new ethers.JsonRpcProvider(chain.rpc.endpoint);
    const wallet = new ethers.Wallet(config.relayer.privateKey, provider);
    const root = new ethers.Contract(chain.contracts.semanticAuditAnchor, ROOT_ABI, wallet);
    const perService = new ethers.Contract(options.contract, PER_SERVICE_ABI, wallet);
    const rows = [];
    const allCounts = [...new Set(options.serviceCounts)];
    const total = options.warmup + options.repetitions;
    for (const serviceCount of allCounts) {
        for (let run = 0; run < total; run += 1) {
            const prefix = `anchor-cost:${Date.now()}:${serviceCount}:${run}`;
            const qid = digest(`${prefix}:qid`); const queryDigest = digest(`${prefix}:query`); const receiptRoot = digest(`${prefix}:receipt`);
            const warmup = run < options.warmup;
            const rootRow = await submit(root, 'anchorReceipt', [qid, queryDigest, receiptRoot, 3, 1], { scheme: 'single_root', operation: 'anchorReceipt', serviceCount, warmup });
            if (!warmup) rows.push(rootRow);
            const base = digest(`${prefix}:baseline`);
            const register = await submit(perService, 'registerQuery', [base, queryDigest], { scheme: 'per_service_log', operation: 'registerQuery', serviceCount, warmup });
            if (!warmup) rows.push(register);
            for (let service = 0; service < serviceCount; service += 1) {
                const row = await submit(perService, 'logServiceOutput', [base, digest(`${prefix}:service:${service}`), digest(`${prefix}:input`), digest(`${prefix}:output:${service}`), 1], { scheme: 'per_service_log', operation: 'logServiceOutput', serviceCount, warmup });
                if (!warmup) rows.push(row);
            }
            if (serviceCount > 1) {
                const escalation = await submit(perService, 'escalate', [base, digest(`${prefix}:conflict`)], { scheme: 'per_service_log', operation: 'escalate', serviceCount, warmup });
                if (!warmup) rows.push(escalation);
            }
            const finalRow = await submit(perService, 'finalizeQuery', [base, receiptRoot, 1], { scheme: 'per_service_log', operation: 'finalizeQuery', serviceCount, warmup });
            if (!warmup) rows.push(finalRow);
        }
    }
    const out = options.out || path.resolve(process.cwd(), `anchor-cost-benchmark-${Date.now()}`);
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'raw.jsonl'), `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
    fs.writeFileSync(path.join(out, 'summary.json'), `${JSON.stringify({ schemaVersion: 'anchor-cost-benchmark-v1', generatedAt: new Date().toISOString(), rootAnchorContract: chain.contracts.semanticAuditAnchor, perServiceContract: options.contract, repetitions: options.repetitions, warmup: options.warmup, serviceCounts: allCounts, environment: { platform: `${os.platform()} ${os.release()}`, node: process.version }, rows: summarize(rows), evidenceBoundary: ['All gasUsed values are transaction receipts from the configured FISCO endpoint', 'PerServiceAuditLog is a measured alternative baseline, not a component of the proposed protocol'] }, null, 2)}\n`);
    process.stdout.write(`${out}\n`);
}

if (require.main === module) main().catch((error) => { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; });

module.exports = { digest, summarize, percentile, parseArgs };
