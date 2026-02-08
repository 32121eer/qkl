function createQuerySession({ queryId, orchardBatchId, now = new Date().toISOString() }) {
    return {
        queryId,
        orchardBatchId,
        status: 'REQUEST_SENT',
        verifyStatus: 'PENDING',
        requestedByChain: 'FISCO_NET_01',
        targetDataChain: 'FABRIC_NET_01',
        requestTs: now,
        settleTs: null,
        requestCorrelationId: null,
        requestTxHash: null,
        requestPayloadHash: null,
        responseCorrelationId: null,
        responseRequestTxHash: null,
        responseTargetTxHash: null,
        responsePayloadHash: null,
        resultFound: null,
        resultPayload: null,
        receiptStatus: null,
        errorCode: null,
        errorMessage: null,
        finalizedBy: null,
        updatedAt: now,
        steps: [{
            ts: now,
            step: 'REQUEST_SENT',
            details: { orchardBatchId }
        }]
    };
}

module.exports = { createQuerySession };

