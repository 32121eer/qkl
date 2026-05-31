const { VerifierAgent } = require('../../../demo/agents/verifier_agent');

function fullValidTask() {
    const evidenceHash = '0xevhash';
    return {
        taskId: 't1',
        queryId: 'q1',
        risk: 'NORMAL',
        sourceChain: 'FISCO',
        targetChain: 'FABRIC',
        evidenceBundle: {
            request: { txHash: '0xsrc' },
            sourceTxHash: '0xsrc',
            payload: { found: true, result: { batchId: 'B1' }, record: { batchId: 'B1' } },
            preVerification: { status: 'PASS' },
            sourceHeader: { number: 1 },
            sourceHeaderHash: '0xhdr',
            queryProof: { commitment: { value: '0xc' }, queryObject: { statement: 's' } },
            queryObject: { statement: 's' },
            collectorAttestations: [
                { organization: 'orgA', evidenceHash },
                { organization: 'orgB', evidenceHash }
            ]
        }
    };
}

describe('VerifierAgent behavior hook (Byzantine simulation)', () => {
    const baseOpts = { agentId: 'v', focus: 'proof', strictProof: true, useLLM: false };
    const context = { round: 1, session: { queryVerifyStatus: 'PASS' }, assignedWeight: 0.2 };

    test('honest agent returns honest decision (APPROVE on valid evidence)', async () => {
        const a = new VerifierAgent({ ...baseOpts, behavior: 'honest' });
        const res = await a.execute(fullValidTask(), context);
        expect(res.decision).toBe('APPROVE');
        expect(res.adversarial).toBeUndefined();
        expect(a.behavior).toBe('honest');
    });

    test('always_approve forces APPROVE even on invalid evidence', async () => {
        const a = new VerifierAgent({ ...baseOpts, behavior: 'always_approve' });
        const badTask = fullValidTask();
        badTask.evidenceBundle.preVerification = { status: 'FAIL' }; // honest would REJECT
        const res = await a.execute(badTask, context);
        expect(res.decision).toBe('APPROVE');
        expect(res.behavior).toBe('always_approve');
        expect(res.adversarial).toBe(true);
        expect(res.confidence).toBeGreaterThanOrEqual(0.5);
    });

    test('always_reject forces REJECT even on perfectly valid evidence', async () => {
        const a = new VerifierAgent({ ...baseOpts, behavior: 'always_reject' });
        const res = await a.execute(fullValidTask(), context);
        expect(res.decision).toBe('REJECT');
        expect(res.behavior).toBe('always_reject');
        expect(res.adversarial).toBe(true);
    });

    test('always_question forces QUESTION', async () => {
        const a = new VerifierAgent({ ...baseOpts, behavior: 'always_question' });
        const res = await a.execute(fullValidTask(), context);
        expect(res.decision).toBe('QUESTION');
        expect(res.behavior).toBe('always_question');
    });

    test('silent agent throws (simulates non-response)', async () => {
        const a = new VerifierAgent({ ...baseOpts, behavior: 'silent' });
        await expect(a.execute(fullValidTask(), context)).rejects.toThrow(/silent/i);
    });

    test('random behavior produces one of the three valid decisions', async () => {
        const a = new VerifierAgent({ ...baseOpts, behavior: 'random' });
        const decisions = new Set();
        for (let i = 0; i < 50; i += 1) {
            const res = await a.execute(fullValidTask(), context);
            decisions.add(res.decision);
            expect(['APPROVE', 'REJECT', 'QUESTION']).toContain(res.decision);
        }
        // With 50 trials and 3 options, all three should appear (vanishing probability of not)
        expect(decisions.size).toBeGreaterThanOrEqual(2);
    });

    test('unknown behavior value normalizes to honest', () => {
        const a = new VerifierAgent({ ...baseOpts, behavior: 'galaxy-brained' });
        expect(a.behavior).toBe('honest');
    });

    test('getDescriptor exposes behavior for audit', () => {
        const a = new VerifierAgent({ ...baseOpts, behavior: 'always_reject' });
        expect(a.getDescriptor()).toEqual(expect.objectContaining({
            agentId: 'v',
            role: 'VERIFIER',
            focus: 'proof',
            behavior: 'always_reject'
        }));
    });
});
