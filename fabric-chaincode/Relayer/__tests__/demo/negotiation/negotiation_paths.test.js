const { AgentRuntime } = require('../../../demo/agents/agent_runtime');
const { VerifierAgent } = require('../../../demo/agents/verifier_agent');
const { NegotiationProtocol } = require('../../../demo/negotiation/negotiation_protocol');

/**
 * End-to-end negotiation path tests using local rule-based verifiers (deterministic,
 * no LLM, no containers). Exercises:
 *   - COMMIT happy path (NORMAL + CRITICAL)
 *   - REJECT consensus on tampered/invalid evidence
 *   - OBSERVE / no-quorum cases
 *   - Byzantine resilience: malicious minority tolerated; malicious cannot force wrong COMMIT
 *   - Silent (non-responding) agent handled gracefully
 *   - Commit-reveal sealing valid for all honest opinions
 */

const ORGS = ['org-a', 'org-b', 'org-c', 'org-d', 'org-e', 'org-f', 'org-g', 'org-h'];

function createEventStore() {
    return {
        events: [],
        addEvent(e) { this.events.push(e); }
    };
}

/**
 * Build a runtime with N independent proof-focus verifiers (each in its own
 * organization, strictProof, no LLM). The `malicious` map keys agent IDs to a
 * behavior string ('always_reject', 'always_approve', 'silent', ...).
 */
function buildRuntime({ verifierCount, malicious = {} } = {}) {
    const eventStore = createEventStore();
    const runtime = new AgentRuntime({
        eventStore,
        enableAgentRegistryStore: false
    });
    for (const v of runtime.registry.list('VERIFIER')) {
        runtime.registry.unregister(v.agentId);
    }
    for (let i = 0; i < verifierCount; i += 1) {
        const agentId = `verifier-${String(i + 1).padStart(2, '0')}`;
        runtime.registry.register(new VerifierAgent({
            agentId,
            focus: 'proof',
            strictProof: true,
            organization: ORGS[i % ORGS.length],
            strategyType: 'A_PROOF_VALIDATOR',
            useLLM: false,
            behavior: malicious[agentId] || 'honest'
        }));
    }
    return { runtime, eventStore };
}

function validEvidenceTask(risk = 'NORMAL') {
    const evidenceHash = '0xevhash-valid';
    return {
        taskId: `t-${risk.toLowerCase()}`,
        queryId: `q-${risk.toLowerCase()}`,
        risk,
        sourceChain: 'FISCO_NET_01',
        targetChain: 'FABRIC_NET_01',
        evidenceVersion: 1,
        evidenceBundle: {
            request: { txHash: '0xsrctx', blockHeight: 100 },
            sourceTxHash: '0xsrctx',
            payload: { found: true, result: { batchId: 'B1' }, record: { batchId: 'B1' } },
            preVerification: { status: 'PASS' },
            sourceHeader: { number: 100 },
            sourceHeaderHash: '0xhdr',
            queryProof: { commitment: { value: '0xcommit' }, queryObject: { statement: 'verify B1' } },
            queryObject: { statement: 'verify B1' },
            collectorAttestations: [
                { organization: 'orgA', evidenceHash },
                { organization: 'orgB', evidenceHash }
            ]
        }
    };
}

function tamperedEvidenceTask() {
    const task = validEvidenceTask('NORMAL');
    task.evidenceBundle.preVerification = { status: 'FAIL' }; // crypto pre-check failure
    return task;
}

const HONEST_CONTEXT = { round: 1, session: { queryVerifyStatus: 'PASS' } };
const TAMPERED_CONTEXT = { round: 1, session: { queryVerifyStatus: 'FAIL' } };

async function runRound(runtime, task, context) {
    const eventStore = runtime.eventStore;
    const result = await runtime.evaluateTask(task, context);
    const protocol = new NegotiationProtocol({ eventStore });
    const outcome = await protocol.run({
        task,
        opinions: result.opinions,
        coordination: result.coordination,
        submitterPlan: result.submitterPlan,
        round: 1,
        maxRounds: 1,
        behaviorAnalysis: result.behaviorAnalysis,
        committee: result.committee
    });
    return { evaluation: result, outcome, finalProposal: outcome.finalProposal };
}

describe('Multi-agent negotiation paths', () => {
    test('TC-NEG-001 NORMAL COMMIT happy path: 5 honest -> COMMIT, acceptRatio==1', async () => {
        const { runtime } = buildRuntime({ verifierCount: 5 });
        const { evaluation, outcome, finalProposal } = await runRound(runtime, validEvidenceTask('NORMAL'), HONEST_CONTEXT);
        expect(evaluation.opinions).toHaveLength(5);
        expect(evaluation.opinions.every((o) => o.decision === 'APPROVE')).toBe(true);
        expect(finalProposal.finalDecision).toBe('COMMIT');
        expect(outcome.status).toBe('READY');
        expect(finalProposal.consensusRule.groupSize).toBe(5);
        expect(finalProposal.consensusRule.threshold).toBe(0.7);
        expect(finalProposal.quorum.acceptRatio).toBe(1);
        expect(finalProposal.quorum.wbftSatisfied).toBe(true);
    });

    test('TC-NEG-002 NORMAL REJECT path: tampered evidence -> all honest REJECT -> REJECT consensus', async () => {
        const { runtime } = buildRuntime({ verifierCount: 5 });
        const { evaluation, outcome, finalProposal } = await runRound(runtime, tamperedEvidenceTask(), TAMPERED_CONTEXT);
        expect(evaluation.opinions.every((o) => o.decision === 'REJECT')).toBe(true);
        expect(finalProposal.finalDecision).toBe('REJECT');
        expect(outcome.status).toBe('REJECTED');
        expect(finalProposal.quorum.rejectRatio).toBe(1);
        expect(finalProposal.quorum.rejectSatisfied).toBe(true);
    });

    test('TC-NEG-003 NORMAL OBSERVE: mixed decisions yield no quorum (system does NOT commit)', async () => {
        const { runtime } = buildRuntime({
            verifierCount: 5,
            // 2 always_question + 1 always_reject + 2 honest APPROVE -> acceptRatio=2/3≈0.67<0.70
            malicious: { 'verifier-01': 'always_question', 'verifier-02': 'always_question', 'verifier-03': 'always_reject' }
        });
        const { finalProposal } = await runRound(runtime, validEvidenceTask('NORMAL'), HONEST_CONTEXT);
        expect(finalProposal.finalDecision).toBe('OBSERVE');
        expect(finalProposal.quorum.wbftSatisfied).toBe(false);
        expect(finalProposal.quorum.rejectSatisfied).toBe(false);
    });

    test('TC-NEG-004 commit-reveal: every honest opinion sealed and valid', async () => {
        const { runtime } = buildRuntime({ verifierCount: 5 });
        const { evaluation, finalProposal } = await runRound(runtime, validEvidenceTask('NORMAL'), HONEST_CONTEXT);
        for (const op of evaluation.opinions) {
            expect(op.commitReveal).toBeDefined();
            expect(op.commitReveal.commitHash).toMatch(/^(0x)?[0-9a-f]+$/i);
            expect(op.commitReveal.valid).toBe(true);
        }
        for (const w of finalProposal.weightVector) {
            expect(w.commitRevealValid).toBe(true);
            expect(w.commitHash).toBeTruthy();
        }
    });

    test('TC-NEG-005 silent agent tolerated: 1 silent of 5 -> committee degrades to 4, still COMMIT', async () => {
        const { runtime, eventStore } = buildRuntime({
            verifierCount: 5,
            malicious: { 'verifier-03': 'silent' }
        });
        const { evaluation, finalProposal } = await runRound(runtime, validEvidenceTask('NORMAL'), HONEST_CONTEXT);
        // The silent agent throws -> evaluateTask skips it -> 4 opinions remain.
        expect(evaluation.opinions).toHaveLength(4);
        expect(evaluation.opinions.map((o) => o.agentId)).not.toContain('verifier-03');
        expect(finalProposal.quorum.validRevealCount).toBe(4);
        expect(finalProposal.quorum.enoughReveals).toBe(true);
        expect(finalProposal.finalDecision).toBe('COMMIT');
        // The non-response is audited.
        expect(eventStore.events.some((e) => e.relayState === 'AGENT_NO_RESPONSE')).toBe(true);
    });
});

describe('Multi-agent negotiation: Byzantine resilience', () => {
    test('TC-BYZ-001 1/5 always_reject is tolerated -> still COMMIT (acceptRatio>=0.7)', async () => {
        const { runtime } = buildRuntime({
            verifierCount: 5,
            malicious: { 'verifier-01': 'always_reject' }
        });
        const { evaluation, finalProposal } = await runRound(runtime, validEvidenceTask('NORMAL'), HONEST_CONTEXT);
        const counts = evaluation.opinions.reduce((acc, o) => {
            acc[o.decision] = (acc[o.decision] || 0) + 1; return acc;
        }, {});
        expect(counts.APPROVE).toBe(4);
        expect(counts.REJECT).toBe(1);
        expect(finalProposal.finalDecision).toBe('COMMIT');
        expect(finalProposal.quorum.acceptRatio).toBeGreaterThanOrEqual(0.7);
    });

    test('TC-BYZ-002 2/5 always_reject blocks COMMIT (liveness attack) but cannot force REJECT', async () => {
        const { runtime } = buildRuntime({
            verifierCount: 5,
            malicious: { 'verifier-01': 'always_reject', 'verifier-02': 'always_reject' }
        });
        const { finalProposal } = await runRound(runtime, validEvidenceTask('NORMAL'), HONEST_CONTEXT);
        // 3 APPROVE + 2 REJECT -> acceptRatio ≈ 0.6 < 0.7 (no COMMIT); rejectRatio ≈ 0.4 < 0.7 (no REJECT)
        expect(finalProposal.finalDecision).toBe('OBSERVE');
        expect(finalProposal.quorum.acceptRatio).toBeLessThan(0.7);
        expect(finalProposal.quorum.rejectRatio).toBeLessThan(0.7);
    });

    test('TC-BYZ-003 2/5 always_approve on INVALID evidence cannot force COMMIT', async () => {
        const { runtime } = buildRuntime({
            verifierCount: 5,
            malicious: { 'verifier-01': 'always_approve', 'verifier-02': 'always_approve' }
        });
        const { evaluation, finalProposal } = await runRound(runtime, tamperedEvidenceTask(), TAMPERED_CONTEXT);
        const approve = evaluation.opinions.filter((o) => o.decision === 'APPROVE').length;
        const reject = evaluation.opinions.filter((o) => o.decision === 'REJECT').length;
        expect(approve).toBe(2);
        expect(reject).toBe(3);
        expect(finalProposal.finalDecision).not.toBe('COMMIT');
        expect(finalProposal.quorum.acceptRatio).toBeLessThan(0.7);
    });
});

describe('Multi-agent negotiation: CRITICAL risk (n=7, theta=0.75)', () => {
    test('TC-CRT-001 CRITICAL COMMIT: 7 honest -> COMMIT with groupSize=7, threshold=0.75', async () => {
        const { runtime } = buildRuntime({ verifierCount: 7 });
        const { evaluation, finalProposal } = await runRound(runtime, validEvidenceTask('CRITICAL'), HONEST_CONTEXT);
        expect(evaluation.opinions).toHaveLength(7);
        expect(finalProposal.consensusRule.groupSize).toBe(7);
        expect(finalProposal.consensusRule.threshold).toBe(0.75);
        expect(finalProposal.finalDecision).toBe('COMMIT');
        expect(finalProposal.quorum.acceptRatio).toBe(1);
    });

    test('TC-CRT-002 CRITICAL tolerates 1/7 Byzantine -> still COMMIT (6/7 ≈ 0.857 >= 0.75)', async () => {
        const { runtime } = buildRuntime({
            verifierCount: 7,
            malicious: { 'verifier-01': 'always_reject' }
        });
        const { finalProposal } = await runRound(runtime, validEvidenceTask('CRITICAL'), HONEST_CONTEXT);
        expect(finalProposal.finalDecision).toBe('COMMIT');
        expect(finalProposal.quorum.acceptRatio).toBeGreaterThanOrEqual(0.75);
    });

    test('TC-CRT-003 CRITICAL: 2/7 Byzantine drops below stricter 0.75 threshold -> no COMMIT', async () => {
        const { runtime } = buildRuntime({
            verifierCount: 7,
            malicious: { 'verifier-01': 'always_reject', 'verifier-02': 'always_reject' }
        });
        const { finalProposal } = await runRound(runtime, validEvidenceTask('CRITICAL'), HONEST_CONTEXT);
        // 5 APPROVE + 2 REJECT -> acceptRatio ≈ 5/7 ≈ 0.714 < 0.75 (CRITICAL is stricter than NORMAL)
        expect(finalProposal.quorum.acceptRatio).toBeLessThan(0.75);
        expect(finalProposal.finalDecision).not.toBe('COMMIT');
    });
});
