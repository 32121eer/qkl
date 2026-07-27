/**
 * Experiment 5.7 — Model heterogeneity & correlated failure (paper §VIII, Q1 supplement).
 *
 * Claim: multiple agents are NOT automatically independent. If agents call the SAME
 * model (or the same provider), their errors are CORRELATED — so an organization-diverse
 * but model-homogeneous committee can fail together, defeating Byzantine-robust
 * aggregation. Only genuine MODEL heterogeneity decorrelates failures.
 *
 * Real measurement: two architecturally different open models served locally by Ollama
 * on an RTX 4090 — meta `llama3.1:8b` and Alibaba `qwen2.5:7b` — judge a labelled
 * cross-chain semantic benchmark (supply-chain finance / regulatory / cold-chain), each
 * case sampled R times at temperature T. We then measure, over the per-case-repeat error
 * vectors, the pairwise error correlation of SAME-model agent pairs vs CROSS-model pairs,
 * and the false-accept rate of homogeneous vs heterogeneous 3-agent committees on the
 * INVALID cases. Output: correlated_failure_results.json.
 *
 * Self-contained: Node ≥18 built-in fetch, no deps. Run on the GPU box:
 *   OLLAMA=http://127.0.0.1:11434 node run_correlated_failure.js
 */

const fs = require('fs');
const path = require('path');

const OLLAMA = process.env.OLLAMA || 'http://127.0.0.1:11434';
const MODELS = (process.env.MODELS || 'llama3.1:8b,qwen2.5:7b').split(',');
const REPEATS = Number(process.env.REPEATS || 8);
const TEMP = Number(process.env.TEMP || 0.7);

// Labelled benchmark. Each case: a cross-chain evidence summary + a business-semantic
// question. groundTruth ACCEPT = the cross-chain state truly satisfies the business
// predicate; REJECT = it does not. Mix of clear and genuinely ambiguous/numeric cases
// (the latter elicit real model errors, where correlation can be measured).
const CASES = [
    { id: 'sf1', truth: 'REJECT', text: 'Supply-chain finance. Financing deadline: 2026-03-15. Shipment-on-chain record timestamp: 2026-03-18. Rule: goods must ship on or before the financing deadline. Does the on-chain evidence satisfy the financing condition?' },
    { id: 'sf2', truth: 'ACCEPT', text: 'Supply-chain finance. Financing deadline: 2026-03-20. Shipment timestamp: 2026-03-12. Rule: ship on or before deadline. Does the evidence satisfy the condition?' },
    { id: 'sf3', truth: 'REJECT', text: 'Invoice financing. Approved credit limit: 500000 CNY. Invoice total on source chain: 512300 CNY. Rule: invoice total must not exceed the approved limit. Satisfied?' },
    { id: 'sf4', truth: 'ACCEPT', text: 'Invoice financing. Approved limit: 500000 CNY. Invoice total: 498900 CNY. Rule: must not exceed limit. Satisfied?' },
    { id: 'sf5', truth: 'REJECT', text: 'Two source records must agree. Purchase order quantity: 1200 units. Warehouse receipt quantity on chain: 1020 units. Rule: receipt quantity must equal PO quantity for release. Satisfied?' },
    { id: 'reg1', truth: 'REJECT', text: 'Regulatory audit. Required: emissions report filed within 30 days of quarter end. Quarter end: 2026-03-31. On-chain filing date: 2026-05-02. Satisfied?' },
    { id: 'reg2', truth: 'ACCEPT', text: 'Regulatory audit. Required: KYC refreshed within 12 months. Last KYC on chain: 2025-08-10. Current date: 2026-03-01. Satisfied?' },
    { id: 'reg3', truth: 'REJECT', text: 'AML rule: single transfer above 200000 CNY requires a linked approval record. On-chain transfer: 240000 CNY. Linked approval record: absent. Satisfied?' },
    { id: 'cc1', truth: 'REJECT', text: 'Cold-chain. Vaccine must stay within 2C..8C the whole trip. On-chain temperature log shows a reading of 11.4C at hour 6 of a 20-hour trip. Is the cold-chain integrity satisfied?' },
    { id: 'cc2', truth: 'ACCEPT', text: 'Cold-chain. Range 2C..8C. On-chain log readings: 3.1, 4.0, 5.5, 4.8, 6.2 C across the trip. Integrity satisfied?' },
    { id: 'cc3', truth: 'REJECT', text: 'Cold-chain duration. Max allowed transit 48 hours. On-chain depart 2026-02-10 08:00, arrive 2026-02-12 14:00. Satisfied?' },
    { id: 'amb1', truth: 'ACCEPT', text: 'Financing deadline 2026-03-15 23:59 (inclusive). Shipment timestamp 2026-03-15 09:30. Rule: ship on or before deadline. Satisfied?' },
    { id: 'amb2', truth: 'REJECT', text: 'Discount window: payment within 10 days of invoice (invoice date counts as day 0). Invoice date 2026-04-01. On-chain payment 2026-04-12. Eligible for early-payment discount?' },
    { id: 'amb3', truth: 'ACCEPT', text: 'Quantity tolerance 2% allowed. PO quantity 1000 units. Delivered on chain 1015 units. Rule: within +/-2% is acceptable. Satisfied?' },
    { id: 'amb4', truth: 'REJECT', text: 'Quantity tolerance 2%. PO 1000 units. Delivered on chain 1025 units. Within tolerance?' },
    { id: 'amb5', truth: 'ACCEPT', text: 'Multi-currency. Approved limit 70000 USD. Invoice on chain 480000 CNY. Reference FX 1 USD = 7.1 CNY. Does invoice stay within the approved USD limit?' }
];

function buildPrompt(c) {
    return `You are a cross-chain evidence verifier. Decide whether the on-chain evidence ` +
        `satisfies the stated business rule. Reason carefully about dates, numbers and ` +
        `thresholds. Respond with ONLY a compact JSON object: {"judgment":"ACCEPT"|"REJECT",` +
        `"confidence":0..1}. ACCEPT = the rule is satisfied, REJECT = it is not.\n\nCASE:\n${c.text}`;
}

function parseVerdict(txt) {
    if (!txt) return null;
    const m = txt.match(/\{[^{}]*\}/);
    let obj = null;
    if (m) { try { obj = JSON.parse(m[0]); } catch (_) { obj = null; } }
    let j = obj && obj.judgment;
    if (!j) {
        const up = txt.toUpperCase();
        if (up.includes('REJECT')) j = 'REJECT';
        else if (up.includes('ACCEPT')) j = 'ACCEPT';
    }
    j = String(j || '').toUpperCase();
    if (j !== 'ACCEPT' && j !== 'REJECT') return null;
    let conf = obj && Number(obj.confidence);
    if (!Number.isFinite(conf)) conf = 0.5;
    return { judgment: j, confidence: Math.max(0, Math.min(1, conf)) };
}

async function ollamaGenerate(model, prompt) {
    const res = await fetch(`${OLLAMA}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model, prompt, stream: false,
            options: { temperature: TEMP, num_predict: 160 }
        })
    });
    if (!res.ok) throw new Error(`ollama ${model} HTTP ${res.status}`);
    const j = await res.json();
    return j.response || '';
}

// Pearson correlation of two equal-length binary vectors.
function pearson(a, b) {
    const n = a.length;
    if (!n) return 0;
    const ma = a.reduce((s, x) => s + x, 0) / n;
    const mb = b.reduce((s, x) => s + x, 0) / n;
    let num = 0; let da = 0; let db = 0;
    for (let i = 0; i < n; i += 1) {
        num += (a[i] - ma) * (b[i] - mb);
        da += (a[i] - ma) ** 2;
        db += (b[i] - mb) ** 2;
    }
    if (da === 0 || db === 0) return 0; // no variance (a constant error vector)
    return num / Math.sqrt(da * db);
}
const round = (x, d = 4) => Number(Number(x).toFixed(d));
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);

async function collect() {
    // samples[model] = array over (case,repeat) of {caseId, truth, judgment, correct}
    const samples = {};
    for (const model of MODELS) samples[model] = [];
    for (const c of CASES) {
        for (let r = 0; r < REPEATS; r += 1) {
            for (const model of MODELS) {
                let v = null;
                try { v = parseVerdict(await ollamaGenerate(model, buildPrompt(c))); } catch (e) { v = null; }
                const judgment = v ? v.judgment : 'REJECT'; // unpar. → conservative REJECT
                const correct = judgment === c.truth ? 1 : 0;
                samples[model].push({ caseId: c.id, truth: c.truth, judgment, correct, error: 1 - correct });
                process.stdout.write(`${c.id} r${r} ${model.padEnd(14)} -> ${judgment} ${correct ? 'ok' : 'ERR'}\n`);
            }
        }
    }
    return samples;
}

function analyze(samples) {
    const [mA, mB] = MODELS;
    // Build agent "instances": split each model's repeats into two independent streams
    // (even/odd repeats) → a1,a2 (same model A); b1,b2 (same model B). Align by index.
    const split = (arr) => {
        const e = arr.filter((_, i) => i % 2 === 0);
        const o = arr.filter((_, i) => i % 2 === 1);
        const n = Math.min(e.length, o.length);
        return [e.slice(0, n), o.slice(0, n)];
    };
    const [a1, a2] = split(samples[mA]);
    const [b1, b2] = split(samples[mB]);
    const errVec = (arr) => arr.map((s) => s.error);
    const n = Math.min(a1.length, b1.length);
    const A1 = errVec(a1).slice(0, n); const A2 = errVec(a2).slice(0, n);
    const B1 = errVec(b1).slice(0, n); const B2 = errVec(b2).slice(0, n);

    const sameModelCorr = round(mean([pearson(A1, A2), pearson(B1, B2)]));
    const crossModelCorr = round(mean([
        pearson(A1, B1), pearson(A1, B2), pearson(A2, B1), pearson(A2, B2)
    ]));

    // Per-model accuracy.
    const acc = {};
    for (const m of MODELS) acc[m] = round(mean(samples[m].map((s) => s.correct)));

    // Committee false-accept on INVALID (truth=REJECT) cases: majority of 3 agents
    // votes ACCEPT ⇒ false accept. Homogeneous = 3 same-model samples; heterogeneous
    // = model A, model B, model A (mix). Evaluate per case using independent repeats.
    const invalidCases = CASES.filter((c) => c.truth === 'REJECT').map((c) => c.id);
    const byCaseModel = {};
    for (const m of MODELS) {
        byCaseModel[m] = {};
        for (const s of samples[m]) {
            (byCaseModel[m][s.caseId] = byCaseModel[m][s.caseId] || []).push(s.judgment);
        }
    }
    const faRate = (picker) => {
        let fa = 0; let tot = 0;
        for (const cid of invalidCases) {
            const votes = picker(cid);
            if (votes.length < 3) continue;
            const accept = votes.filter((v) => v === 'ACCEPT').length;
            if (accept >= 2) fa += 1; // majority ACCEPT on an INVALID case = false accept
            tot += 1;
        }
        return tot ? round(fa / tot) : 0;
    };
    const homoFA = faRate((cid) => {
        const v = byCaseModel[mA][cid] || [];
        return [v[0], v[1], v[2]].filter(Boolean);
    });
    const heteroFA = faRate((cid) => {
        const va = byCaseModel[mA][cid] || []; const vb = byCaseModel[mB][cid] || [];
        return [va[0], vb[0], va[1]].filter(Boolean);
    });

    return {
        models: MODELS,
        perModelAccuracy: acc,
        errorCorrelation: { sameModel: sameModelCorr, crossModel: crossModelCorr },
        committeeFalseAccept: { homogeneous_sameModel: homoFA, heterogeneous_crossModel: heteroFA },
        conditions: {
            'a_all_same_model': { errorCorrelation: sameModelCorr, falseAccept: homoFA },
            'b_different_models': { errorCorrelation: crossModelCorr, falseAccept: heteroFA },
            'c_diff_org_same_provider': { errorCorrelation: sameModelCorr, falseAccept: homoFA,
                note: 'org/provider diversity without model diversity ⇒ same correlation as (a)' },
            'd_diff_org_diff_model': { errorCorrelation: crossModelCorr, falseAccept: heteroFA }
        }
    };
}

(async () => {
    const t0 = Date.now();
    const samples = await collect();
    const analysis = analyze(samples);
    const out = {
        experiment: '5.7-model-heterogeneity-correlated-failure',
        config: { ollama: OLLAMA, models: MODELS, repeats: REPEATS, temperature: TEMP, cases: CASES.length },
        ...analysis,
        rawCounts: Object.fromEntries(MODELS.map((m) => [m, samples[m].length])),
        // Raw per-(model,case,repeat) judgments — lets a downstream harness feed REAL
        // honest judgments into the aggregation/baselines (real-judgment-driven D.2) and
        // recompute measured pᵢ / ρ without re-running inference.
        rawSamples: Object.fromEntries(MODELS.map((m) => [m,
            samples[m].map((s) => ({ caseId: s.caseId, truth: s.truth, judgment: s.judgment, correct: s.correct }))])),
        casesMeta: CASES.map((c) => ({ id: c.id, truth: c.truth })),
        elapsedSec: round((Date.now() - t0) / 1000, 1),
        meta: { generatedAt: new Date().toISOString() }
    };
    const outPath = path.join(__dirname, 'correlated_failure_results.json');
    fs.writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`);
    // Also write a compact raw-samples file for the real-judgment-driven D.2 harness.
    fs.writeFileSync(path.join(__dirname, 'raw_samples.json'),
        `${JSON.stringify({ models: MODELS, casesMeta: out.casesMeta, rawSamples: out.rawSamples }, null, 2)}\n`);
    process.stdout.write('\n=== 5.7 correlated failure ===\n');
    process.stdout.write(`accuracy: ${JSON.stringify(out.perModelAccuracy)}\n`);
    process.stdout.write(`error correlation: same-model=${out.errorCorrelation.sameModel} ` +
        `cross-model=${out.errorCorrelation.crossModel}\n`);
    process.stdout.write(`committee false-accept: homogeneous=${out.committeeFalseAccept.homogeneous_sameModel} ` +
        `heterogeneous=${out.committeeFalseAccept.heterogeneous_crossModel}\n`);
    process.stdout.write(`wrote ${outPath}\n`);
})().catch((e) => { console.error(e); process.exit(1); });
