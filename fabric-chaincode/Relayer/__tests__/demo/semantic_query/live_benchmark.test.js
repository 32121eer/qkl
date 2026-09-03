const {
    DEFAULT_SCENARIOS,
    expectedBehavior,
    parseArgs,
    percentile,
    readHeight,
    runBounded,
    scenarioPlan,
    summarize
} = require('../../../demo/semantic_query/experiments/run_live_benchmark');

describe('live semantic-query benchmark helpers', () => {
    test('provides a bounded quick mode and validates scenario names', () => {
        expect(parseArgs(['--quick', '--query-concurrency', '4', '--anchor-wallets', '3'])).toMatchObject({
            runs: 1, queries: 1, warmup: 0, queryConcurrency: 4, anchorWallets: 3
        });
        expect(() => parseArgs(['--scenarios', 'unknown'])).toThrow('Unknown scenarios');
        expect(() => parseArgs(['--query-concurrency', '0'])).toThrow('queryConcurrency');
        expect(() => parseArgs(['--anchor-wallets', '0'])).toThrow('anchorWallets');
    });

    test('builds deterministic recovery and terminal fault plans', () => {
        const options = { semanticTimeoutMs: 250 };
        expect(scenarioPlan('normal', 'q', options)).toEqual([]);
        expect(scenarioPlan('fabric_endpoint_retry', 'q', options)).toEqual([
            expect.objectContaining({ queryId: 'q', nodeId: 'order_fabric', attempt: 1, recoverable: true })
        ]);
        expect(scenarioPlan('fabric_endpoint_exhausted', 'q', options)).toHaveLength(2);
        expect(scenarioPlan('semantic_disagreement', 'q', options)).toHaveLength(2);
        expect(scenarioPlan('semantic_service_timeout', 'q', options)[0]).toMatchObject({
            action: 'timeout', delayMs: 350
        });
        expect(DEFAULT_SCENARIOS).toHaveLength(6);
    });

    test('classifies expected terminal semantics without treating failures as success', () => {
        expect(expectedBehavior('normal', { terminalState: 'ANCHORED', outcome: 'SATISFIED' })).toBe(true);
        expect(expectedBehavior('fabric_endpoint_exhausted', { terminalState: 'FAILED', outcome: null })).toBe(true);
        expect(expectedBehavior('semantic_disagreement', {
            terminalState: 'INSUFFICIENT_EVIDENCE', outcome: 'INSUFFICIENT'
        })).toBe(true);
        expect(expectedBehavior('normal', { terminalState: 'FAILED', outcome: null })).toBe(false);
    });

    test('summarizes latency, retries, audit checks and terminal states', () => {
        const rows = [
            {
                scenario: 'normal', totalMs: 100, executionMs: 60, anchorAndPersistenceMs: 40,
                retryCount: 0, receiptBytes: 1000, terminalState: 'ANCHORED', auditVerified: true,
                expectedBehavior: true, error: null
            },
            {
                scenario: 'normal', totalMs: 200, executionMs: 100, anchorAndPersistenceMs: 100,
                retryCount: 1, receiptBytes: 1200, terminalState: 'ANCHORED', auditVerified: true,
                expectedBehavior: true, error: null
            }
        ];
        const summary = summarize(rows).normal;

        expect(percentile([100, 200], 0.5)).toBe(150);
        expect(summary).toMatchObject({
            queries: 2,
            completed: 2,
            expectedBehaviorRate: 1,
            auditVerified: 2,
            terminalStates: { ANCHORED: 2 },
            meanRetries: 0.5,
            meanReceiptBytes: 1100
        });
        expect(summary.totalLatencyMs).toMatchObject({ mean: 150, p50: 150, p95: 195 });
    });

    test('reads an uncached FISCO height from raw JSON-RPC when a provider is present', async () => {
        const monitor = {
            provider: { send: jest.fn().mockResolvedValue('0x1f') },
            getLatestBlockNumber: jest.fn().mockResolvedValue(12)
        };

        await expect(readHeight(monitor)).resolves.toBe(31);
        expect(monitor.provider.send).toHaveBeenCalledWith('eth_blockNumber', []);
        expect(monitor.getLatestBlockNumber).not.toHaveBeenCalled();
    });

    test('bounds query-level concurrency', async () => {
        let active = 0;
        let maxActive = 0;
        await runBounded([1, 2, 3, 4, 5, 6], 3, async () => {
            active += 1;
            maxActive = Math.max(maxActive, active);
            await new Promise((resolve) => setTimeout(resolve, 5));
            active -= 1;
        });
        expect(maxActive).toBe(3);
    });
});
