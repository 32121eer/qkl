#!/usr/bin/env node
// Runs cases from demo-data/test-cases/app-query.cases.json against the demo API.
// Usage: node scripts/test-app-query.js [path/to/cases.json] [--base http://host:port]

const fs = require('node:fs');
const path = require('node:path');

const args = process.argv.slice(2);
let casesPath = path.resolve(__dirname, '../demo-data/test-cases/app-query.cases.json');
let baseOverride = null;
for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--base') { baseOverride = args[i + 1]; i += 1; continue; }
    if (!args[i].startsWith('--')) casesPath = path.resolve(args[i]);
}

const spec = JSON.parse(fs.readFileSync(casesPath, 'utf8'));
const baseUrl = baseOverride || spec.baseUrl || 'http://localhost:18080';
const endpoint = spec.endpoint || '/demo/app/query/request';
const headers = spec.headers || { 'Content-Type': 'application/json' };

function pickPath(obj, dotPath) {
    return dotPath.split('.').reduce((acc, k) => (acc == null ? acc : acc[k]), obj);
}

function checkExpect(expect, status, body) {
    const errors = [];
    if (typeof expect.status === 'number' && status !== expect.status) {
        errors.push(`status ${status} !== ${expect.status}`);
    }
    for (const [rawKey, expected] of Object.entries(expect.jsonPath || {})) {
        if (rawKey.endsWith('.startsWith')) {
            const key = rawKey.slice(0, -'.startsWith'.length);
            const actual = pickPath(body, key);
            if (typeof actual !== 'string' || !actual.startsWith(expected)) {
                errors.push(`${key} ('${actual}') does not start with '${expected}'`);
            }
        } else if (rawKey.endsWith('.contains')) {
            const key = rawKey.slice(0, -'.contains'.length);
            const actual = pickPath(body, key);
            if (typeof actual !== 'string' || !actual.includes(expected)) {
                errors.push(`${key} ('${actual}') does not contain '${expected}'`);
            }
        } else {
            const actual = pickPath(body, rawKey);
            if (actual !== expected) {
                errors.push(`${rawKey} = ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
            }
        }
    }
    return errors;
}

async function run() {
    const url = baseUrl.replace(/\/+$/, '') + endpoint;
    let pass = 0;
    let fail = 0;
    const created = [];

    console.log(`[app-query] POST ${url}\n[app-query] cases: ${spec.cases.length}\n`);

    for (const c of spec.cases) {
        process.stdout.write(`- ${c.name.padEnd(28)} `);
        let status = 0;
        let body = null;
        try {
            const resp = await fetch(url, {
                method: spec.method || 'POST',
                headers,
                body: JSON.stringify(c.body ?? {})
            });
            status = resp.status;
            const text = await resp.text();
            try { body = JSON.parse(text); } catch { body = { _raw: text }; }
        } catch (err) {
            console.log(`FAIL  network error: ${err.message}`);
            fail += 1;
            continue;
        }

        const errors = checkExpect(c.expect || {}, status, body);
        if (errors.length === 0) {
            console.log(`PASS  (${status})`);
            pass += 1;
            if (body?.queryId) created.push(body.queryId);
        } else {
            console.log(`FAIL  (${status})`);
            for (const e of errors) console.log(`        ${e}`);
            console.log(`        body: ${JSON.stringify(body).slice(0, 200)}`);
            fail += 1;
        }
    }

    if (created.length) {
        console.log(`\n[app-query] follow-up: GET /demo/app/query/sessions (limit=5)`);
        const list = await fetch(`${baseUrl}/demo/app/query/sessions?limit=5`).then((r) => r.json()).catch(() => null);
        console.log(`  sessions returned: ${list?.items?.length ?? 'ERR'}`);
        const probeId = created[0];
        console.log(`[app-query] follow-up: GET /demo/app/query/sessions/${probeId}`);
        const one = await fetch(`${baseUrl}/demo/app/query/sessions/${probeId}`).then((r) => r.json()).catch(() => null);
        console.log(`  status: ${one?.item?.status || 'unknown'}`);
    }

    console.log(`\n[app-query] ${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
}

run().catch((err) => { console.error(err); process.exit(2); });
