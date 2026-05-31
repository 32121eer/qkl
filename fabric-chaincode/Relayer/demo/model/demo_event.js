const DEFAULTS = Object.freeze({
    level: 'info',
    type: 'system',
    kind: 'system',
    direction: 'UNKNOWN',
    relayState: 'INFO',
    correlationId: null,
    queryId: null,
    stage: null,
    sourceTxHash: null,
    sourceBlockNumber: null,
    targetTxHash: null,
    targetBlockNumber: null,
    sourcePayloadHash: null,
    targetPayloadHash: null,
    receiptStatus: null,
    errorCode: null,
    message: '',
    data: {}
});

function normalizeDemoEvent(raw = {}, { id, ts } = {}) {
    const normalized = {
        id: id || raw.id || null,
        ts: ts || raw.ts || new Date().toISOString(),
        ...DEFAULTS,
        ...raw
    };

    if (!normalized.id) {
        throw new Error('DemoEvent id is required');
    }

    if (!normalized.ts) {
        normalized.ts = new Date().toISOString();
    }

    if (!normalized.data || typeof normalized.data !== 'object') {
        normalized.data = {};
    }

    return normalized;
}

module.exports = { normalizeDemoEvent };

