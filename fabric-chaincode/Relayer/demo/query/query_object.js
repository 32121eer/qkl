const {
    DEFAULT_QUERY_CHAIN_ID,
    DEFAULT_QUERY_NAMESPACE,
    DEFAULT_QUERY_TYPE,
    DEFAULT_QUERY_CODEC,
    DEFAULT_QUERY_CONTEXT
} = require('./query_types');

function normalizeOrchardBatchId(orchardBatchId) {
    const value = String(orchardBatchId || '').trim();
    if (!value) {
        throw new Error('orchardBatchId is required to build query object');
    }
    return value;
}

function buildQueryObject({
    orchardBatchId,
    chainId = DEFAULT_QUERY_CHAIN_ID,
    namespace = DEFAULT_QUERY_NAMESPACE,
    queryType = DEFAULT_QUERY_TYPE,
    codec = DEFAULT_QUERY_CODEC,
    context = DEFAULT_QUERY_CONTEXT
} = {}) {
    const batchId = normalizeOrchardBatchId(orchardBatchId);

    return {
        chainId,
        namespace,
        key: `batch:${batchId}`,
        queryType,
        codec,
        context: {
            ...DEFAULT_QUERY_CONTEXT,
            ...(context || {})
        }
    };
}

module.exports = {
    normalizeOrchardBatchId,
    buildQueryObject
};
