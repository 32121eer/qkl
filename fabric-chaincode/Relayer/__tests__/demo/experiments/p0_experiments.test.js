const {
    runThroughput,
    runSilenceAttack,
    runParameterSensitivity,
    runIncentiveCompatibility
} = require('../../../demo/experiments/p0_experiments');
const { runDecisionComparison } = require('../../../demo/experiments/comparative_runner');

describe('P0 experiments (real components)', () => {
    test('throughput: concurrency = floor(N*Lmax/n), compute throughput is high', async () => {
        const r = await runThroughput({ poolSizes: [10, 30], lMax: 3, n: 5, tasksPerPool: 60 });
        expect(r.rows[0].maxConcurrency).toBe(6);   // 10*3/5
        expect(r.rows[1].maxConcurrency).toBe(18);  // 30*3/5
        // rule-based verification is sub-millisecond → not the bottleneck
        expect(r.rows[1].measuredComputeThroughputPerSec).toBeGreaterThan(100);
        // modeled end-to-end scales with pool size
        expect(r.rows[1].modeledE2EThroughputPerSec).toBeGreaterThan(r.rows[0].modeledE2EThroughputPerSec);
    });

    test('silence attack: liveness preserved, silent agents punished to the floor', async () => {
        const r = await runSilenceAttack({ n: 7, silentRatios: [0.43], tasksPerTrial: 20, trials: 10 });
        const row = r.results[0];
        // system still finalizes every task (via arbitration when reveals < quorum)
        expect(row.finalizeRate.mean).toBeGreaterThan(0.95);
        expect(row.correctness.mean).toBeGreaterThan(0.95);
        // withholding reveal (−α₅) crushes the silent agents' reputation
        expect(row.silentAgentFinalReputation.mean).toBeLessThan(-2);
    });

    test('parameter sensitivity: MA3C beats equal voting across all θ', () => {
        const r = runParameterSensitivity({ runDecisionComparison, seeds: 40, tasksPerSeed: 12 });
        for (const row of r.theta) {
            expect(row.vsEqualDeltaPP).toBeGreaterThan(10);
            expect(row.sig).toBe(true);
        }
    });

    test('incentive compatibility: honest strategy strictly dominates', () => {
        const r = runIncentiveCompatibility({ n: 8, tasksPerTrial: 150, trials: 15 });
        expect(r.strategies._honestDominates).toBe(true);
        expect(r.strategies.honest.cumulativePayoff.mean)
            .toBeGreaterThan(r.strategies.freerider.cumulativePayoff.mean);
        expect(r.strategies.honest.cumulativePayoff.mean)
            .toBeGreaterThan(r.strategies.malicious.cumulativePayoff.mean);
    });
});
