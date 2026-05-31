const { buildQueryObject } = require('../query/query_object');
const { buildQueryProof } = require('../query/query_proof_builder');
const { VerifyQuery } = require('../query/query_verifier');
const { buildPrototypeSourceContext } = require('../query/query_source_context');
const { buildNegotiationProof, verifyNegotiationProof } = require('../negotiation/negotiation_proof');
const { buildNegotiatedResponsePayload } = require('../negotiation/response_envelope');
const { SettlementEngine } = require('../negotiation/settlement_engine');
const { normalizeRisk } = require('../negotiation/protocol_config');
const {
    buildSessionTaskPatch,
    createCrossChainTask,
    mergeCrossChainTask
} = require('../negotiation/cross_chain_task');

class QueryBroker {
    constructor({
        executeTrigger,
        triggerService,
        relayFacade,
        sessionService,
        eventStore,
        agentRuntime,
        negotiationProtocol,
        activeQuerySessions,
        mapSessionErrorCode
    }) {
        this.executeTrigger = executeTrigger;
        this.triggerService = triggerService;
        this.relayFacade = relayFacade;
        this.sessionService = sessionService;
        this.eventStore = eventStore;
        this.agentRuntime = agentRuntime;
        this.negotiationProtocol = negotiationProtocol;
        this.activeQuerySessions = activeQuerySessions;
        this.mapSessionErrorCode = mapSessionErrorCode;
        this.settlementEngine = new SettlementEngine();
    }

    createTask(queryId, session) {
        return createCrossChainTask({
            taskId: `cc_task_${queryId}`,
            queryId,
            orchardBatchId: session.orchardBatchId,
            sourceChain: session.requestedByChain,
            targetChain: session.targetDataChain,
            risk: this.classifyRisk(session),
            taskType: 'QUERY_RESPONSE_RELAY'
        });
    }

    classifyRisk(session = {}) {
        if (session.risk) {
            return normalizeRisk(session.risk);
        }
        if (session.riskLevel) {
            return normalizeRisk(session.riskLevel);
        }
        const batchId = String(session.orchardBatchId || '').toUpperCase();
        if (batchId.includes('CRITICAL') || batchId.includes('REGULATORY') || batchId.includes('AUDIT')) {
            return 'CRITICAL';
        }
        return 'NORMAL';
    }

    async patchTask(queryId, session, patch = {}) {
        const nextTask = mergeCrossChainTask(
            session?.crossChainTask || this.createTask(queryId, session),
            patch
        );
        const nextSession = await this.sessionService.patch(queryId, buildSessionTaskPatch(nextTask));
        return nextSession || session;
    }

    async runInitialAgentRound(queryId, session) {
        if (!this.agentRuntime || !session?.crossChainTask) {
            return session;
        }

        const maxRounds = Math.max(1, Number(process.env.DEMO_NEGOTIATION_MAX_ROUNDS) || 2);
        let currentSession = session;
        let carrySubmitterPlan = null;
        let carryContinuation = null;

        for (let round = 1; round <= maxRounds; round += 1) {
            let evidenceCollection = null;
            if (carryContinuation?.requestedEvidence?.length) {
                evidenceCollection = await this.agentRuntime.collectEvidence(currentSession.crossChainTask, {
                    session: currentSession,
                    round,
                    currentRound: round,
                    evidenceRequests: carryContinuation.requestedEvidence,
                    continuation: carryContinuation
                });

                const evidencePatch = evidenceCollection?.evidencePatch || {};
                const hasEvidenceDelta = Object.keys(evidencePatch).some((key) => {
                    const value = evidencePatch[key];
                    if (Array.isArray(value)) return value.length > 0;
                    return value !== null && value !== undefined;
                });

                if (hasEvidenceDelta) {
                    currentSession = await this.patchTask(queryId, currentSession, {
                        status: 'EVIDENCE_SUPPLEMENTED',
                        evidenceBundle: evidencePatch
                    });
                    await this.sessionService.appendStep(queryId, `NEGOTIATION_EVIDENCE_ROUND_${round}`, {
                        requestedEvidence: carryContinuation.requestedEvidence.map((item) => item.type),
                        fulfilledRequests: (evidenceCollection.collections || []).flatMap((item) => item.fulfilledRequests || []),
                        missingRequests: (evidenceCollection.collections || []).flatMap((item) => item.missingRequests || [])
                    });
                }
            }

            const runtimeResult = await this.agentRuntime.evaluateTask(currentSession.crossChainTask, {
                session: currentSession,
                round,
                currentRound: round,
                submitterPlan: carrySubmitterPlan,
                negotiationHistory: currentSession.crossChainTask?.negotiation?.history || [],
                continuation: carryContinuation
            });
            const coordination = runtimeResult.coordination || {};
            const submitterPlan = runtimeResult.submitterPlan || carrySubmitterPlan || null;
            const protocolResult = this.negotiationProtocol
                ? await this.negotiationProtocol.run({
                    task: currentSession.crossChainTask,
                    opinions: runtimeResult.opinions || [],
                    coordination,
                    submitterPlan,
                    round,
                    maxRounds,
                    behaviorAnalysis: runtimeResult.behaviorAnalysis || null,
                    committee: runtimeResult.committee || null,
                    arbitration: null
                })
                : {
                    status: coordination.status || 'COLLECTING',
                    round: coordination.round || round,
                    disagreements: [],
                    finalProposal: null,
                    shouldContinue: false,
                    continuation: null
                };
            let arbitration = null;
            if (round === maxRounds && !protocolResult.shouldContinue && protocolResult.finalProposal?.finalDecision === 'OBSERVE') {
                arbitration = await this.agentRuntime.arbitrate(currentSession.crossChainTask, {
                    session: currentSession,
                    round,
                    currentRound: round,
                    opinions: runtimeResult.opinions || [],
                    disagreements: protocolResult.disagreements || [],
                    behaviorAnalysis: runtimeResult.behaviorAnalysis || null
                });
                if (arbitration?.finalDecision && arbitration.finalDecision !== 'OBSERVE') {
                    const rerun = await this.negotiationProtocol.run({
                        task: currentSession.crossChainTask,
                        opinions: runtimeResult.opinions || [],
                        coordination,
                        submitterPlan,
                        round,
                        maxRounds,
                        behaviorAnalysis: runtimeResult.behaviorAnalysis || null,
                        committee: runtimeResult.committee || null,
                        arbitration
                    });
                    protocolResult.status = rerun.status;
                    protocolResult.round = rerun.round;
                    protocolResult.disagreements = rerun.disagreements;
                    protocolResult.finalProposal = rerun.finalProposal;
                    protocolResult.shouldContinue = rerun.shouldContinue;
                    protocolResult.continuation = rerun.continuation;
                }
            }

            const historyEntry = {
                type: round === 1 ? 'INITIAL_ROUND' : 'FOLLOWUP_ROUND',
                round,
                generatedAt: new Date().toISOString(),
                agentOpinions: runtimeResult.opinions || [],
                coordination,
                submitterPlan,
                disagreements: protocolResult.disagreements || [],
                finalProposal: protocolResult.finalProposal || null,
                committee: runtimeResult.committee || null,
                behaviorAnalysis: runtimeResult.behaviorAnalysis || null,
                arbitration,
                continuationIn: carryContinuation,
                continuation: protocolResult.continuation || null,
                evidenceCollection
            };

            currentSession = await this.patchTask(queryId, currentSession, {
                negotiation: {
                    status: protocolResult.status || coordination.status || 'COLLECTING',
                    round: protocolResult.round || coordination.round || round,
                    proposalId: protocolResult.finalProposal?.proposalId || null,
                    continuation: protocolResult.continuation || null,
                    latestDisagreements: protocolResult.disagreements || [],
                    requestedEvidence: protocolResult.continuation?.requestedEvidence || [],
                    selectedCommittee: runtimeResult.committee?.selected || [],
                    excludedAgents: runtimeResult.committee?.excluded || [],
                    behaviorSummary: runtimeResult.behaviorAnalysis || null,
                    arbitration: arbitration || null,
                    finalProposal: protocolResult.finalProposal || null,
                    agentOpinions: runtimeResult.opinions || [],
                    history: [historyEntry]
                }
            });
            this.agentRuntime.finalizeRound({
                opinions: runtimeResult.opinions || [],
                finalProposal: protocolResult.finalProposal || null
            });

            await this.sessionService.appendStep(queryId, `NEGOTIATION_ROUND_${round}`, {
                proposalId: protocolResult.finalProposal?.proposalId || null,
                finalDecision: protocolResult.finalProposal?.finalDecision || null,
                status: protocolResult.status || coordination.status || 'COLLECTING',
                disagreementCodes: (protocolResult.disagreements || []).map((item) => item.code),
                continuedToNextRound: Boolean(protocolResult.shouldContinue)
            });

            if (!protocolResult.shouldContinue) {
                return currentSession;
            }

            carrySubmitterPlan = submitterPlan;
            carryContinuation = protocolResult.continuation || null;
            currentSession = await this.sessionService.get(queryId);
        }

        return currentSession;
    }

    async collectInitialEvidence(queryId, session) {
        if (!this.agentRuntime || !session?.crossChainTask) {
            return session;
        }
        const evidenceCollection = await this.agentRuntime.collectEvidence(session.crossChainTask, {
            session,
            round: 0,
            currentRound: 0,
            evidenceRequests: [{
                type: 'EVIDENCE_PACKAGE',
                reason: 'DUAL_COLLECTOR_PRECHECK',
                priority: 'HIGH'
            }]
        });
        const evidencePatch = evidenceCollection?.evidencePatch || {};
        const collectorAttestations = Array.isArray(evidencePatch.collectorAttestations)
            ? evidencePatch.collectorAttestations
            : [];
        const evidenceHashes = new Set(collectorAttestations.map((item) => item.evidenceHash).filter(Boolean));
        const organizations = new Set(collectorAttestations.map((item) => item.organization).filter(Boolean));
        const collectorComparison = {
            status: collectorAttestations.length >= 2 && evidenceHashes.size === 1 && organizations.size >= 2
                ? 'MATCHED'
                : 'MISMATCH',
            collectorCount: collectorAttestations.length,
            organizationCount: organizations.size,
            evidenceHashes: Array.from(evidenceHashes),
            comparedAt: new Date().toISOString()
        };

        const nextSession = await this.patchTask(queryId, session, {
            status: collectorComparison.status === 'MATCHED' ? 'EVIDENCE_COLLECTED' : 'ARBITRATING',
            evidenceBundle: {
                ...evidencePatch,
                collectorComparison
            }
        });
        await this.sessionService.appendStep(queryId, 'EVIDENCE_COLLECTED', {
            collectorCount: collectorComparison.collectorCount,
            organizationCount: collectorComparison.organizationCount,
            status: collectorComparison.status
        });
        return nextSession;
    }

    assertFinalProposalReady(session) {
        const finalProposal = session?.finalProposal || session?.crossChainTask?.negotiation?.finalProposal || null;
        if (!finalProposal) {
            const error = new Error('Negotiation final proposal is missing');
            error.code = 'ERR_NEGOTIATION_BLOCKED';
            throw error;
        }
        if (finalProposal.finalDecision !== 'COMMIT') {
            const error = new Error(`Negotiation blocked response submission: ${finalProposal.finalDecision}`);
            error.code = 'ERR_NEGOTIATION_BLOCKED';
            error.finalProposal = finalProposal;
            throw error;
        }
        return finalProposal;
    }

    buildNegotiationArtifacts({ queryId, session, finalProposal, responsePayload }) {
        const negotiationProof = buildNegotiationProof({
            queryId,
            orchardBatchId: session?.orchardBatchId,
            finalProposal,
            queryCommitment: session?.queryCommitment || session?.resultCommitment,
            evidenceVersion: session?.evidenceVersion || session?.crossChainTask?.evidenceVersion || 0,
            responsePayload
        });
        const negotiationVerifyResult = verifyNegotiationProof(negotiationProof, {
            proposalId: finalProposal?.proposalId,
            finalDecision: finalProposal?.finalDecision,
            queryCommitment: session?.queryCommitment?.value || session?.resultCommitment?.value || null
        });
        const settlementResult = this.settlementEngine.settle({
            finalProposal,
            queryId
        });

        return {
            negotiationProof,
            negotiationVerifyResult,
            settlementResult
        };
    }

    async buildQueryProofArtifacts({
        queryId,
        session,
        found,
        orchardRecord,
        requestResult,
        requestRelayEvent,
        responseResult,
        responseRelayEvent
    }) {
        const queryObject = buildQueryObject({
            orchardBatchId: session.orchardBatchId
        });
        const resultValue = {
            found,
            record: orchardRecord
        };
        const sourceContext = buildPrototypeSourceContext({
            queryId,
            orchardBatchId: session.orchardBatchId,
            requestResult,
            requestRelayEvent,
            responseResult,
            responseRelayEvent,
            sourceChain: session.targetDataChain
        });
        const queryProof = buildQueryProof({
            queryObject,
            resultValue,
            sourceChain: sourceContext.sourceChain,
            sourceHeight: sourceContext.sourceHeight,
            sourceHeader: sourceContext.sourceHeader,
            meta: {
                schema: 'orchard-record-v1',
                queryId,
                orchardBatchId: session.orchardBatchId
            }
        });
        const verified = VerifyQuery({
            proof: queryProof,
            queryObject,
            resultValue,
            sourceHeaderHash: queryProof.sourceHeaderHash
        });

        return {
            queryObject,
            queryCommitment: queryProof.commitment,
            resultCommitment: queryProof.commitment,
            queryProof,
            proofBundle: queryProof,
            queryProofVersion: queryProof.version,
            queryVerifyStatus: verified.ok ? 'PASS' : 'FAILED',
            queryVerifyChecks: verified.checks,
            queryVerifyResult: verified
        };
    }

    async run(queryId) {
        let session = await this.sessionService.get(queryId);
        if (!session) return;

        session = await this.patchTask(queryId, session, {
            status: 'CREATED',
            evidenceBundle: {
                sourceChain: session.requestedByChain,
                targetChain: session.targetDataChain
            }
        });
        this.eventStore.addEvent({
            type: 'negotiation',
            direction: 'FISCO_TO_FABRIC',
            relayState: 'PENDING',
            correlationId: queryId,
            message: `Cross-chain task created for ${session.orchardBatchId}`,
            data: {
                queryId,
                taskId: session.crossChainTask?.taskId || `cc_task_${queryId}`,
                taskType: 'QUERY_RESPONSE_RELAY',
                evidenceVersion: session.evidenceVersion || 0
            }
        });

        try {
            const requestResult = await this.executeTrigger('FISCO_TO_FABRIC', async () => {
                return this.triggerService.triggerOrchardQueryRequest(queryId, session.orchardBatchId);
            });

            await this.sessionService.patch(queryId, {
                status: 'REQUEST_SENT',
                requestCorrelationId: requestResult?.correlationId || null,
                requestTxHash: requestResult?.txHash || null,
                requestPayloadHash: requestResult?.sourcePayloadHash || null
            });
            session = await this.sessionService.get(queryId);
            session = await this.patchTask(queryId, session, {
                status: 'REQUEST_SENT',
                evidenceBundle: {
                    sourceTxHash: requestResult?.txHash || null,
                    payload: {
                        orchardBatchId: session.orchardBatchId
                    },
                    payloadHash: requestResult?.sourcePayloadHash || null,
                    request: {
                        correlationId: requestResult?.correlationId || null,
                        txHash: requestResult?.txHash || null,
                        payloadHash: requestResult?.sourcePayloadHash || null,
                        direction: 'FISCO_TO_FABRIC'
                    }
                }
            });
            await this.sessionService.appendStep(queryId, 'REQUEST_SENT', {
                txHash: requestResult?.txHash || null,
                correlationId: requestResult?.correlationId || null
            });

            const requestRelayEvent = await this.relayFacade.waitForRelayEvent(
                'FISCO_TO_FABRIC',
                {
                    sourceTxHash: requestResult?.txHash || null,
                    correlationId: requestResult?.correlationId || null
                },
                Number(process.env.DEMO_QUERY_RELAY_TIMEOUT_REQUEST_MS) || 60_000,
                Number(process.env.DEMO_QUERY_RELAY_POLL_INTERVAL_MS) || 300
            );
            if (requestRelayEvent.relayState === 'FAILED') {
                throw new Error(requestRelayEvent.message || 'Request relay failed');
            }
            session = await this.sessionService.get(queryId);
            session = await this.patchTask(queryId, session, {
                status: 'REQUEST_RELAYED',
                evidenceBundle: {
                    relayReceipts: [{
                        direction: 'FISCO_TO_FABRIC',
                        relayState: requestRelayEvent.relayState || null,
                        sourceTxHash: requestRelayEvent.sourceTxHash || requestResult?.txHash || null,
                        targetTxHash: requestRelayEvent.targetTxHash || null,
                        targetBlockNumber: requestRelayEvent.targetBlockNumber ?? null,
                        receiptStatus: requestRelayEvent.receiptStatus || null
                    }],
                    request: {
                        relayEvent: requestRelayEvent
                    }
                }
            });

            let orchardRecord = null;
            let found = false;
            try {
                orchardRecord = await this.triggerService.getOrchardRecord(session.orchardBatchId);
                found = true;
            } catch (error) {
                if (/not found/i.test(String(error?.message || ''))) {
                    found = false;
                } else {
                    throw error;
                }
            }

            await this.sessionService.patch(queryId, {
                status: 'A_CHAIN_FETCHED',
                resultFound: found,
                resultPayload: orchardRecord
            });
            session = await this.sessionService.get(queryId);
            session = await this.patchTask(queryId, session, {
                status: 'A_CHAIN_FETCHED',
                evidenceBundle: {
                    payload: {
                        orchardBatchId: session.orchardBatchId,
                        found,
                        result: orchardRecord
                    }
                }
            });
            await this.sessionService.appendStep(queryId, 'A_CHAIN_FETCHED', { found });

            try {
                const queryProofArtifacts = await this.buildQueryProofArtifacts({
                    queryId,
                    session,
                    found,
                    orchardRecord,
                    requestResult,
                    requestRelayEvent
                });
                await this.sessionService.patch(queryId, queryProofArtifacts);
                session = await this.sessionService.get(queryId);
                session = await this.patchTask(queryId, session, {
                    status: 'PROOF_READY',
                    evidenceBundle: {
                        sourceBlockNumber: queryProofArtifacts.queryProof?.sourceHeight ?? null,
                        queryObject: queryProofArtifacts.queryObject || null,
                        queryProof: queryProofArtifacts.queryProof || null,
                        proofBundle: queryProofArtifacts.proofBundle || null,
                        preVerification: {
                            type: 'CRYPTOGRAPHIC_PREVERIFY',
                            status: queryProofArtifacts.queryVerifyStatus,
                            checks: queryProofArtifacts.queryVerifyChecks || {},
                            verifiedAt: queryProofArtifacts.queryVerifyResult?.verifiedAt || new Date().toISOString()
                        }
                    }
                });
                session = await this.collectInitialEvidence(queryId, session);
                session = await this.runInitialAgentRound(queryId, session);
                this.eventStore.addEvent({
                    type: 'query-proof',
                    direction: 'FISCO_TO_FABRIC',
                    relayState: queryProofArtifacts.queryVerifyStatus === 'PASS' ? 'SUCCESS' : 'FAILED',
                    correlationId: queryId,
                    message: `Query proof ${queryProofArtifacts.queryVerifyStatus} for ${session.orchardBatchId}`,
                    data: {
                        queryId,
                        orchardBatchId: session.orchardBatchId,
                        queryProofVersion: queryProofArtifacts.queryProofVersion,
                        queryCommitment: queryProofArtifacts.queryCommitment?.value || null,
                        queryVerifyChecks: queryProofArtifacts.queryVerifyChecks || null,
                        sourceHeight: queryProofArtifacts.queryProof?.sourceHeight ?? null,
                        sourceHeaderHash: queryProofArtifacts.queryProof?.sourceHeaderHash || null,
                        witnessType: queryProofArtifacts.queryProof?.stateWitness?.type || null
                    }
                });
            } catch (proofError) {
                await this.sessionService.patch(queryId, {
                    queryVerifyStatus: 'FAILED',
                    queryVerifyChecks: {
                        queryObjectMatched: false,
                        headerMatched: false,
                        stateWitnessMatched: false,
                        commitmentMatched: false
                    },
                    queryProofVersion: 'query-proof-v1',
                    queryVerifyResult: null
                });
                this.eventStore.addEvent({
                    level: 'error',
                    type: 'query-proof',
                    direction: 'FISCO_TO_FABRIC',
                    relayState: 'FAILED',
                    correlationId: queryId,
                    errorCode: 'ERR_QUERY_PROOF_BUILD',
                    message: proofError.message || String(proofError),
                    data: {
                        queryId,
                        orchardBatchId: session.orchardBatchId
                    }
                });
            }

            session = await this.sessionService.get(queryId);
            const finalProposal = this.assertFinalProposalReady(session);
            const responsePayload = buildNegotiatedResponsePayload({
                queryId,
                orchardBatchId: session.orchardBatchId,
                found,
                result: orchardRecord
            });
            const negotiationArtifacts = this.buildNegotiationArtifacts({
                queryId,
                session,
                finalProposal,
                responsePayload
            });
            await this.sessionService.patch(queryId, negotiationArtifacts);
            session = await this.sessionService.get(queryId);
            session = await this.patchTask(queryId, session, {
                negotiation: {
                    negotiationProof: negotiationArtifacts.negotiationProof,
                    settlementResult: negotiationArtifacts.settlementResult
                }
            });

            const responseResult = await this.executeTrigger('FABRIC_TO_FISCO', async () => {
                return this.triggerService.triggerOrchardQueryResponse({
                    queryId,
                    orchardBatchId: session.orchardBatchId,
                    found,
                    result: orchardRecord,
                    negotiationProof: negotiationArtifacts.negotiationProof,
                    settlementResult: negotiationArtifacts.settlementResult
                });
            });

            await this.sessionService.patch(queryId, {
                status: 'RESPONSE_SENT',
                responseCorrelationId: responseResult?.correlationId || null,
                responseRequestTxHash: responseResult?.txId || null,
                responsePayloadHash: responseResult?.sourcePayloadHash || null
            });
            session = await this.sessionService.get(queryId);
            session = await this.patchTask(queryId, session, {
                status: 'RESPONSE_SENT',
                evidenceBundle: {
                    response: {
                        correlationId: responseResult?.correlationId || null,
                        txId: responseResult?.txId || null,
                        payloadHash: responseResult?.sourcePayloadHash || null,
                        direction: 'FABRIC_TO_FISCO'
                    }
                }
            });
            await this.sessionService.appendStep(queryId, 'RESPONSE_SENT', {
                txHash: responseResult?.txId || null,
                correlationId: responseResult?.correlationId || null
            });

            const responseRelayEvent = await this.relayFacade.waitForRelayEvent(
                'FABRIC_TO_FISCO',
                {
                    sourceTxHash: responseResult?.txId || null,
                    correlationId: responseResult?.correlationId || null
                },
                Number(process.env.DEMO_QUERY_RELAY_TIMEOUT_RESPONSE_MS) || 300_000,
                Number(process.env.DEMO_QUERY_RELAY_POLL_INTERVAL_MS) || 300
            );
            if (responseRelayEvent.relayState === 'FAILED') {
                throw new Error(responseRelayEvent.message || 'Response relay failed');
            }

            const targetTxHash = responseRelayEvent.targetTxHash || responseRelayEvent.data?.targetTxHash || null;
            const receiptStatus = responseRelayEvent.receiptStatus || responseRelayEvent.data?.receiptStatus || 'SUCCESS';

            const nowIso = new Date().toISOString();
            await this.sessionService.patch(queryId, {
                status: 'COMPLETED',
                responseTargetTxHash: targetTxHash,
                receiptStatus,
                verifyStatus: 'PASS',
                settleTs: nowIso,
                errorCode: null,
                errorMessage: null,
                updatedAt: nowIso
            });
            session = await this.sessionService.get(queryId);
            session = await this.patchTask(queryId, session, {
                status: 'COMPLETED',
                evidenceBundle: {
                    relayReceipts: [{
                        direction: 'FABRIC_TO_FISCO',
                        relayState: responseRelayEvent.relayState || null,
                        sourceTxHash: responseRelayEvent.sourceTxHash || responseResult?.txId || null,
                        targetTxHash: targetTxHash || null,
                        targetBlockNumber: responseRelayEvent.targetBlockNumber ?? null,
                        receiptStatus
                    }],
                    response: {
                        relayEvent: responseRelayEvent,
                        targetTxHash,
                        receiptStatus
                    }
                }
            });
            await this.sessionService.appendStep(queryId, 'COMPLETED', {
                targetTxHash,
                receiptStatus
            });
        } catch (error) {
            const errorCode = this.mapSessionErrorCode(error);
            const nowIso = new Date().toISOString();
            const currentSession = await this.sessionService.get(queryId);
            if (errorCode === 'ERR_NEGOTIATION_BLOCKED' && currentSession) {
                await this.sessionService.appendStep(queryId, 'NEGOTIATION_BLOCKED', {
                    finalDecision: currentSession.finalProposal?.finalDecision || error.finalProposal?.finalDecision || null,
                    proposalId: currentSession.finalProposal?.proposalId || error.finalProposal?.proposalId || null,
                    errorMessage: error?.message || String(error)
                });
                this.eventStore.addEvent({
                    type: 'negotiation',
                    direction: 'FABRIC_TO_FISCO',
                    relayState: 'BLOCKED',
                    correlationId: queryId,
                    errorCode,
                    message: error?.message || String(error),
                    data: {
                        queryId,
                        proposalId: currentSession.finalProposal?.proposalId || error.finalProposal?.proposalId || null,
                        finalDecision: currentSession.finalProposal?.finalDecision || error.finalProposal?.finalDecision || null
                    }
                });
            }
            await this.sessionService.patch(queryId, {
                status: 'FAILED',
                verifyStatus: 'FAILED',
                errorCode,
                errorMessage: error?.message || String(error),
                settleTs: nowIso,
                updatedAt: nowIso
            });
            session = await this.sessionService.get(queryId);
            if (session) {
                await this.patchTask(queryId, session, {
                    status: 'FAILED',
                    negotiation: {
                        status: errorCode === 'ERR_NEGOTIATION_BLOCKED'
                            ? (session.negotiationStatus || 'REVIEW')
                            : 'FAILED'
                    }
                });
            }
            await this.sessionService.appendStep(queryId, 'FAILED', {
                errorCode,
                errorMessage: error?.message || String(error)
            });
            this.eventStore.addEvent({
                level: 'error',
                type: 'query',
                direction: 'FISCO_TO_FABRIC',
                relayState: 'FAILED',
                correlationId: queryId,
                errorCode,
                message: `Query session failed: ${error?.message || String(error)}`,
                data: {
                    queryId,
                    orchardBatchId: session.orchardBatchId
                }
            });
        } finally {
            this.activeQuerySessions.delete(queryId);
        }
    }

    reconcileByRelaySuccess({
        direction,
        sourceTxHash,
        correlationId,
        targetTxHash,
        targetBlockNumber,
        targetPayloadHash,
        receiptStatus
    }) {
        if (direction !== 'FABRIC_TO_FISCO') {
            return;
        }

        this.sessionService.list(1000).then(async (sessions) => {
            for (const session of sessions) {
            const txMatched =
                Boolean(sourceTxHash) &&
                Boolean(session.responseRequestTxHash) &&
                session.responseRequestTxHash === sourceTxHash;
            const correlationMatched =
                Boolean(correlationId) &&
                Boolean(session.responseCorrelationId) &&
                session.responseCorrelationId === correlationId;

            if (!txMatched && !correlationMatched) {
                continue;
            }

            const previousStatus = session.status;
            const shouldRecoverFromTimeout =
                previousStatus === 'FAILED' && session.errorCode === 'ERR_QUERY_TIMEOUT';
            const shouldFinalize =
                previousStatus === 'RESPONSE_SENT' || shouldRecoverFromTimeout;

            if (!shouldFinalize) {
                continue;
            }

            const nowIso = new Date().toISOString();
            const finalReceiptStatus = receiptStatus || session.receiptStatus || 'SUCCESS';
            await this.sessionService.patch(session.queryId, {
                status: 'COMPLETED',
                verifyStatus: 'PASS',
                responseTargetTxHash: targetTxHash || session.responseTargetTxHash || null,
                responsePayloadHash: targetPayloadHash || session.responsePayloadHash || null,
                receiptStatus: finalReceiptStatus,
                settleTs: nowIso,
                errorCode: null,
                errorMessage: null,
                updatedAt: nowIso
            });
            await this.sessionService.appendStep(session.queryId, 'COMPLETED', {
                targetTxHash: targetTxHash || null,
                targetBlockNumber: targetBlockNumber ?? null,
                receiptStatus: finalReceiptStatus,
                recoveredFromTimeout: shouldRecoverFromTimeout
            });

            this.activeQuerySessions.delete(session.queryId);

            this.eventStore.addEvent({
                type: 'query',
                direction: 'FABRIC_TO_FISCO',
                relayState: 'SUCCESS',
                correlationId: session.queryId,
                sourceTxHash: session.responseRequestTxHash || sourceTxHash || null,
                targetTxHash: targetTxHash || null,
                targetBlockNumber: targetBlockNumber ?? null,
                receiptStatus: finalReceiptStatus,
                message: shouldRecoverFromTimeout
                    ? `Query session ${session.queryId} recovered from timeout by late relay success`
                    : `Query session ${session.queryId} completed by relay callback`,
                data: {
                    queryId: session.queryId,
                    orchardBatchId: session.orchardBatchId,
                    recoveredFromTimeout: shouldRecoverFromTimeout
                }
            });
            }
        }).catch((_error) => {});
    }
}

module.exports = { QueryBroker };
