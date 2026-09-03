const {
    expectedBehavior,
    parseArgs,
    scenarioPlan
} = require('../../../demo/semantic_query/experiments/run_live_regulatory');
const {
    REGULATORY_SCENARIOS,
    scenarioRecord
} = require('../../../demo/semantic_query/experiments/seed_live_regulatory');

describe('live regulatory experiment helpers', () => {
    test('creates ledger-resident scenario records with bounded differences', () => {
        expect(REGULATORY_SCENARIOS).toHaveLength(5);
        expect(scenarioRecord('normal').transaction.amount).toBe(480000);
        expect(scenarioRecord('over_limit').transaction.amount).toBe(500001);
        expect(scenarioRecord('subject_mismatch').transaction.entityId).toBe('ENTITY-REG-OTHER');
        expect(scenarioRecord('missing_disclosure').fabricPayload.data.disclosure.filed).toBeUndefined();
    });

    test('parses quick mode and rejects unknown scenarios', () => {
        expect(parseArgs(['--quick'])).toMatchObject({ runs: 1, queries: 1, warmup: 0 });
        expect(() => parseArgs(['--scenarios', 'unknown'])).toThrow('Unknown scenarios');
    });

    test('injects only the declared endpoint recovery scenario', () => {
        expect(scenarioPlan('normal', 'q')).toEqual([]);
        expect(scenarioPlan('endpoint_retry', 'q')).toEqual([
            expect.objectContaining({ queryId: 'q', nodeId: 'entity_fabric', recoverable: true })
        ]);
    });

    test('classifies the three regulatory outcome classes', () => {
        expect(expectedBehavior('normal', { terminalState: 'ANCHORED', outcome: 'SATISFIED' })).toBe(true);
        expect(expectedBehavior('over_limit', { terminalState: 'ANCHORED', outcome: 'UNSATISFIED' })).toBe(true);
        expect(expectedBehavior('missing_disclosure', {
            terminalState: 'INSUFFICIENT_EVIDENCE', outcome: 'INSUFFICIENT'
        })).toBe(true);
    });
});
