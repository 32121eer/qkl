const {
    buildCases, parseVerdict, pearson, summarizeSamples
} = require('../../../demo/experiments/model_benchmark/extended_model_benchmark');

describe('extended real-model benchmark', () => {
    test('builds 120 unique, balanced, model-independent labeled cases', () => {
        const cases = buildCases();
        expect(cases).toHaveLength(120);
        expect(new Set(cases.map((item) => item.id)).size).toBe(120);
        expect(cases.filter((item) => item.truth === 'ACCEPT')).toHaveLength(60);
        expect(cases.filter((item) => item.truth === 'REJECT')).toHaveLength(60);
        expect(new Set(cases.map((item) => item.family)).size).toBe(6);
    });

    test('parses strict structured verdicts and rejects malformed responses', () => {
        expect(parseVerdict('{"judgment":"ACCEPT","confidence":0.8}')).toEqual({
            judgment: 'ACCEPT', confidence: 0.8
        });
        expect(parseVerdict('ACCEPT')).toBeNull();
    });

    test('reports calibration, false accepts and false rejects from completed samples', () => {
        const summary = summarizeSamples([
            { truth: 'ACCEPT', judgment: 'ACCEPT', confidence: 0.8, correct: true },
            { truth: 'ACCEPT', judgment: 'REJECT', confidence: 0.7, correct: false },
            { truth: 'REJECT', judgment: 'ACCEPT', confidence: 0.6, correct: false },
            { truth: 'REJECT', judgment: 'REJECT', confidence: 0.9, correct: true }
        ]);
        expect(summary).toMatchObject({
            requested: 4, completed: 4, accuracy: 0.5,
            falseAcceptRate: 0.5, falseRejectRate: 0.5
        });
        expect(summary.brierScore).toBeGreaterThan(0);
        expect(summary.expectedCalibrationError).toBeGreaterThan(0);
    });

    test('reports an incomplete backend run without serializing NaN values', () => {
        expect(summarizeSamples([
            { truth: 'ACCEPT', judgment: null, confidence: null, error: 'backend unavailable' }
        ])).toEqual({
            requested: 1,
            completed: 0,
            errors: 1,
            accuracy: null,
            falseAcceptRate: null,
            falseRejectRate: null,
            meanConfidence: null,
            brierScore: null,
            expectedCalibrationError: null
        });
    });

    test('computes cross-model error correlation', () => {
        expect(pearson([0, 1, 0, 1], [0, 1, 0, 1])).toBe(1);
        expect(pearson([0, 1, 0, 1], [1, 0, 1, 0])).toBe(-1);
    });
});
