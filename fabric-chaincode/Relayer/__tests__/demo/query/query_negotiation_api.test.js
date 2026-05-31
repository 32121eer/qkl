const { DemoApiServer } = require('../../../demo/api_server');

function createSession() {
    return {
        queryId: 'query_1',
        orchardBatchId: 'BATCH-APPLE-0001',
        status: 'COMPLETED',
        verifyStatus: 'PASS',
        queryObject: {
            chainId: 'FABRIC_NET_01',
            namespace: 'orchard',
            key: 'batch:BATCH-APPLE-0001'
        },
        queryCommitment: {
            version: 'query-proof-v1',
            algorithm: 'sha256',
            value: '0xcommitment',
            inputs: {
                sourceHeight: 123,
                sourceHeaderHash: '0xheader'
            }
        },
        queryVerifyStatus: 'PASS',
        queryVerifyChecks: {
            queryObjectMatched: true,
            headerMatched: true,
            stateWitnessMatched: true,
            commitmentMatched: true
        },
        queryProof: {
            version: 'query-proof-v1',
            sourceChain: 'FABRIC_NET_01',
            sourceHeight: 123,
            sourceHeaderHash: '0xheader',
            stateWitness: {
                type: 'record-snapshot',
                sourceFunction: 'GetOrchardRecord',
                note: 'prototype witness'
            },
            commitment: {
                value: '0xcommitment'
            }
        },
        negotiationStatus: 'READY',
        negotiationRound: 1,
        negotiationProposalId: 'proposal_query_1_2',
        negotiationProof: {
            version: 'negotiation-proof-v1',
            digest: '0xdigest',
            proposalId: 'proposal_query_1_2',
            finalDecision: 'COMMIT'
        },
        negotiationVerifyResult: {
            ok: true
        },
        settlementResult: {
            settlementId: 'settlement_query_1',
            finalDecision: 'COMMIT',
            feePool: 12
        },
        finalProposal: {
            proposalId: 'proposal_query_1_2',
            finalDecision: 'COMMIT',
            quorum: {
                total: 3,
                required: 3,
                approved: 3,
                rejected: 0,
                questioned: 0
            },
            supportingAgents: ['verifier-1', 'verifier-2', 'verifier-3'],
            questioningAgents: [],
            rejectingAgents: [],
            weightVector: [
                { agentId: 'verifier-1', weight: 0.42, latencyMs: 18 },
                { agentId: 'verifier-2', weight: 0.31, latencyMs: 22 },
                { agentId: 'verifier-3', weight: 0.27, latencyMs: 35 }
            ],
            disagreements: []
        },
        selectedCommittee: [
            { agentId: 'verifier-1', focus: 'proof' },
            { agentId: 'verifier-2', focus: 'timing' }
        ],
        excludedAgents: [
            { agentId: 'verifier-risky', score: -0.12, risk: 0.82, excluded: true }
        ],
        behaviorSummary: {
            hiddenCollusionAgents: [],
            eclipseRiskAgents: ['verifier-risky'],
            reports: {
                'verifier-risky': {
                    agentId: 'verifier-risky',
                    riskScore: 0.82,
                    successRate: 0.33
                }
            }
        },
        arbitrationDecision: {
            agentId: 'arbiter-1',
            finalDecision: 'COMMIT',
            reasons: ['arbitrator accepts proof-valid majority despite remaining questions']
        },
        crossChainTask: {
            negotiation: {
                status: 'READY',
                round: 1,
                finalProposal: {
                    proposalId: 'proposal_query_1_2',
                    finalDecision: 'COMMIT',
                    quorum: {
                        total: 3,
                        required: 3,
                        approved: 3,
                        rejected: 0,
                        questioned: 0
                    },
                    supportingAgents: ['verifier-1', 'verifier-2', 'verifier-3'],
                    questioningAgents: [],
                    rejectingAgents: [],
                    disagreements: []
                },
                history: [{
                    disagreements: []
                }]
            }
        }
    };
}

function createServerLike() {
    const demo = Object.create(DemoApiServer.prototype);
    demo.executeVerifyQuery = jest.fn(() => ({
        ok: true,
        checks: {
            queryObjectMatched: true,
            headerMatched: true,
            stateWitnessMatched: true,
            commitmentMatched: true
        },
        verifiedAt: '2026-04-15T00:00:00.000Z'
    }));
    return demo;
}

describe('query negotiation api presentation', () => {
    test('presentQuerySession exposes negotiationSummary with proposal decision', () => {
        const demo = createServerLike();
        const result = demo.presentQuerySession(createSession());

        expect(result.negotiationSummary).toEqual(expect.objectContaining({
            status: 'READY',
            round: 1,
            proposalId: 'proposal_query_1_2',
            finalDecision: 'COMMIT',
            evidenceVersion: 0
        }));
        expect(result.negotiationSummary.negotiationProof).toEqual(expect.objectContaining({
            proposalId: 'proposal_query_1_2'
        }));
        expect(result.negotiationSummary.settlementResult).toEqual(expect.objectContaining({
            settlementId: 'settlement_query_1'
        }));
        expect(result.negotiationSummary.quorum).toEqual(expect.objectContaining({
            approved: 3,
            required: 3
        }));
        expect(result.negotiationSummary.weightVector[0]).toEqual(expect.objectContaining({
            agentId: 'verifier-1',
            weight: 0.42
        }));
        expect(result.negotiationSummary.selectedCommittee[0]).toEqual(expect.objectContaining({
            agentId: 'verifier-1'
        }));
        expect(result.negotiationSummary.excludedAgents[0]).toEqual(expect.objectContaining({
            agentId: 'verifier-risky'
        }));
        expect(result.negotiationSummary.arbitrationDecision).toEqual(expect.objectContaining({
            finalDecision: 'COMMIT'
        }));
        expect(result.negotiationSummary.supportingAgents).toHaveLength(3);
    });

    test('summarizeNegotiation keeps disagreements visible for blocked sessions', () => {
        const demo = createServerLike();
        const session = createSession();
        session.negotiationStatus = 'REVIEW';
        session.finalProposal = {
            proposalId: 'proposal_query_1_3',
            finalDecision: 'OBSERVE',
            quorum: {
                total: 3,
                required: 3,
                approved: 2,
                rejected: 0,
                questioned: 1
            },
            supportingAgents: ['verifier-1', 'verifier-2'],
            questioningAgents: ['verifier-3'],
            rejectingAgents: [],
            disagreements: [{
                code: 'HEADER_GAP',
                message: 'Some verifiers require additional header evidence before commit',
                severity: 'MEDIUM'
            }]
        };
        session.crossChainTask.negotiation.history = [{
            disagreements: session.finalProposal.disagreements
        }];

        const summary = demo.summarizeNegotiation(session);
        expect(summary.status).toBe('REVIEW');
        expect(summary.finalDecision).toBe('OBSERVE');
        expect(summary.disagreementCount).toBe(1);
        expect(summary.disagreements[0].code).toBe('HEADER_GAP');
        expect(summary.requestedEvidence).toEqual([]);
    });
});
