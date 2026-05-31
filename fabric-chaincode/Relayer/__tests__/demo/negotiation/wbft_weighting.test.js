const { ReputationStore } = require('../../../demo/negotiation/reputation_store');
const { WeightAllocator } = require('../../../demo/negotiation/weight_allocator');
const { summarizeQuorum } = require('../../../demo/negotiation/proposal_builder');

describe('MA3C WBFT weighting', () => {
    test('normalizes quality and trust components into a weighted vote vector', () => {
        const store = new ReputationStore({
            alpha: 0.4,
            beta: 0.6,
            latencyScaleMs: 100,
            epsilon: 0.001
        });
        const ids = ['agent-fast-honest', 'agent-slow-faulty'];
        store.ensure(ids);

        const fast = store.items.get('agent-fast-honest');
        fast.qualityScore = 0.95;
        fast.trustScore = 0.9;
        fast.latencyScore = 0.95;
        fast.riskPenalty = 0;

        const slow = store.items.get('agent-slow-faulty');
        slow.qualityScore = 0.3;
        slow.trustScore = 0.2;
        slow.latencyScore = 0.25;
        slow.riskPenalty = 0.4;

        store.normalize(ids);
        const fastSnapshot = store.get('agent-fast-honest');
        const slowSnapshot = store.get('agent-slow-faulty');

        expect(fastSnapshot.qualityWeight).toBeGreaterThan(slowSnapshot.qualityWeight);
        expect(fastSnapshot.trustWeight).toBeGreaterThan(slowSnapshot.trustWeight);
        expect(fastSnapshot.weight).toBeGreaterThan(slowSnapshot.weight);
        expect(Number((fastSnapshot.weight + slowSnapshot.weight).toFixed(6))).toBe(1);
    });

    test('updates reputation from validation correctness and latency', () => {
        const store = new ReputationStore({
            alpha: 0.5,
            beta: 0.5,
            latencyScaleMs: 100,
            qualitySmoothing: 1,
            latencySmoothing: 1
        });

        store.updateFromRound([
            {
                agentId: 'agent-a',
                decision: 'APPROVE',
                confidence: 1,
                latencyMs: 10
            },
            {
                agentId: 'agent-b',
                decision: 'REJECT',
                confidence: 1,
                latencyMs: 400
            }
        ], {
            finalDecision: 'COMMIT'
        });

        const a = store.get('agent-a');
        const b = store.get('agent-b');
        expect(a.successCount).toBe(1);
        expect(b.faultCount).toBe(1);
        expect(a.trustScore).toBeGreaterThan(b.trustScore);
        expect(a.latencyScore).toBeGreaterThan(b.latencyScore);
        expect(a.weight).toBeGreaterThan(b.weight);
    });

    test('requires paper threshold and enough commit-reveal disclosures', () => {
        expect(summarizeQuorum([
            { decision: 'APPROVE', assignedWeight: 0.5, confidence: 1 },
            { decision: 'APPROVE', assignedWeight: 0.166667, confidence: 1 },
            { decision: 'QUESTION', assignedWeight: 0.333333, confidence: 1 }
        ])).toEqual(expect.objectContaining({
            approvedWeight: 0.666667,
            thresholdWeight: 0.7,
            validRevealCount: 2,
            enoughReveals: false,
            wbftSatisfied: false
        }));

        expect(summarizeQuorum([
            { decision: 'APPROVE', assignedWeight: 0.5, confidence: 1 },
            { decision: 'APPROVE', assignedWeight: 0.3, confidence: 1 },
            { decision: 'REJECT', assignedWeight: 0.2, confidence: 1 }
        ])).toEqual(expect.objectContaining({
            approvedWeight: 0.8,
            acceptRatio: 0.8,
            thresholdWeight: 0.7,
            validRevealCount: 3,
            wbftSatisfied: true
        }));
    });

    test('allocator exposes WBFT threshold metadata', () => {
        const store = new ReputationStore();
        const allocator = new WeightAllocator({ reputationStore: store });
        const assigned = allocator.assign(['agent-a', 'agent-b', 'agent-c']);
        const summary = allocator.summarize([
            { decision: 'APPROVE', assignedWeight: assigned['agent-a'], confidence: 1 },
            { decision: 'REJECT', assignedWeight: assigned['agent-b'], confidence: 1 },
            { decision: 'QUESTION', assignedWeight: assigned['agent-c'], confidence: 1 }
        ]);

        expect(summary).toEqual(expect.objectContaining({
            thresholdRatio: 0.7,
            wbftSatisfied: false
        }));
    });
});
