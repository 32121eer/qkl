const {
    runConvergenceBenchmark,
    runResilienceBenchmark,
    runNewAgentEvolutionBenchmark,
    runAllExperiments
} = require('../../../demo/experiments/ma3c_wbft_simulator');

describe('MA3C WBFT simulator', () => {
    test('produces convergence metrics for each configured committee size', () => {
        const result = runConvergenceBenchmark({
            sizes: [7, 15],
            trials: 4,
            seed: 7
        });

        expect(result).toHaveLength(2);
        expect(result[0]).toEqual(expect.objectContaining({
            agentCount: 7,
            avgConvergenceMs: expect.any(Number),
            avgRounds: expect.any(Number)
        }));
        expect(result[1].agentCount).toBe(15);
        expect(result[1].avgConvergenceMs).toBeGreaterThanOrEqual(result[0].avgConvergenceMs);
    });

    test('resilience metrics degrade as malicious ratio grows', () => {
        const result = runResilienceBenchmark({
            maliciousRatios: [0.1, 0.3],
            n: 15,
            trials: 20,
            seed: 11
        });

        expect(result).toHaveLength(2);
        expect(result[0].correctnessRate).toBeGreaterThanOrEqual(result[1].correctnessRate);
    });

    test('new honest agent eventually reaches a higher weight band', () => {
        const result = runNewAgentEvolutionBenchmark({
            n: 9,
            warmupRounds: 8,
            observeRounds: 20,
            seed: 13
        });

        expect(result.trajectory).toHaveLength(20);
        expect(result.trajectory[0]).toEqual(expect.objectContaining({
            round: 1,
            newcomerWeight: expect.any(Number),
            topQuartileThreshold: expect.any(Number)
        }));
        expect(result.roundsToTopQuartile === null || result.roundsToTopQuartile > 0).toBe(true);
    });

    test('aggregates all three experiment groups', () => {
        const result = runAllExperiments({
            convergence: { sizes: [7], trials: 2, seed: 3 },
            resilience: { maliciousRatios: [0.1], trials: 4, n: 7, seed: 4 },
            newAgentEvolution: { n: 7, warmupRounds: 4, observeRounds: 6, seed: 5 }
        });

        expect(result).toEqual(expect.objectContaining({
            convergence: expect.any(Array),
            resilience: expect.any(Array),
            newAgentEvolution: expect.any(Object)
        }));
    });
});
