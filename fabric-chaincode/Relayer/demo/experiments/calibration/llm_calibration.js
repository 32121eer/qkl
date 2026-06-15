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
 * Run the labeled benchmark through the LLM client.
 * @param {Object} client - an LLMClient (createLLMClientFromEnv)
 */
async function collectCalibration({ client, cases, arbiterK = 5 } = {}) {
    const verifier = emptyAgg();
    const arbiter = emptyAgg();
    const byTamper = {};

    for (const testCase of cases) {
        const { task, groundTruth, tamper } = testCase;
        byTamper[tamper] = byTamper[tamper] || emptyAgg();

        // Single line verifier.
        const v = await client.verify(task, {});
        const vVerdict = verdictOf(v.judgment);
        recordVerdict(verifier, vVerdict, groundTruth, v.confidence);
        recordVerdict(byTamper[tamper], vVerdict, groundTruth, v.confidence);

        // Arbiter committee: k independent calls, majority verdict.
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
    const arbiterErrorFactor = verifierSummary.errorRate > 0
        ? round6(arbiterSummary.errorRate / verifierSummary.errorRate)
        : 0;

    return {
        backend: client.backend,
        model: client.model,
        arbiterK,
        caseCount: cases.length,
        verifier: verifierSummary,
        arbiter: arbiterSummary,
        // ↓ exactly what the simulator needs (replaces hand-picked defaults).
        calibratedParams: {
            honestErrorRate: verifierSummary.errorRate,
            arbiterErrorFactor,
            meanConfidenceCorrect: verifierSummary.meanConfidenceCorrect,
            meanConfidenceWrong: verifierSummary.meanConfidenceWrong
        },
        byTamper: Object.fromEntries(Object.entries(byTamper).map(([k, v]) => [k, summarizeAgg(v)]))
    };
}

module.exports = {
    VALID,
    INVALID,
    buildCalibrationCases,
    verdictOf,
    majorityVerdict,
    collectCalibration
};
