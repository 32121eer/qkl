const {
    buildCalibrationCases,
    verdictOf,
    majorityVerdict,
    collectCalibration
} = require('../../../demo/experiments/calibration/llm_calibration');
const { LLMClient } = require('../../../demo/agents/llm_client');

describe('llm calibration', () => {
    test('benchmark has valid + tampered cases with ground truth', () => {
        const cases = buildCalibrationCases({ repeats: 2 });
        expect(cases.length).toBe(12); // 6 templates × 2 repeats
        const tampers = new Set(cases.map((c) => c.tamper));
        expect(tampers.has('none')).toBe(true);
        expect(tampers.has('crypto_fail')).toBe(true);
        for (const c of cases) {
            expect(['VALID', 'INVALID']).toContain(c.groundTruth);
            expect(c.task.evidenceBundle).toBeDefined();
        }
    });

    test('verdict + majority mapping', () => {
        expect(verdictOf('ACCEPT')).toBe('VALID');
        expect(verdictOf('REJECT')).toBe('INVALID');
        expect(verdictOf('QUESTION')).toBe('ABSTAIN');
        expect(majorityVerdict(['VALID', 'VALID', 'INVALID'])).toBe('VALID');
        expect(majorityVerdict(['ABSTAIN', 'ABSTAIN'])).toBe('ABSTAIN');
    });

    test('collectCalibration produces simulator-ready params on the mock backend', async () => {
        const client = new LLMClient({ backend: 'mock' });
        const cases = buildCalibrationCases({ repeats: 3 });
        const result = await collectCalibration({ client, cases, arbiterK: 3 });

        expect(result.backend).toBe('mock');
        expect(result.calibratedParams).toHaveProperty('honestErrorRate');
        expect(result.calibratedParams).toHaveProperty('arbiterErrorFactor');
        expect(result.calibratedParams.honestErrorRate).toBeGreaterThanOrEqual(0);
        expect(result.calibratedParams.honestErrorRate).toBeLessThanOrEqual(1);
        // The mock REJECTs on crypto_fail with high confidence → that tamper class
        // should be detected (error rate < 1 for that class).
        expect(result.byTamper.crypto_fail.errorRate).toBeLessThan(1);
    });
});
