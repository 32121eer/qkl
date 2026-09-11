#!/usr/bin/env node
'use strict';

/* Controlled material-availability benchmark. Materials are real files served
 * over HTTP; receipts contain only locators, hashes, versions and signatures. */
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { buildAuditReceipt, hashValue, verifyAuditReceipt } = require('../audit_receipt');
const { SemanticAuditStore } = require('../audit_store');

const CONDITIONS = ['available', 'missing', 'corrupt', 'wrong_version', 'bad_signature', 'unavailable'];

function percentile(values, fraction) {
    const ordered = [...values].sort((a, b) => a - b);
    const index = (ordered.length - 1) * fraction;
    const low = Math.floor(index); const high = Math.ceil(index);
    return ordered[low] + ((ordered[high] - ordered[low]) * (index - low));
}

function signable(record) {
    return `${record.materialId}|${record.version}|${record.payloadHash}`;
}

function createPayload(bytes, seed) {
    const prefix = Buffer.from(`material=${seed};`, 'utf8');
    const payload = Buffer.alloc(bytes, 0x61 + (seed.length % 20));
    prefix.copy(payload, 0, 0, Math.min(prefix.length, payload.length));
    return payload.toString('base64');
}

function startServer(records) {
    const server = http.createServer((request, response) => {
        const match = request.url.match(/^\/materials\/([^/?]+)(?:\?mode=([^&]+))?$/);
        if (!match) { response.writeHead(404).end(); return; }
        const [, id, mode = 'available'] = match;
        const record = records.get(id);
        if (!record || mode === 'missing') { response.writeHead(404).end(); return; }
        const body = { ...record };
        if (mode === 'corrupt') body.payload = createPayload(Buffer.from(record.payload, 'base64').length, `${id}:corrupt`);
        if (mode === 'wrong_version') body.version = 'v2';
        if (mode === 'bad_signature') body.signature = Buffer.from('invalid').toString('base64');
        response.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(JSON.stringify(body)) });
        response.end(JSON.stringify(body));
    });
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
    });
}

async function fetchAndVerify(evidence, publicKey) {
    const started = performance.now();
    try {
        const response = await fetch(evidence.locator, { signal: AbortSignal.timeout(2000) });
        if (!response.ok) return { ok: false, code: response.status === 404 ? 'MATERIAL_MISSING' : 'MATERIAL_HTTP_ERROR', elapsedMs: performance.now() - started, bytes: 0 };
        const record = await response.json();
        const payload = Buffer.from(record.payload, 'base64');
        const payloadHash = hashValue(record.payload);
        if (record.version !== evidence.version) return { ok: false, code: 'MATERIAL_VERSION_MISMATCH', elapsedMs: performance.now() - started, bytes: payload.length };
        if (payloadHash !== evidence.payloadHash) return { ok: false, code: 'MATERIAL_HASH_MISMATCH', elapsedMs: performance.now() - started, bytes: payload.length };
        if (!crypto.verify(null, Buffer.from(signable(record)), publicKey, Buffer.from(record.signature, 'base64'))) {
            return { ok: false, code: 'MATERIAL_SIGNATURE_MISMATCH', elapsedMs: performance.now() - started, bytes: payload.length };
        }
        return { ok: true, code: 'OK', elapsedMs: performance.now() - started, bytes: payload.length };
    } catch (error) {
        return { ok: false, code: 'MATERIAL_UNAVAILABLE', elapsedMs: performance.now() - started, bytes: 0, detail: error.name };
    }
}

function makeReceipt({ queryId, nodeCount, evidence }) {
    const leaves = evidence.map((item, index) => ({ nodeId: `evidence-${index}`, kind: 'evidence', status: 'SUCCEEDED', version: 'material-v1', outputHash: item.payloadHash }));
    const filler = Array.from({ length: Math.max(0, nodeCount - leaves.length - 1) }, (_, index) => ({ nodeId: `rule-${index}`, kind: 'rule', deps: index ? [`rule-${index - 1}`] : ['evidence-0'], status: 'SUCCEEDED', version: 'rule-v1', output: { index } }));
    const rootDeps = filler.length ? [filler[filler.length - 1].nodeId, ...leaves.slice(1).map((item) => item.nodeId)] : leaves.map((item) => item.nodeId);
    return buildAuditReceipt({
        queryId, queryDigest: hashValue({ queryId, predicate: 'material-audit' }), dagVersion: `material-dag-${nodeCount}`, rootNodeId: 'root', terminalState: 'ANCHORED', outcome: 'SATISFIED',
        nodes: [...leaves, ...filler, { nodeId: 'root', kind: 'root', deps: rootDeps, status: 'SUCCEEDED', version: 'root-v1', output: 'SATISFIED' }],
        evidence, startedAt: '2026-09-06T00:00:00.000Z', completedAt: '2026-09-06T00:00:01.000Z'
    });
}

function expectedCode(condition) {
    return { available: 'OK', missing: 'MATERIAL_MISSING', corrupt: 'MATERIAL_HASH_MISMATCH', wrong_version: 'MATERIAL_VERSION_MISMATCH', bad_signature: 'MATERIAL_SIGNATURE_MISMATCH', unavailable: 'MATERIAL_UNAVAILABLE' }[condition];
}

function parseArgs(argv) {
    const options = { repetitions: 20, sizes: [256, 4096, 16384], nodes: [8, 16, 32, 64], out: null };
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--repetitions') options.repetitions = Number(argv[++i]);
        else if (arg === '--sizes') options.sizes = argv[++i].split(',').map(Number);
        else if (arg === '--nodes') options.nodes = argv[++i].split(',').map(Number);
        else if (arg === '--out') options.out = path.resolve(argv[++i]);
        else throw new Error(`Unknown argument '${arg}'`);
    }
    return options;
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    const out = options.out || path.resolve(process.cwd(), `material-audit-benchmark-${Date.now()}`);
    fs.mkdirSync(out, { recursive: true });
    const keys = crypto.generateKeyPairSync('ed25519');
    const records = new Map();
    for (const size of options.sizes) for (let item = 0; item < 4; item += 1) {
        const materialId = `material-${size}-${item}`;
        const record = { materialId, version: 'v1', payload: createPayload(size, materialId) };
        record.payloadHash = hashValue(record.payload);
        record.signature = crypto.sign(null, Buffer.from(signable(record)), keys.privateKey).toString('base64');
        records.set(materialId, record);
        fs.writeFileSync(path.join(out, `${materialId}.json`), `${JSON.stringify(record)}\n`);
    }
    const { server, port } = await startServer(records);
    const store = new SemanticAuditStore({ dbPath: path.join(out, 'audit.db') });
    const rows = [];
    try {
        for (const nodeCount of options.nodes) for (const size of options.sizes) for (const condition of CONDITIONS) for (let run = 0; run < options.repetitions; run += 1) {
            const queryId = `material-audit-${nodeCount}-${size}-${condition}-${run}`;
            const evidence = [...records.values()].filter((item) => item.materialId.startsWith(`material-${size}-`)).map((item, index) => ({
                evidenceId: `${queryId}:e${index}`, nodeId: `evidence-${index}`, materialId: item.materialId, version: 'v1', payloadHash: item.payloadHash, signature: item.signature,
                locator: condition === 'unavailable' && index === 0 ? 'http://127.0.0.1:9/materials/unavailable' : `http://127.0.0.1:${port}/materials/${item.materialId}${index === 0 && condition !== 'available' ? `?mode=${condition}` : ''}`
            }));
            const receipt = makeReceipt({ queryId, nodeCount, evidence });
            await store.saveReceipt(receipt, { anchorId: `local:${queryId}`, chainId: 'LOCAL_MATERIAL_BENCHMARK', txHash: receipt.receiptRoot, mode: 'local-test-anchor' });
            const started = performance.now();
            const receiptCheck = verifyAuditReceipt(receipt, { anchoredRoot: receipt.receiptRoot });
            const fetched = [];
            for (const item of evidence) fetched.push(await fetchAndVerify(item, keys.publicKey));
            const firstFailure = fetched.find((item) => !item.ok);
            const totalMs = performance.now() - started;
            const reconstructed = receiptCheck.ok && !firstFailure;
            rows.push({ queryId, nodeCount, materialBytes: size, condition, expectedCode: expectedCode(condition), reconstructed, gapCode: firstFailure?.code || 'OK', gapLocated: (firstFailure?.code || 'OK') === expectedCode(condition), materialRequests: evidence.length, fetchedBytes: fetched.reduce((sum, item) => sum + item.bytes, 0), receiptBytes: Buffer.byteLength(JSON.stringify(receipt)), fetchMs: fetched.reduce((sum, item) => sum + item.elapsedMs, 0), totalMs, receiptRoot: receipt.receiptRoot });
        }
    } finally {
        await store.close();
        await new Promise((resolve) => server.close(resolve));
    }
    fs.writeFileSync(path.join(out, 'raw.jsonl'), `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
    const groups = new Map();
    for (const row of rows) {
        const key = `${row.nodeCount}:${row.materialBytes}:${row.condition}`;
        if (!groups.has(key)) groups.set(key, []); groups.get(key).push(row);
    }
    const summary = [...groups.values()].map((values) => ({ nodeCount: values[0].nodeCount, materialBytes: values[0].materialBytes, condition: values[0].condition, n: values.length, reconstructed: values.filter((row) => row.reconstructed).length, gapLocated: values.filter((row) => row.gapLocated).length, materialRequests: values[0].materialRequests, receiptBytes: { p50: percentile(values.map((row) => row.receiptBytes), 0.5), p95: percentile(values.map((row) => row.receiptBytes), 0.95) }, totalMs: { p50: percentile(values.map((row) => row.totalMs), 0.5), p95: percentile(values.map((row) => row.totalMs), 0.95) } }));
    fs.writeFileSync(path.join(out, 'summary.json'), `${JSON.stringify({ schemaVersion: 'material-audit-availability-benchmark-v1', generatedAt: new Date().toISOString(), repetitions: options.repetitions, conditions: CONDITIONS, summary, auditDatabaseBytes: fs.statSync(path.join(out, 'audit.db')).size, evidenceBoundary: ['Materials are real locally persisted JSON payloads fetched through an independent HTTP server', 'The experiment measures controlled material availability and integrity, not long-term production storage durability'] }, null, 2)}\n`);
    process.stdout.write(`${out}\n`);
}

if (require.main === module) main().catch((error) => { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; });

module.exports = { CONDITIONS, createPayload, expectedCode, fetchAndVerify, makeReceipt, percentile };
