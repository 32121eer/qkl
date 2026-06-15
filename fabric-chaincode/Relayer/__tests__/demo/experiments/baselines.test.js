const {
    ma3cDecision,
    repWeightedDecision,
    equalMajorityDecision,
    pbftDecision,
    singleRelayDecision,
    isCorrect,
    isFalseAccept
} = require('../../../demo/experiments/baselines/decision_strategies');
const { pairedComparison, signTestPValue } = require('../../../demo/experiments/stats');
const {
    runDecisionComparison,
    runSequentialComparison
} = require('../../../demo/experiments/comparative_runner');

function ops(specs) {
    // specs: [decision, confidence, weight]
    return specs.map((s, i) => ({
        agentId: `a${i + 1}`,
        decision: s[0],
        confidence: s[1],
        assignedWeight: s[2],
        latencyMs: 50
    }));
}

describe('decision strategies', () => {
    test('MA3C uses rep×confidence and the θ threshold', () => {
        // 3 APPROVE (w0.2, conf0.9) vs 2 REJECT (w0.2, conf0.9):
        // acceptRatio = 3/5 = 0.6 < 0.70 ⇒ OBSERVE (not a strong-enough majority)
        const r = ma3cDecision(ops([
            ['APPROVE', 0.9, 0.2], ['APPROVE', 0.9, 0.2], ['APPROVE', 0.9, 0.2],
            ['REJECT', 0.9, 0.2], ['REJECT', 0.9, 0.2]
        ]), { threshold: 0.7, n: 5 });
        expect(r.acceptRatio).toBeCloseTo(0.6, 5);
        expect(r.finalDecision).toBe('OBSERVE');
    });

    test('MA3C: high-confidence approve majority commits', () => {
        const r = ma3cDecision(ops([
            ['APPROVE', 0.95, 0.2], ['APPROVE', 0.95, 0.2], ['APPROVE', 0.95, 0.2],
            ['APPROVE', 0.95, 0.2], ['REJECT', 0.6, 0.2]
        ]), { threshold: 0.7, n: 5 });
        expect(r.finalDecision).toBe('COMMIT');
    });

    test('confidence weighting can flip equal-weight ties (MA3C vs repWeighted)', () => {
        // 2 confident honest APPROVE vs 2 low-confidence malicious REJECT, equal rep.
        const o = ops([
            ['APPROVE', 0.95, 0.25], ['APPROVE', 0.95, 0.25],
            ['REJECT', 0.3, 0.25], ['REJECT', 0.3, 0.25]
        ]);
        const ma3c = ma3cDecision(o.map((x) => ({ ...x })), { threshold: 0.7, n: 4 });
        const rep = repWeightedDecision(o.map((x) => ({ ...x })), { threshold: 0.7, n: 4 });
        // rep-only sees a 50/50 split → OBSERVE; high-confidence honest votes vs
        // low-confidence malicious votes tip MA3C over θ to COMMIT.
        expect(rep.finalDecision).toBe('OBSERVE');
        expect(ma3c.acceptRatio).toBeGreaterThan(rep.acceptRatio);
        expect(ma3c.finalDecision).toBe('COMMIT');
    });

    test('equal majority needs strict majority of full committee', () => {
        const r = equalMajorityDecision(ops([
            ['APPROVE', 1, 1], ['APPROVE', 1, 1], ['APPROVE', 1, 1],
            ['QUESTION', 1, 1], ['QUESTION', 1, 1]
        ]), { n: 5 });
        expect(r.requiredVotes).toBe(3);
        expect(r.finalDecision).toBe('COMMIT');
    });

    test('equal majority: abstentions can block a decision', () => {
        const r = equalMajorityDecision(ops([
            ['APPROVE', 1, 1], ['APPROVE', 1, 1],
            ['QUESTION', 1, 1], ['QUESTION', 1, 1], ['QUESTION', 1, 1]
        ]), { n: 5 });
        expect(r.finalDecision).toBe('OBSERVE');
    });

    test('PBFT requires 2f+1 quorum', () => {
        // n=7 ⇒ f=2 ⇒ quorum=5. Only 4 approve ⇒ no quorum ⇒ OBSERVE.
        const r4 = pbftDecision(ops([
            ['APPROVE', 1, 1], ['APPROVE', 1, 1], ['APPROVE', 1, 1], ['APPROVE', 1, 1],
            ['REJECT', 1, 1], ['REJECT', 1, 1], ['REJECT', 1, 1]
        ]), { n: 7 });
        expect(r4.requiredVotes).toBe(5);
        expect(r4.finalDecision).toBe('OBSERVE');
        // 5 approve ⇒ quorum met ⇒ COMMIT.
        const r5 = pbftDecision(ops([
            ['APPROVE', 1, 1], ['APPROVE', 1, 1], ['APPROVE', 1, 1], ['APPROVE', 1, 1], ['APPROVE', 1, 1],
            ['REJECT', 1, 1], ['REJECT', 1, 1]
        ]), { n: 7 });
        expect(r5.finalDecision).toBe('COMMIT');
    });

    test('single relay follows the pre-selected agent', () => {
        const o = ops([['REJECT', 0.9, 0.2], ['APPROVE', 0.9, 0.2], ['APPROVE', 0.9, 0.2]]);
        expect(singleRelayDecision(o, { relayIndex: 0 }).finalDecision).toBe('REJECT');
        expect(singleRelayDecision(o, { relayIndex: 1 }).finalDecision).toBe('COMMIT');
    });

    test('correctness helpers', () => {
        expect(isCorrect('COMMIT', true)).toBe(true);
        expect(isCorrect('OBSERVE', true)).toBe(false);
        expect(isFalseAccept('COMMIT', false)).toBe(true);
    });
});

describe('stats', () => {
    test('sign test is symmetric and bounded', () => {
        expect(signTestPValue(10, 0)).toBeLessThan(0.01);
        expect(signTestPValue(5, 5)).toBeCloseTo(1, 5);
        expect(signTestPValue(0, 0)).toBe(1);
    });

    test('paired comparison flags a clear positive effect', () => {
        const treat = Array.from({ length: 40 }, (_, i) => 0.9 + (i % 3) * 0.01);
        const base = Array.from({ length: 40 }, (_, i) => 0.6 + (i % 3) * 0.01);
        const cmp = pairedComparison(treat, base);
        expect(cmp.meanDiff).toBeGreaterThan(0.25);
        expect(cmp.ciExcludesZero).toBe(true);
        expect(cmp.sign.pValue).toBeLessThan(0.01);
    });
});

describe('comparative runner (smoke + directional)', () => {
    test('decision comparison produces paired stats for every baseline', () => {
        const report = runDecisionComparison({ n: 5, maliciousRatio: 0.4, seeds: 40, tasksPerSeed: 10 });
        expect(report.methods.ma3c).toBeDefined();
        expect(report.methods.singleRelay).toBeDefined();
        // Finding (not a bug): with FRESH equal reputation, θ=0.70 is tuned for
        // evolved reputation, so MA3C is conservative (many OBSERVE) at high
        // malicious ratios. The reputation advantage shows up in the sequential
        // run, not here. We only assert the harness emits valid paired stats.
        for (const key of ['equalMajority', 'pbft', 'singleRelay', 'repWeighted']) {
            expect(report.comparisons[`ma3c_vs_${key}`].correctness).toBeDefined();
            expect(report.comparisons[`ma3c_vs_${key}`].correctness.n).toBe(40);
        }
    });

    test('arbitration is load-bearing: disabling it collapses MA3C correctness', () => {
        const opts = { n: 5, maliciousRatio: 0.4, seeds: 60, tasksPerSeed: 16, honestErrorRate: 0.1 };
        const withArb = runDecisionComparison({ ...opts, enableArbitration: true });
        const noArb = runDecisionComparison({ ...opts, enableArbitration: false });
        // With arbitration MA3C should be far more correct; without it, MA3C
        // strands sub-threshold tasks in OBSERVE and correctness collapses.
        expect(withArb.methods.ma3c.correctness.mean)
            .toBeGreaterThan(noArb.methods.ma3c.correctness.mean + 0.3);
        // Escalation only happens when arbitration is enabled.
        expect(withArb.methods.ma3c.escalationRate.mean).toBeGreaterThan(0.1);
        expect(noArb.methods.ma3c.escalationRate.mean).toBe(0);
    });

    test('sequential comparison reports late-window correctness for adaptive methods', () => {
        const report = runSequentialComparison({ n: 7, maliciousRatio: 0.3, seeds: 20, tasksPerSeed: 60 });
        expect(report.methods.ma3c.lateCorrectness).toBeDefined();
        // Reputation-using MA3C's late-window correctness should be at least as
        // good as memoryless equal majority (typically strictly better).
        expect(report.methods.ma3c.lateCorrectness.mean)
            .toBeGreaterThanOrEqual(report.methods.equalMajority.lateCorrectness.mean - 1e-9);
    });
});
