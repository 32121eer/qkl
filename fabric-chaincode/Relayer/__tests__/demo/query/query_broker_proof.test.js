const { QueryBroker } = require('../../../demo/broker/query_broker');
const { QuerySessionService } = require('../../../demo/session/query_session_service');
const { DemoMemoryStore } = require('../../../demo/store/memory_store');
const { DemoEventStore } = require('../../../demo/event_store');
const { AgentRuntime } = require('../../../demo/agents/agent_runtime');
const { NegotiationProtocol } = require('../../../demo/negotiation/negotiation_protocol');

describe('QueryBroker proof integration', () => {
    async function waitFor(assertion, { attempts = 20, delayMs = 10 } = {}) {
        let lastError = null;
        for (let index = 0; index < attempts; index += 1) {
            try {
                return await assertion();
            } catch (error) {
                lastError = error;
                await new Promise((resolve) => setTimeout(resolve, delayMs));
            }
        }
        throw lastError;
    }

    function createBroker(overrides = {}) {
        const store = new DemoMemoryStore();
        const sessionService = new QuerySessionService(store);
        const eventStore = new DemoEventStore(200);
        const activeQuerySessions = new Set();
        const agentRuntime = new AgentRuntime({ eventStore });
        const negotiationProtocol = new NegotiationProtocol({ eventStore });
        const triggerService = {
            triggerOrchardQueryRequest: jest.fn(async (queryId) => ({
                correlationId: queryId,
                txHash: '0xrequesttx',
                sourcePayloadHash: '0xrequestpayload'
            })),
            getOrchardRecord: jest.fn(async (batchId) => ({
                orchardBatchId: batchId,
                payloadVersion: '1.0',
                eventType: 'cultivation'
            })),
            triggerOrchardQueryResponse: jest.fn(async ({ queryId }) => ({
                correlationId: queryId,
                txId: '0xresponsetx',
                sourcePayloadHash: '0xresponsepayload'
            }))
        };
        const relayFacade = {
            waitForRelayEvent: jest
                .fn()
                .mockResolvedValueOnce({
                    direction: 'FISCO_TO_FABRIC',
                    relayState: 'SUCCESS',
                    correlationId: 'query_1',
                    targetBlockNumber: 123
                })
                .mockResolvedValueOnce({
                    direction: 'FABRIC_TO_FISCO',
                    relayState: 'SUCCESS',
                    correlationId: 'query_1',
                    targetTxHash: '0xtargettx',
                    receiptStatus: 'SUCCESS'
                })
        };

        const broker = new QueryBroker({
            executeTrigger: async (_direction, handler) => handler(),
            triggerService,
            relayFacade,
            sessionService,
            eventStore,
            agentRuntime,
            negotiationProtocol,
            activeQuerySessions,
            mapSessionErrorCode: (error) => error?.code || 'ERR_UNKNOWN',
            ...overrides
        });

        return {
            broker,
            sessionService,
            eventStore,
            activeQuerySessions,
            agentRuntime,
            triggerService,
            relayFacade
        };
    }

    test('session gets query proof fields and PASS status', async () => {
        const { broker, sessionService, activeQuerySessions } = createBroker();
        const queryId = 'query_1';
        await sessionService.create({
            queryId,
            orchardBatchId: 'BATCH-APPLE-0001'
        });
        activeQuerySessions.add(queryId);

        await broker.run(queryId);

        const session = await sessionService.get(queryId);
        expect(session.queryObject).toEqual(expect.objectContaining({
            key: 'batch:BATCH-APPLE-0001'
        }));
        expect(session.queryCommitment).toEqual(expect.objectContaining({
            value: expect.stringMatching(/^0x[0-9a-f]{64}$/)
        }));
        expect(session.queryProof).toEqual(expect.objectContaining({
            version: 'query-proof-v1',
            sourceHeight: 123
        }));
        expect(session.queryVerifyStatus).toBe('PASS');
        expect(session.queryVerifyChecks).toEqual({
            queryObjectMatched: true,
            headerMatched: true,
            stateWitnessMatched: true,
            commitmentMatched: true
        });
        expect(session.negotiationStatus).toBe('READY');
        expect(session.negotiationRound).toBe(2);
        expect(session.finalProposal).toEqual(expect.objectContaining({
            finalDecision: 'COMMIT'
        }));
        expect(session.negotiationProof).toEqual(expect.objectContaining({
            version: 'negotiation-proof-v1',
            proposalId: session.finalProposal.proposalId,
            finalDecision: 'COMMIT'
        }));
        expect(session.negotiationVerifyResult).toEqual(expect.objectContaining({
            ok: true
        }));
        expect(session.settlementResult).toEqual(expect.objectContaining({
            finalDecision: 'COMMIT'
        }));
        expect(session.finalProposal.proposalId).toMatch(/_r2$/);
        expect(session.crossChainTask.negotiation.history).toHaveLength(2);
        expect(session.crossChainTask.negotiation.history[0].finalProposal).toEqual(expect.objectContaining({
            finalDecision: 'OBSERVE'
        }));
        expect(session.crossChainTask.negotiation.history[0].disagreements).toEqual(expect.arrayContaining([
            expect.objectContaining({
                code: 'HEADER_GAP'
            }),
            expect.objectContaining({
                code: 'SUBMISSION_PLAN_PENDING'
            })
        ]));
        expect(session.crossChainTask.negotiation.history[0].continuation).toEqual(expect.objectContaining({
            nextRound: 2,
            requestedEvidence: expect.arrayContaining([
                expect.objectContaining({
                    type: 'SOURCE_HEADER'
                })
            ])
        }));
        expect(session.crossChainTask.negotiation.history[1].finalProposal).toEqual(expect.objectContaining({
            finalDecision: 'COMMIT'
        }));
        expect(session.selectedCommittee).toHaveLength(5);
        expect(session.finalProposal.weightVector).toHaveLength(5);
        expect(session.finalProposal).toEqual(expect.objectContaining({
            risk: 'NORMAL',
            consensusRule: expect.objectContaining({
                groupSize: 5,
                threshold: 0.7,
                minimumRevealCount: 4
            })
        }));
        expect(session.finalProposal.quorum).toEqual(expect.objectContaining({
            acceptRatio: 1,
            wbftSatisfied: true
        }));
        expect(session.finalProposal.weightVector[0]).toEqual(expect.objectContaining({
            confidence: expect.any(Number),
            effectiveWeight: expect.any(Number),
            commitHash: expect.stringMatching(/^0x[0-9a-f]{64}$/),
            commitRevealValid: true
        }));
        expect(session.crossChainTask.negotiation.history[1].evidenceCollection).toEqual(expect.objectContaining({
            collections: expect.arrayContaining([
                expect.objectContaining({
                    agentId: 'evidence-01',
                    fulfilledRequests: expect.arrayContaining(['SOURCE_HEADER'])
                })
            ])
        }));
        expect(session.crossChainTask.evidenceBundle.sourceHeader).toEqual(expect.objectContaining({
            headerKind: 'prototype-query-context'
        }));
        expect(session.crossChainTask.evidenceBundle.appliedRequests).toEqual(expect.arrayContaining([
            expect.objectContaining({
                type: 'SOURCE_HEADER',
                fulfilledBy: 'evidence-01'
            })
        ]));
        expect(session.status).toBe('COMPLETED');
    });

    test('tampered proof blocks submission with negotiation gate', async () => {
        const { broker, sessionService, activeQuerySessions } = createBroker();
        const queryId = 'query_1';
        await sessionService.create({
            queryId,
            orchardBatchId: 'BATCH-APPLE-0001'
        });
        activeQuerySessions.add(queryId);

        const originalBuilder = broker.buildQueryProofArtifacts.bind(broker);
        broker.buildQueryProofArtifacts = async (payload) => {
            const artifacts = await originalBuilder(payload);
            return {
                ...artifacts,
                queryVerifyStatus: 'FAILED',
                queryVerifyChecks: {
                    ...artifacts.queryVerifyChecks,
                    commitmentMatched: false
                },
                queryProof: {
                    ...artifacts.queryProof,
                    commitment: {
                        ...artifacts.queryProof.commitment,
                        value: '0xdeadbeef'
                    }
                }
            };
        };

        await broker.run(queryId);

        const session = await sessionService.get(queryId);
        expect(session.status).toBe('FAILED');
        expect(session.queryVerifyStatus).toBe('FAILED');
        expect(session.queryVerifyChecks.commitmentMatched).toBe(false);
        expect(session.errorCode).toBe('ERR_NEGOTIATION_BLOCKED');
        expect(session.negotiationStatus).toBe('REJECTED');
        expect(session.finalProposal).toEqual(expect.objectContaining({
            finalDecision: 'REJECT'
        }));
    });

    test('arbitration resolves final round when committee still has recoverable questions', async () => {
        const previousMaxRounds = process.env.DEMO_NEGOTIATION_MAX_ROUNDS;
        process.env.DEMO_NEGOTIATION_MAX_ROUNDS = '1';
        try {
            const { broker, sessionService, activeQuerySessions } = createBroker();
            const queryId = 'query_1';
            await sessionService.create({
                queryId,
                orchardBatchId: 'BATCH-APPLE-0001'
            });
            activeQuerySessions.add(queryId);

            await broker.run(queryId);

            const session = await sessionService.get(queryId);
            expect(session.status).toBe('COMPLETED');
            expect(session.negotiationRound).toBe(1);
            expect(session.arbitrationDecision).toEqual(expect.objectContaining({
                agentId: 'arbitration-01',
                finalDecision: 'COMMIT'
            }));
            expect(session.finalProposal).toEqual(expect.objectContaining({
                finalDecision: 'COMMIT',
                arbitration: expect.objectContaining({
                    finalDecision: 'COMMIT'
                })
            }));
            expect(session.negotiationProof).toEqual(expect.objectContaining({
                finalDecision: 'COMMIT'
            }));
        } finally {
            if (previousMaxRounds === undefined) {
                delete process.env.DEMO_NEGOTIATION_MAX_ROUNDS;
            } else {
                process.env.DEMO_NEGOTIATION_MAX_ROUNDS = previousMaxRounds;
            }
        }
    });

    test('committee selector excludes verifier with strong risky history', async () => {
        const { broker, sessionService, activeQuerySessions, agentRuntime } = createBroker();
        const candidateIds = agentRuntime.getVerifiers().map((agent) => agent.agentId);
        agentRuntime.reputationStore.ensure(candidateIds);
        const risky = agentRuntime.reputationStore.items.get('verifier-proof-01');
        risky.weight = 0.05;
        risky.successCount = 0;
        risky.totalCount = 5;
        risky.avgLatencyMs = 600;
        risky.faultCount = 5;

        const queryId = 'query_1';
        await sessionService.create({
            queryId,
            orchardBatchId: 'BATCH-APPLE-0001'
        });
        activeQuerySessions.add(queryId);

        await broker.run(queryId);

        const session = await sessionService.get(queryId);
        expect(session.selectedCommittee).toEqual(expect.arrayContaining([
            expect.objectContaining({ agentId: 'verifier-balanced-01' })
        ]));
        expect(session.selectedCommittee).not.toEqual(expect.arrayContaining([
            expect.objectContaining({ agentId: 'verifier-proof-01' })
        ]));
        expect(session.excludedAgents).toEqual(expect.arrayContaining([
            expect.objectContaining({ agentId: 'verifier-proof-01' })
        ]));
    });

    test('late relay success after timeout preserves proof artifacts', async () => {
        const { broker, sessionService, activeQuerySessions } = createBroker();
        const queryId = 'query_1';
        await sessionService.create({
            queryId,
            orchardBatchId: 'BATCH-APPLE-0001'
        });
        activeQuerySessions.add(queryId);

        const session = await sessionService.get(queryId);
        const artifacts = await broker.buildQueryProofArtifacts({
            queryId,
            session,
            found: true,
            orchardRecord: {
                orchardBatchId: 'BATCH-APPLE-0001',
                payloadVersion: '1.0',
                eventType: 'cultivation'
            },
            requestResult: {
                correlationId: queryId,
                txHash: '0xrequesttx'
            },
            requestRelayEvent: {
                targetBlockNumber: 123
            },
            responseResult: {
                correlationId: queryId,
                txId: '0xresponsetx'
            }
        });

        await sessionService.patch(queryId, {
            ...artifacts,
            status: 'FAILED',
            errorCode: 'ERR_QUERY_TIMEOUT',
            responseCorrelationId: queryId,
            responseRequestTxHash: '0xresponsetx'
        });

        broker.reconcileByRelaySuccess({
            direction: 'FABRIC_TO_FISCO',
            sourceTxHash: '0xresponsetx',
            correlationId: queryId,
            targetTxHash: '0xlate-target',
            targetBlockNumber: 456,
            receiptStatus: 'SUCCESS'
        });

        await waitFor(async () => {
            const recovered = await sessionService.get(queryId);
            expect(recovered.status).toBe('COMPLETED');
            return recovered;
        });

        const recovered = await sessionService.get(queryId);
        expect(recovered.errorCode).toBe(null);
        expect(recovered.responseTargetTxHash).toBe('0xlate-target');
        expect(recovered.queryObject).toEqual(artifacts.queryObject);
        expect(recovered.queryCommitment).toEqual(artifacts.queryCommitment);
        expect(recovered.queryProof).toEqual(artifacts.queryProof);
        expect(recovered.queryVerifyStatus).toBe('PASS');
    });

    test('missing final proposal is rejected by explicit negotiation gate', () => {
        const { broker } = createBroker();
        expect(() => broker.assertFinalProposalReady({ finalProposal: null })).toThrow('Negotiation final proposal is missing');
        expect(() => broker.assertFinalProposalReady({
            finalProposal: { proposalId: 'proposal_x', finalDecision: 'OBSERVE' }
        })).toThrow('Negotiation blocked response submission: OBSERVE');
        expect(
            broker.assertFinalProposalReady({
                finalProposal: { proposalId: 'proposal_y', finalDecision: 'COMMIT' }
            }).proposalId
        ).toBe('proposal_y');
    });
});
