const { DagScheduler, validateDag } = require('../../../demo/semantic_query/dag_scheduler');
const {
    buildShapeDag,
    parseArgs,
    regulatoryScenario,
    runServiceSchedulingAblation
} = require('../../../demo/semantic_query/experiments/run_extended_evaluation');

describe('extended semantic-query evaluation helpers', () => {
    test('builds valid DAGs with exact requested sizes', async () => {
        for (const shape of ['wide', 'balanced', 'deep']) {
            const nodes = buildShapeDag({ nodeCount: 16, shape, evidenceBytes: 32, nodeDelayMs: 0 });
            expect(nodes).toHaveLength(16);
            expect(() => validateDag(nodes)).not.toThrow();
            const result = await new DagScheduler({ concurrency: 8 }).execute({
                queryId: `shape-${shape}`, nodes, rootNodeId: 'root'
            });
            expect(result.outcome).toBe('SATISFIED');
        }
    });

    test('defines explicit ground truth for every regulatory scenario', () => {
        expect(regulatoryScenario('normal', 'q')).toMatchObject({ expectedOutcome: 'SATISFIED' });
        expect(regulatoryScenario('over_limit', 'q')).toMatchObject({ expectedOutcome: 'UNSATISFIED' });
        expect(regulatoryScenario('missing_disclosure', 'q')).toMatchObject({
            expectedTerminal: 'INSUFFICIENT_EVIDENCE', expectedOutcome: 'INSUFFICIENT'
        });
    });

    test('keeps exploratory service scheduling deterministic', () => {
        const left = runServiceSchedulingAblation({ quick: true });
        const right = runServiceSchedulingAblation({ quick: true });
        expect(left).toEqual(right);
        expect(left.find((row) => row.strategy === 'reliability_load_diversity').callsPerTask).toBe(2);
    });

    test('supports a bounded quick mode', () => {
        expect(parseArgs(['--quick'])).toMatchObject({ runs: 1, queries: 2, quick: true });
    });
});
