/**
 * LLM calibration harness.
 *
 * Purpose: replace the two hand-picked numbers the simulator pulls from thin air
 * — the line-verifier honest error rate and the arbiter/verifier error ratio —
 * with values MEASURED from the real LLM backend the production agents use
 * (`demo/agents/llm_client.js`, same `verify()` path).
 *
 * Method: build a labeled benchmark of evidence bundles (valid + several tamper
 * types, each with ground truth), run each through the LLM verifier, and through
 * a k-of majority "arbiter committee" (literally k independent verifier calls,
 * which is what Phase-4 arbitration is). Report error rates, abstention, and
 * confidence distributions, then emit a calibration.json the simulator consumes.
 *
 * On this macOS box there is no API key / reachable chain, so it runs against the
 * `mock` backend as a pipeline smoke test. Real numbers: set AGENT_LLM_BACKEND
 * (+ key / base URL) and re-run on the WSL host. See docs/xn/验证方案-方法对比评估.md.
 */

function round6(value) {
    return Number((Number(value) || 0).toFixed(6));
}

const VALID = 'VALID';
const INVALID = 'INVALID';

/**
 * Labeled benchmark. Field aliases match what llm_client.buildVerificationPrompt
 * and mockVerify actually read (payload, blockHeight/sourceHeader.number, txHash,
 * preVerification.status).
 */
function buildCalibrationCases({ repeats = 5 } = {}) {
    const cases = [];
    const expectedPayload = { orchardBatchId: 'BATCH-APPLE-0001', status: 'CERTIFIED', grade: 'A' };

    const goodEvidence = () => ({
        blockHeight: 1039,
        txHash: '0xabc123def4567890',
        sourceHeader: { number: 1039, hash: '0xheaderhash' },
        sourceTxHash: '0xabc123def4567890',
        payload: { ...expectedPayload },
        preVerification: { status: 'PASS' }
    });

    const templates = [
        { tamper: 'none', groundTruth: VALID, mutate: (e) => e },
        { tamper: 'crypto_fail', groundTruth: INVALID, mutate: (e) => ({ ...e, preVerification: { status: 'FAIL' } }) },
        { tamper: 'missing_txhash', groundTruth: INVALID, mutate: (e) => ({ ...e, txHash: undefined, sourceTxHash: undefined }) },
        { tamper: 'missing_payload', groundTruth: INVALID, mutate: (e) => ({ ...e, payload: undefined }) },
        { tamper: 'height_out_of_range', groundTruth: INVALID, mutate: (e) => ({ ...e, blockHeight: 99, sourceHeader: { number: 99 } }) },
        { tamper: 'payload_mismatch', groundTruth: INVALID, mutate: (e) => ({ ...e, payload: { orchardBatchId: 'WRONG-9999', status: 'REVOKED' } }) }
    ];

    let id = 0;
    for (let r = 0; r < repeats; r += 1) {
        for (const tpl of templates) {
            id += 1;
            const evidence = tpl.mutate(goodEvidence());
            cases.push({
                id: `cal-${String(id).padStart(3, '0')}`,
                tamper: tpl.tamper,
                groundTruth: tpl.groundTruth,
                task: {
                    queryId: `cal_${id}`,
                    sourceChain: 'fabric',
                    targetChain: 'fisco',
                    risk: tpl.groundTruth === INVALID ? 'CRITICAL' : 'NORMAL',
                    evidenceBundle: evidence,
                    query: { type: 'orchardRecord', expected: expectedPayload }
                }
            });
        }
    }
    return cases;
}

function verdictOf(judgment) {
    if (judgment === 'ACCEPT') return VALID;
    if (judgment === 'REJECT') return INVALID;
    return 'ABSTAIN';
}

function majorityVerdict(verdicts) {
    const counts = verdicts.reduce((acc, v) => { acc[v] = (acc[v] || 0) + 1; return acc; }, {});
    const decisive = ['VALID', 'INVALID'].filter((v) => counts[v]);
    if (!decisive.length) return 'ABSTAIN';
    return decisive.sort((a, b) => (counts[b] || 0) - (counts[a] || 0))[0];
}

function emptyAgg() {
    return { total: 0, decisive: 0, correctDecisive: 0, wrongDecisive: 0, abstain: 0, confSumCorrect: 0, confSumWrong: 0 };
}

function recordVerdict(agg, verdict, groundTruth, confidence) {
    agg.total += 1;
    if (verdict === 'ABSTAIN') {
        agg.abstain += 1;
        return;
    }
    agg.decisive += 1;
    if (verdict === groundTruth) {
        agg.correctDecisive += 1;
        agg.confSumCorrect += Number(confidence) || 0;
    } else {
        agg.wrongDecisive += 1;
        agg.confSumWrong += Number(confidence) || 0;
    }
}

function summarizeAgg(agg) {
    const decisive = agg.decisive || 0;
    return {
        total: agg.total,
        // errorRate among DECISIVE judgments = the sim's honestErrorRate analogue.
        errorRate: round6(decisive ? agg.wrongDecisive / decisive : 0),
        abstainRate: round6(agg.total ? agg.abstain / agg.total : 0),
        meanConfidenceCorrect: round6(agg.correctDecisive ? agg.confSumCorrect / agg.correctDecisive : 0),
        meanConfidenceWrong: round6(agg.wrongDecisive ? agg.confSumWrong / agg.wrongDecisive : 0)
    };
}

/**
 * Layer-1 deterministic gate (论文 A 型证明验证器：确定性密码/结构预验证).
 * Cryptographic-proof failure, missing tx hash, missing payload, and block heights
 * outside the light client's committed range are decidable WITHOUT an LLM, so the
 * production architecture rejects them here and they never reach semantic consensus.
 * Returns { pass:true } or { pass:false, reason }. A FAIL on an INVALID case is a
 * correct deterministic rejection; it is NOT a semantic-layer error.
 *
 * LIGHT_CLIENT_MIN_HEIGHT models the lowest header height the light client has
 * committed in this benchmark (good evidence anchors at 1039); a height below it is
 * not in the light client's state and is rejected deterministically.
 */
const LIGHT_CLIENT_MIN_HEIGHT = 1000;

function deterministicPreCheck(evidence) {
    if (!evidence) return { pass: false, reason: 'no evidence' };
    if (evidence.preVerification && evidence.preVerification.status === 'FAIL') {
        return { pass: false, reason: 'cryptographic/proof verification failed' };
    }
    if (!evidence.txHash || !evidence.sourceTxHash) {
        return { pass: false, reason: 'missing transaction hash' };
    }
    if (!evidence.payload) {
        return { pass: false, reason: 'missing payload (structural)' };
    }
    const h = Number(evidence.blockHeight);
    const headerH = Number(evidence.sourceHeader && evidence.sourceHeader.number);
    if (!Number.isFinite(h) || h !== headerH) {
        return { pass: false, reason: 'block height / header number mismatch' };
    }
    if (h < LIGHT_CLIENT_MIN_HEIGHT) {
        return { pass: false, reason: 'block height outside light-client committed range' };
    }
    return { pass: true };
}

/**
 * Run the labeled benchmark through the two-layer architecture:
 *   Layer 1 (deterministic gate) → Layer 2 (LLM semantic verifier + arbiter committee).
 * Only evidence that PASSES Layer 1 reaches the LLM, so honestErrorRate reflects the
 * SEMANTIC layer alone (what the simulator's pᵢ actually models).
 * @param {Object} client - an LLMClient (createLLMClientFromEnv)
 */
async function collectCalibration({ client, cases, arbiterK = 5 } = {}) {
    const verifier = emptyAgg();      // semantic layer only (post-gate)
    const arbiter = emptyAgg();       // semantic-layer arbiter committee
    const deterministic = emptyAgg(); // Layer-1 gate outcomes
    const byTamper = {};

    for (const testCase of cases) {
        const { task, groundTruth, tamper } = testCase;
        if (!byTamper[tamper]) byTamper[tamper] = { layer: null, agg: emptyAgg() };

        const gate = deterministicPreCheck(task.evidenceBundle);
        if (!gate.pass) {
            // Layer 1 rejects deterministically — correct iff ground truth is INVALID.
            recordVerdict(deterministic, INVALID, groundTruth, 1.0);
            byTamper[tamper].layer = 'deterministic';
            recordVerdict(byTamper[tamper].agg, INVALID, groundTruth, 1.0);
            continue; // never reaches the LLM
        }

        // Layer 2 — single LLM line verifier.
        byTamper[tamper].layer = 'semantic';
        const v = await client.verify(task, {});
        const vVerdict = verdictOf(v.judgment);
        recordVerdict(verifier, vVerdict, groundTruth, v.confidence);
        recordVerdict(byTamper[tamper].agg, vVerdict, groundTruth, v.confidence);

        // Layer 2 — arbiter committee: k independent calls, majority verdict.
        const verdicts = [];
        let confAccum = 0;
        for (let i = 0; i < arbiterK; i += 1) {
            const a = await client.verify(task, { arbiter: true });
            verdicts.push(verdictOf(a.judgment));
            confAccum += Number(a.confidence) || 0;
        }
        recordVerdict(arbiter, majorityVerdict(verdicts), groundTruth, confAccum / arbiterK);
    }

    const verifierSummary = summarizeAgg(verifier);
    const arbiterSummary = summarizeAgg(arbiter);
    const deterministicSummary = summarizeAgg(deterministic);
    const arbiterErrorFactor = verifierSummary.errorRate > 0
        ? round6(arbiterSummary.errorRate / verifierSummary.errorRate)
        : 0;

    return {
        backend: client.backend,
        model: client.model,
        arbiterK,
        caseCount: cases.length,
        // Layer 1: deterministic gate (errorRate 0 ⇒ all structural/crypto tampers caught here).
        deterministicLayer: deterministicSummary,
        // Layer 2: semantic verifier (only post-gate cases) — this is the simulator's pᵢ.
        verifier: verifierSummary,
        arbiter: arbiterSummary,
        // ↓ exactly what the simulator needs (replaces hand-picked defaults).
        calibratedParams: {
            honestErrorRate: verifierSummary.errorRate,
            arbiterErrorFactor,
            meanConfidenceCorrect: verifierSummary.meanConfidenceCorrect,
            meanConfidenceWrong: verifierSummary.meanConfidenceWrong
        },
        byTamper: Object.fromEntries(Object.entries(byTamper).map(([k, v]) => [k, { layer: v.layer, ...summarizeAgg(v.agg) }]))
    };
}

module.exports = {
    VALID,
    INVALID,
    buildCalibrationCases,
    verdictOf,
    majorityVerdict,
    deterministicPreCheck,
    collectCalibration
};
