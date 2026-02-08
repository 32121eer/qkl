class QueryBroker {
    constructor({
        executeTrigger,
        triggerService,
        relayFacade,
        sessionService,
        eventStore,
        activeQuerySessions,
        mapSessionErrorCode
    }) {
        this.executeTrigger = executeTrigger;
        this.triggerService = triggerService;
        this.relayFacade = relayFacade;
        this.sessionService = sessionService;
        this.eventStore = eventStore;
        this.activeQuerySessions = activeQuerySessions;
        this.mapSessionErrorCode = mapSessionErrorCode;
    }

    async run(queryId) {
        const session = await this.sessionService.get(queryId);
        if (!session) return;

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
            await this.sessionService.appendStep(queryId, 'A_CHAIN_FETCHED', { found });

            const responseResult = await this.executeTrigger('FABRIC_TO_FISCO', async () => {
                return this.triggerService.triggerOrchardQueryResponse({
                    queryId,
                    orchardBatchId: session.orchardBatchId,
                    found,
                    result: orchardRecord
                });
            });

            await this.sessionService.patch(queryId, {
                status: 'RESPONSE_SENT',
                responseCorrelationId: responseResult?.correlationId || null,
                responseRequestTxHash: responseResult?.txId || null,
                responsePayloadHash: responseResult?.sourcePayloadHash || null
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
            await this.sessionService.appendStep(queryId, 'COMPLETED', {
                targetTxHash,
                receiptStatus
            });
        } catch (error) {
            const errorCode = this.mapSessionErrorCode(error);
            const nowIso = new Date().toISOString();
            await this.sessionService.patch(queryId, {
                status: 'FAILED',
                verifyStatus: 'FAILED',
                errorCode,
                errorMessage: error?.message || String(error),
                settleTs: nowIso,
                updatedAt: nowIso
            });
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

        this.sessionService.list(1000).then((sessions) => {
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
            this.sessionService.patch(session.queryId, {
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
            this.sessionService.appendStep(session.queryId, 'COMPLETED', {
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
