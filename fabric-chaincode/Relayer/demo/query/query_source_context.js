const { DEFAULT_QUERY_CHAIN_ID, DEFAULT_QUERY_CONTEXT } = require('./query_types');

function pickNumeric(...values) {
    for (const value of values) {
        const parsed = Number(value);
        if (Number.isFinite(parsed) && parsed >= 0) {
            return parsed;
        }
    }
    return 0;
}

function buildPrototypeSourceContext({
    queryId,
    orchardBatchId,
    requestResult,
    requestRelayEvent,
    responseResult,
    responseRelayEvent,
    sourceChain = DEFAULT_QUERY_CHAIN_ID,
    queryContext = DEFAULT_QUERY_CONTEXT
} = {}) {
    const sourceHeight = pickNumeric(
        responseRelayEvent?.sourceBlockNumber,
        responseRelayEvent?.data?.sourceBlockNumber,
        responseRelayEvent?.data?.blockNumber,
        requestRelayEvent?.targetBlockNumber,
        requestRelayEvent?.data?.targetBlockNumber
    );

    return {
        sourceChain,
        sourceHeight,
        sourceHeader: {
            headerKind: 'prototype-query-context',
            heightMode: sourceHeight > 0 ? 'observed' : 'placeholder',
            chainId: sourceChain,
            channel: queryContext.channel,
            chaincode: queryContext.chaincode,
            schema: queryContext.schema,
            observedAt: new Date().toISOString(),
            queryId: queryId || null,
            orchardBatchId: orchardBatchId || null,
            requestCorrelationId: requestResult?.correlationId || null,
            requestTxHash: requestResult?.txHash || null,
            responseCorrelationId: responseResult?.correlationId || null,
            responseTxId: responseResult?.txId || null
        }
    };
}

module.exports = {
    buildPrototypeSourceContext
};
