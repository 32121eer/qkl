const {
    parseArgs,
    parseBytes,
    parsePercent,
    saturationPoint,
    summarizeResources
} = require('../../../demo/semantic_query/experiments/run_live_saturation');
const { compareRows } = require('../../../demo/semantic_query/experiments/compare_anchor_strategies');

describe('live saturation experiment helpers', () => {
    test('parses bounded experiment options', () => {
        expect(parseArgs(['--quick'])).toMatchObject({ levels: [1, 2], runs: 1, queries: 2 });
        expect(parseArgs(['--levels', '1,4,8', '--anchor-wallets', '4']))
            .toMatchObject({ levels: [1, 4, 8], anchorWallets: 4 });
        expect(() => parseArgs(['--levels', '1,0'])).toThrow('--levels');
        expect(() => parseArgs(['--anchor-wallets', '0'])).toThrow('--anchorWallets');
    });

    test('normalizes docker resource units', () => {
        expect(parsePercent('12.5%')).toBe(12.5);
        expect(parseBytes('1.5MiB')).toBe(1.5 * 1024 * 1024);
        expect(parseBytes('2GB')).toBe(2 * 1000 * 1000 * 1000);
    });

    test('summarizes resource samples by container', () => {
        const summary = summarizeResources([
            { hostLoad1: 1, processRssBytes: 100, docker: [{ Name: 'peer', CPUPerc: '10%', MemUsage: '2MiB / 1GiB' }] },
            { hostLoad1: 3, processRssBytes: 200, docker: [{ Name: 'peer', CPUPerc: '20%', MemUsage: '4MiB / 1GiB' }] }
        ]);
        expect(summary.hostLoad1.mean).toBe(2);
        expect(summary.containers.peer.cpuPercent.max).toBe(20);
        expect(summary.containers.peer.memoryBytes.max).toBe(4 * 1024 * 1024);
    });

    test('marks the first level with flat throughput and sharply rising latency', () => {
        expect(saturationPoint([
            { concurrency: 1, throughput: 2, p95Ms: 500 },
            { concurrency: 2, throughput: 2.1, p95Ms: 800 }
        ])).toMatchObject({ concurrency: 2 });
    });

    test('compares throughput, latency and queue deltas by concurrency', () => {
        expect(compareRows(
            [{ concurrency: 4, throughput: 2, p95Ms: 2000, anchorQueueP95Ms: 1500 }],
            [{ concurrency: 4, throughput: 7, p95Ms: 600, anchorQueueP95Ms: 10 }]
        )).toEqual([expect.objectContaining({
            concurrency: 4,
            throughputGainRate: 2.5,
            p95ReductionRate: 0.7,
            anchorQueueReductionRate: 0.993333
        })]);
    });
});
