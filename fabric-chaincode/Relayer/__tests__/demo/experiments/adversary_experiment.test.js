const {
    runStrategicAdversary,
    runCollusionDetection
} = require('../../../demo/experiments/adversary_experiment');

describe('adversary experiments (real reputation + behavior analyzer)', () => {
    test('strategic adversary is downweighted quickly after the flip', () => {
        const r = runStrategicAdversary({ n: 7, flipAt: 30, observeTasks: 30, trials: 50 });
        expect(r.weightBelowHonestMedian.detectionRate).toBeGreaterThan(0.9);
        // Always-approve attacker (wrong on ~half the tasks) is neutralized within
        // a few tasks, not tens of tasks.
        expect(r.weightBelowHonestMedian.tasksToDetect.mean).toBeLessThan(6);
    });

    test('collusion detection: reliable with a long horizon, noisier when short', () => {
        const long = runCollusionDetection({ n: 7, colluderCount: 2, disputedTasks: 50, trials: 80 });
        const short = runCollusionDetection({ n: 7, colluderCount: 2, disputedTasks: 10, trials: 80 });
        // Long horizon: colluders reliably flagged.
        expect(long.trueDetectionRate).toBeGreaterThan(0.9);
        // Short horizon (below the analyzer's 20-overlap floor): cannot yet detect.
        expect(short.trueDetectionRate).toBeLessThan(0.2);
    });
});
