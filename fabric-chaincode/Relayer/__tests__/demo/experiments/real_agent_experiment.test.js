const {
    buildCommittee,
    buildTask,
    collectOpinions,
    runRealAgentByzantine
} = require('../../../demo/experiments/real_agent_experiment');

describe('real-agent experiment uses actual VerifierAgent logic', () => {
    test('honest committee: APPROVE valid, REJECT crypto-tampered', async () => {
        const agents = buildCommittee({ n: 5, maliciousRatio: 0 });
        const valid = await collectOpinions(agents, buildTask('a', 'VALID'));
        const invalid = await collectOpinions(agents, buildTask('b', 'INVALID'));
        expect(valid.every((o) => o.decision === 'APPROVE')).toBe(true);
        expect(invalid.every((o) => o.decision === 'REJECT')).toBe(true);
    });

    test('always_approve malicious agents really force APPROVE on forged evidence', async () => {
        const agents = buildCommittee({ n: 5, maliciousRatio: 0.6, behavior: 'always_approve' });
        const ops = await collectOpinions(agents, buildTask('c', 'INVALID'));
        const approvals = ops.filter((o) => o.decision === 'APPROVE').length;
        expect(approvals).toBe(3); // 60% of 5
    });

    test('Byzantine majority (60%): MA3C stays correct via arbitration, equal voting fails', async () => {
        const report = await runRealAgentByzantine({ n: 5, maliciousRatio: 0.6, trials: 10, tasksPerTrial: 6 });
        // MA3C resists the forged-evidence majority; equal majority is fooled.
        expect(report.methods.ma3c.correctness.mean).toBeGreaterThan(0.95);
        expect(report.methods.ma3c.falseAccept.mean).toBeLessThan(0.05);
        expect(report.methods.equalMajority.falseAccept.mean).toBeGreaterThan(0.3);
        const cmp = report.comparisons.ma3c_vs_equalMajority.correctness;
        expect(cmp.meanDiff).toBeGreaterThan(0.3);
        expect(cmp.ciExcludesZero).toBe(true);
    });
});
