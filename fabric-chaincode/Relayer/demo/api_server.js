const { DemoEventStore } = require('./event_store');
const { DemoTriggerService } = require('./trigger_service');
const { buildOrchardValidator, ORCHARD_PAYLOAD_V1_SCHEMA } = require('./payload_schema');
const { createDemoApp } = require('./app/create_demo_app');
const { RelayFacade } = require('./app/relay_facade');
const { QueryBroker } = require('./broker/query_broker');
const { DemoMemoryStore } = require('./store/memory_store');
const { DemoSqliteStore } = require('./store/sqlite_store');
const { QuerySessionService } = require('./session/query_session_service');
const path = require('node:path');

function mapDirectionByChain(sourceChainId, targetChainId) {
    if (sourceChainId === 'FABRIC_NET_01' && targetChainId === 'FISCO_NET_01') {
        return 'FABRIC_TO_FISCO';
    }
    if (sourceChainId === 'FISCO_NET_01' && targetChainId === 'FABRIC_NET_01') {
        return 'FISCO_TO_FABRIC';
    }
    return 'UNKNOWN';
}

function mapErrorCode(errorText) {
    const text = String(errorText || '');
    if (/Source block not verified/i.test(text)) return 'ERR_HEADER_UNVERIFIED';
    if (/MVCC|read conflict/i.test(text)) return 'ERR_MVCC_CONFLICT';
    if (/request timeout|code=TIMEOUT|ETIMEDOUT|timed out/i.test(text)) return 'ERR_CHAIN_TIMEOUT';
    if (/ECONNREFUSED|UNAVAILABLE|connect/i.test(text)) return 'ERR_CHAIN_UNREACHABLE';
    return 'ERR_UNKNOWN';
}

const EXPLORER_CHAIN_IDS = new Set(['FABRIC_NET_01', 'FISCO_NET_01']);
const EXPLORER_DEFAULT_LIMIT = 20;
const EXPLORER_MAX_LIMIT = 50;
const PROOF_DEFAULT_LIMIT = 20;
const PROOF_MAX_LIMIT = 100;
const PROOF_PENDING_TIMEOUT_MS = 180_000;
const QUERY_SESSION_DEFAULT_LIMIT = 20;
const QUERY_SESSION_MAX_LIMIT = 100;
const QUERY_RELAY_TIMEOUT_REQUEST_MS = 60_000;
const QUERY_RELAY_TIMEOUT_RESPONSE_MS = 300_000;
const QUERY_RELAY_POLL_INTERVAL_MS = 1200;

function parseExplorerLimit(rawLimit) {
    if (rawLimit === undefined || rawLimit === null || rawLimit === '') {
        return { value: EXPLORER_DEFAULT_LIMIT, error: null };
    }

    const parsed = Number.parseInt(rawLimit, 10);
    if (Number.isNaN(parsed)) {
        return { value: null, error: `Invalid limit '${rawLimit}', must be integer` };
    }
    if (parsed < 1 || parsed > EXPLORER_MAX_LIMIT) {
        return { value: null, error: `Invalid limit '${rawLimit}', must be between 1 and ${EXPLORER_MAX_LIMIT}` };
    }
    return { value: parsed, error: null };
}

function parseProofCardLimit(rawLimit) {
    if (rawLimit === undefined || rawLimit === null || rawLimit === '') {
        return { value: PROOF_DEFAULT_LIMIT, error: null };
    }

    const parsed = Number.parseInt(rawLimit, 10);
    if (Number.isNaN(parsed)) {
        return { value: null, error: `Invalid limit '${rawLimit}', must be integer` };
    }
    if (parsed < 1 || parsed > PROOF_MAX_LIMIT) {
        return { value: null, error: `Invalid limit '${rawLimit}', must be between 1 and ${PROOF_MAX_LIMIT}` };
    }
    return { value: parsed, error: null };
}

function parseQuerySessionLimit(rawLimit) {
    if (rawLimit === undefined || rawLimit === null || rawLimit === '') {
        return { value: QUERY_SESSION_DEFAULT_LIMIT, error: null };
    }

    const parsed = Number.parseInt(rawLimit, 10);
    if (Number.isNaN(parsed)) {
        return { value: null, error: `Invalid limit '${rawLimit}', must be integer` };
    }
    if (parsed < 1 || parsed > QUERY_SESSION_MAX_LIMIT) {
        return { value: null, error: `Invalid limit '${rawLimit}', must be between 1 and ${QUERY_SESSION_MAX_LIMIT}` };
    }
    return { value: parsed, error: null };
}

class DemoApiServer {
    constructor(relayer, config) {
        this.relayer = relayer;
        this.config = config;
        this.server = null;
        this.eventStore = new DemoEventStore(1000);
        this.triggerService = new DemoTriggerService(config, this.eventStore);
        this.validateOrchardPayload = buildOrchardValidator();
        this.activeTriggers = new Set();
        this.pendingCorrelationBySourceTx = new Map();
        this.pendingCorrelationByPayloadHash = new Map();
        this.PROOF_MAX_LIMIT = PROOF_MAX_LIMIT;
        this.EXPLORER_CHAIN_IDS = EXPLORER_CHAIN_IDS;
        this.activeQuerySessions = new Set();
        this.listeners = [];

        const storeMode = String(process.env.DEMO_STORE || 'memory').toLowerCase();
        this.store = storeMode === 'sqlite'
            ? new DemoSqliteStore({ dbPath: path.join(process.cwd(), '.demo', 'demo.db') })
            : new DemoMemoryStore({ maxSessions: 1000 });
        this.querySessionService = new QuerySessionService(this.store);
        this.relayFacade = new RelayFacade({ eventStore: this.eventStore });
        this.queryBroker = new QueryBroker({
            executeTrigger: this.executeTrigger.bind(this),
            triggerService: this.triggerService,
            relayFacade: this.relayFacade,
            sessionService: this.querySessionService,
            eventStore: this.eventStore,
            activeQuerySessions: this.activeQuerySessions,
            mapSessionErrorCode: this.mapSessionErrorCode.bind(this)
        });

        this.app = createDemoApp(this);
    }

    mapErrorCode(text) {
        return mapErrorCode(text);
    }

    parseExplorerLimit(rawLimit) {
        return parseExplorerLimit(rawLimit);
    }

    parseProofCardLimit(rawLimit) {
        return parseProofCardLimit(rawLimit);
    }

    parseQuerySessionLimit(rawLimit) {
        return parseQuerySessionLimit(rawLimit);
    }

    buildRelayMarkers(limit = 30) {
        const items = this.eventStore.getEvents(limit);
        const normalized = [];

        for (const item of items) {
            if (item.direction !== 'FABRIC_TO_FISCO' && item.direction !== 'FISCO_TO_FABRIC') {
                continue;
            }

            const sourceChainId = item.direction === 'FABRIC_TO_FISCO' ? 'FABRIC_NET_01' : 'FISCO_NET_01';
            const targetChainId = item.direction === 'FABRIC_TO_FISCO' ? 'FISCO_NET_01' : 'FABRIC_NET_01';

            let state = 'RELAYING';
            if (item.relayState === 'SUCCESS') {
                state = 'SUCCESS';
            } else if (item.relayState === 'FAILED') {
                state = 'FAILED';
            }

            const sourceBlockNumber =
                item.data?.sourceBlockNumber ??
                item.data?.blockNumber ??
                item.data?.event?.blockNumber ??
                null;

            normalized.push({
                direction: item.direction,
                sourceChainId,
                sourceBlockNumber,
                targetChainId,
                state,
                ts: item.ts
            });
        }

        return normalized;
    }

    getEventField(item, paths = []) {
        for (const path of paths) {
            const segments = String(path).split('.');
            let cursor = item;
            for (const segment of segments) {
                cursor = cursor?.[segment];
            }
            if (cursor !== undefined && cursor !== null && cursor !== '') {
                return cursor;
            }
        }
        return null;
    }

    resolveCorrelationId(direction, sourceTxHash) {
        if (!sourceTxHash) {
            return null;
        }
        const fromPending = this.pendingCorrelationBySourceTx.get(sourceTxHash);
        if (fromPending) {
            return fromPending;
        }

        const events = this.eventStore.getEvents(2000);
        for (let index = events.length - 1; index >= 0; index -= 1) {
            const item = events[index];
            if (item.direction !== direction) {
                continue;
            }
            const itemSourceTxHash = this.getEventField(item, ['sourceTxHash', 'data.sourceTxHash', 'data.txId', 'data.txHash']);
            if (itemSourceTxHash === sourceTxHash) {
                const correlationId = this.getEventField(item, ['correlationId', 'data.correlationId']);
                if (correlationId) {
                    return correlationId;
                }
            }
        }

        return null;
    }

    resolveCorrelationIdByPayloadHash(direction, sourcePayloadHash) {
        if (!sourcePayloadHash) {
            return null;
        }

        const key = `${direction}:${sourcePayloadHash}`;
        const fromPending = this.pendingCorrelationByPayloadHash.get(key);
        if (fromPending) {
            return fromPending;
        }

        const reverseItems = this.eventStore.getEvents(2000).slice().reverse();
        for (const item of reverseItems) {
            if (item.direction !== direction) {
                continue;
            }
            const payloadHash = this.getEventField(item, ['sourcePayloadHash', 'data.sourcePayloadHash']);
            if (payloadHash && payloadHash === sourcePayloadHash) {
                const correlationId = this.getEventField(item, ['correlationId', 'data.correlationId']);
                if (correlationId) {
                    return correlationId;
                }
            }
        }
        return null;
    }

    createEmptyProofCard(cardId, direction, sourceChainId, targetChainId, requestTs) {
        return {
            cardId,
            direction,
            status: 'PENDING',
            requestTs,
            settleTs: null,
            source: {
                chainId: sourceChainId,
                txHash: null,
                blockNumber: null,
                payloadHash: null,
                payloadPreview: null
            },
            target: {
                chainId: targetChainId,
                txHash: null,
                blockNumber: null,
                payloadHash: null,
                receiptStatus: null
            },
            verify: {
                hashEqual: null,
                blockHeaderVerified: null,
                errorCode: null
            }
        };
    }

    buildProofCards(limit = PROOF_DEFAULT_LIMIT) {
        const allItems = this.eventStore.getEvents(2000);
        const now = Date.now();
        const cardsById = new Map();

        for (const item of allItems) {
            if (item.direction !== 'FABRIC_TO_FISCO' && item.direction !== 'FISCO_TO_FABRIC') {
                continue;
            }
            if (item.relayState === 'HEADER_SYNCED') {
                continue;
            }

            const sourceChainId = item.direction === 'FABRIC_TO_FISCO' ? 'FABRIC_NET_01' : 'FISCO_NET_01';
            const targetChainId = item.direction === 'FABRIC_TO_FISCO' ? 'FISCO_NET_01' : 'FABRIC_NET_01';
            const sourceTxHash = this.getEventField(item, ['sourceTxHash', 'data.sourceTxHash', 'data.txId', 'data.txHash']);
            const correlationId = this.getEventField(item, ['correlationId', 'data.correlationId']) || this.resolveCorrelationId(item.direction, sourceTxHash);
            const sourcePayloadHash = this.getEventField(item, ['sourcePayloadHash', 'data.sourcePayloadHash']);
            const targetPayloadHash = this.getEventField(item, ['targetPayloadHash', 'data.targetPayloadHash']);
            const targetTxHash = this.getEventField(item, ['targetTxHash', 'data.targetTxHash']);
            const receiptStatus = this.getEventField(item, ['receiptStatus', 'data.receiptStatus']);
            const sourceBlockNumber = this.getEventField(item, ['sourceBlockNumber', 'data.sourceBlockNumber', 'data.blockNumber']);
            const targetBlockNumber = this.getEventField(item, ['targetBlockNumber', 'data.targetBlockNumber']);
            const hasEvidence =
                sourceTxHash ||
                correlationId ||
                sourcePayloadHash ||
                targetPayloadHash ||
                targetTxHash ||
                receiptStatus;

            if (!hasEvidence) {
                continue;
            }

            const cardId = correlationId || sourceTxHash || `${item.direction}_${item.id}`;

            if (!cardsById.has(cardId)) {
                cardsById.set(cardId, this.createEmptyProofCard(cardId, item.direction, sourceChainId, targetChainId, item.ts));
            }
            const card = cardsById.get(cardId);

            if (item.ts && (!card.requestTs || item.ts < card.requestTs)) {
                card.requestTs = item.ts;
            }

            card.source.txHash = sourceTxHash || card.source.txHash;
            card.source.blockNumber = sourceBlockNumber ?? card.source.blockNumber;
            card.source.payloadHash = sourcePayloadHash || card.source.payloadHash;
            card.source.payloadPreview = this.getEventField(item, ['data.payloadPreview']) || card.source.payloadPreview;

            card.target.txHash = targetTxHash || card.target.txHash;
            card.target.blockNumber = targetBlockNumber ?? card.target.blockNumber;
            card.target.payloadHash = targetPayloadHash || card.target.payloadHash;
            card.target.receiptStatus = receiptStatus || card.target.receiptStatus;

            const errorCode = this.getEventField(item, ['errorCode', 'data.errorCode']);
            if (errorCode) {
                card.verify.errorCode = errorCode;
            }

            if (item.relayState === 'FAILED' || item.level === 'error') {
                card.status = 'FAILED';
                card.settleTs = item.ts;
            } else if (item.relayState === 'SUCCESS') {
                card.settleTs = item.ts;
            }
        }

        const cards = Array.from(cardsById.values()).map((card) => {
            if (card.status === 'FAILED') {
                card.verify.blockHeaderVerified = card.verify.errorCode === 'ERR_HEADER_UNVERIFIED' ? false : null;
                return card;
            }

            const sourcePayloadHash = card.source.payloadHash;
            const targetPayloadHash = card.target.payloadHash;
            const receiptSuccess = String(card.target.receiptStatus || '').toUpperCase() === 'SUCCESS';

            if (sourcePayloadHash && targetPayloadHash) {
                card.verify.hashEqual = sourcePayloadHash === targetPayloadHash;
                if (card.verify.hashEqual && receiptSuccess) {
                    card.status = 'PASS';
                    card.verify.blockHeaderVerified = true;
                } else {
                    card.status = 'MISMATCH';
                    card.verify.errorCode = card.verify.errorCode || 'ERR_MISMATCH';
                    card.verify.blockHeaderVerified = false;
                }
                return card;
            }

            if (sourcePayloadHash && receiptSuccess) {
                card.status = 'PASS';
                card.verify.hashEqual = null;
                card.verify.blockHeaderVerified = true;
                return card;
            }

            const createdAt = Date.parse(card.requestTs || '');
            const ageMs = Number.isNaN(createdAt) ? 0 : Math.max(0, now - createdAt);
            if (ageMs > PROOF_PENDING_TIMEOUT_MS) {
                card.status = 'FAILED';
                card.verify.errorCode = card.verify.errorCode || 'ERR_QUERY_TIMEOUT';
                card.settleTs = card.settleTs || new Date().toISOString();
            } else {
                card.status = 'PENDING';
            }

            return card;
        });

        cards.sort((lhs, rhs) => {
            const left = Date.parse(lhs.requestTs || lhs.settleTs || 0);
            const right = Date.parse(rhs.requestTs || rhs.settleTs || 0);
            return right - left;
        });

        return cards.slice(0, limit);
    }

    bindRelayerEvents() {
        const onBlockRelayed = (data) => {
            this.eventStore.addEvent({
                type: 'relay',
                direction: data.sourceChainId === 'FABRIC_NET_01' ? 'FABRIC_TO_FISCO' : 'FISCO_TO_FABRIC',
                relayState: 'HEADER_SYNCED',
                message: `Block relayed: ${data.sourceChainId} #${data.blockNumber}`,
                sourceBlockNumber: data.blockNumber ?? null,
                data
            });
        };
        const onMessageRelayed = (data) => {
            const direction = mapDirectionByChain(data.from, data.to);
            const sourceTxHash = data.txHash || data.sourceTxHash || null;
            const sourcePayloadHash = data.sourcePayloadHash || null;
            let correlationId = data.correlationId || this.resolveCorrelationId(direction, sourceTxHash);
            if (!correlationId && sourcePayloadHash) {
                correlationId = this.resolveCorrelationIdByPayloadHash(direction, sourcePayloadHash);
            }
            if (correlationId && sourceTxHash) {
                this.pendingCorrelationBySourceTx.set(sourceTxHash, correlationId);
            }
            if (correlationId && sourcePayloadHash) {
                this.pendingCorrelationByPayloadHash.set(`${direction}:${sourcePayloadHash}`, correlationId);
            }
            this.eventStore.addEvent({
                type: 'relay',
                direction,
                relayState: 'SUCCESS',
                message: `Message relayed: ${data.from} -> ${data.to}`,
                correlationId,
                sourceTxHash,
                sourceBlockNumber: data.sourceBlockNumber ?? null,
                sourcePayloadHash,
                targetPayloadHash: data.targetPayloadHash || null,
                targetTxHash: data.targetTxHash || null,
                targetBlockNumber: data.targetBlockNumber ?? null,
                receiptStatus: data.receiptStatus || null,
                data
            });
            if (sourceTxHash) {
                this.pendingCorrelationBySourceTx.delete(sourceTxHash);
            }
            if (sourcePayloadHash) {
                this.pendingCorrelationByPayloadHash.delete(`${direction}:${sourcePayloadHash}`);
            }

            this.queryBroker.reconcileByRelaySuccess({
                direction,
                sourceTxHash,
                correlationId,
                targetTxHash: data.targetTxHash || null,
                targetBlockNumber: data.targetBlockNumber ?? null,
                targetPayloadHash: data.targetPayloadHash || null,
                receiptStatus: data.receiptStatus || null
            });
        };
        const onError = (data) => {
            const direction = mapDirectionByChain(data.sourceChainId, data.event?.targetChainId);
            const sourceTxHash = data.event?.txHash || null;
            const sourcePayloadHash = data.sourcePayloadHash || null;
            let correlationId = this.resolveCorrelationId(direction, sourceTxHash);
            if (!correlationId && sourcePayloadHash) {
                correlationId = this.resolveCorrelationIdByPayloadHash(direction, sourcePayloadHash);
            }
            this.eventStore.addEvent({
                level: 'error',
                type: 'relay',
                direction,
                relayState: 'FAILED',
                errorCode: mapErrorCode(data.error?.message),
                message: data.error?.message || 'Relayer error',
                correlationId,
                sourceTxHash,
                sourceBlockNumber: data.event?.blockNumber ?? null,
                sourcePayloadHash,
                data: {
                    sourceChainId: data.sourceChainId || null,
                    targetChainId: data.event?.targetChainId || null,
                    sourceTxHash,
                    sourceBlockNumber: data.event?.blockNumber ?? null
                }
            });
            if (sourceTxHash) {
                this.pendingCorrelationBySourceTx.delete(sourceTxHash);
            }
            if (sourcePayloadHash) {
                this.pendingCorrelationByPayloadHash.delete(`${direction}:${sourcePayloadHash}`);
            }
        };

        this.relayer.on('blockRelayed', onBlockRelayed);
        this.relayer.on('messageRelayed', onMessageRelayed);
        this.relayer.on('error', onError);

        this.listeners = [
            ['blockRelayed', onBlockRelayed],
            ['messageRelayed', onMessageRelayed],
            ['error', onError]
        ];
    }

    unbindRelayerEvents() {
        for (const [eventName, fn] of this.listeners) {
            this.relayer.off(eventName, fn);
        }
        this.listeners = [];
    }

    reconcileQuerySessionByRelaySuccess({
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

        for (const queryId of this.querySessionOrder) {
            const session = this.querySessions.get(queryId);
            if (!session) {
                continue;
            }

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

            const finalReceiptStatus = receiptStatus || session.receiptStatus || 'SUCCESS';
            this.patchQuerySession(queryId, {
                status: 'COMPLETED',
                verifyStatus: 'PASS',
                responseTargetTxHash: targetTxHash || session.responseTargetTxHash || null,
                responsePayloadHash: targetPayloadHash || session.responsePayloadHash || null,
                receiptStatus: finalReceiptStatus,
                settleTs: new Date().toISOString(),
                errorCode: null,
                errorMessage: null,
                updatedAt: new Date().toISOString()
            });

            this.appendQueryStep(queryId, 'COMPLETED', {
                targetTxHash: targetTxHash || null,
                targetBlockNumber: targetBlockNumber ?? null,
                receiptStatus: finalReceiptStatus,
                recoveredFromTimeout: shouldRecoverFromTimeout
            });

            this.activeQuerySessions.delete(queryId);

            this.eventStore.addEvent({
                type: 'query',
                direction: 'FABRIC_TO_FISCO',
                relayState: 'SUCCESS',
                correlationId: queryId,
                sourceTxHash: session.responseRequestTxHash || sourceTxHash || null,
                targetTxHash: targetTxHash || null,
                targetBlockNumber: targetBlockNumber ?? null,
                receiptStatus: finalReceiptStatus,
                message: shouldRecoverFromTimeout
                    ? `Query session ${queryId} recovered from timeout by late relay success`
                    : `Query session ${queryId} completed by relay callback`,
                data: {
                    queryId,
                    orchardBatchId: session.orchardBatchId,
                    recoveredFromTimeout: shouldRecoverFromTimeout
                }
            });
        }
    }

    normalizeRequestPayload(body = {}) {
        const payloadMode = body.payloadMode || (body.payloadVersion ? 'orchard-v1' : 'raw-json');
        const payload = body.payload !== undefined ? body.payload : body;

        if (payloadMode === 'orchard-v1') {
            const orchardPayload = payload.payloadVersion ? payload : {
                payloadVersion: body.payloadVersion,
                orchardBatchId: body.orchardBatchId,
                eventType: body.eventType,
                eventAt: body.eventAt,
                data: body.data,
                sourceSystem: body.sourceSystem,
                metadata: body.metadata
            };
            const validation = this.validateOrchardPayload(orchardPayload);
            if (!validation.valid) {
                const err = new Error('OrchardPayloadV1 validation failed');
                err.statusCode = 400;
                err.details = validation.errors;
                throw err;
            }
            return orchardPayload;
        }

        if (typeof payload === 'string') {
            return payload;
        }
        if (payload && typeof payload === 'object' && Object.keys(payload).length > 0) {
            return payload;
        }
        return {
            message: 'Demo payload',
            timestamp: Date.now()
        };
    }

    async executeTrigger(direction, runner) {
        if (this.activeTriggers.has(direction)) {
            const err = new Error(`${direction} trigger is already running`);
            err.statusCode = 409;
            throw err;
        }

        this.activeTriggers.add(direction);
        try {
            this.eventStore.addEvent({
                type: 'trigger',
                direction,
                relayState: 'RELAYING',
                message: `${direction} relay pipeline started`
            });
            const result = await runner();
            const sourceTxHash = result?.txId || result?.txHash || null;
            const sourcePayloadHash = result?.sourcePayloadHash || null;
            if (result?.correlationId && sourceTxHash) {
                this.pendingCorrelationBySourceTx.set(sourceTxHash, result.correlationId);
            }
            if (result?.correlationId && sourcePayloadHash) {
                this.pendingCorrelationByPayloadHash.set(`${direction}:${sourcePayloadHash}`, result.correlationId);
            }
            return result;
        } finally {
            this.activeTriggers.delete(direction);
        }
    }

    normalizeBatchId(rawBatchId) {
        const value = String(rawBatchId || '').trim();
        if (!value) {
            const err = new Error('orchardBatchId is required');
            err.statusCode = 400;
            throw err;
        }
        return value;
    }

    createQueryId() {
        const rand = Math.random().toString(16).slice(2, 10);
        return `query_${Date.now()}_${rand}`;
    }

    saveQuerySession(session) {
        return this.store.saveQuerySession(session);
    }

    getQuerySession(queryId) {
        return this.store.getQuerySession(queryId);
    }

    listQuerySessions(limit = QUERY_SESSION_DEFAULT_LIMIT) {
        return this.store.listQuerySessions(limit);
    }

    patchQuerySession(queryId, patch = {}) {
        return this.querySessionService.patch(queryId, patch);
    }

    appendQueryStep(queryId, step, details = {}) {
        return this.querySessionService.appendStep(queryId, step, details);
    }

    findRelayEvent(direction, { sourceTxHash, correlationId }) {
        const items = this.eventStore.getEvents(2000).slice().reverse();
        for (const item of items) {
            if (item.direction !== direction) {
                continue;
            }
            if (item.relayState !== 'SUCCESS' && item.relayState !== 'FAILED') {
                continue;
            }
            const itemSourceTxHash = this.getEventField(item, ['sourceTxHash', 'data.sourceTxHash', 'data.txId', 'data.txHash']);
            const itemCorrelationId = this.getEventField(item, ['correlationId', 'data.correlationId']);

            if (sourceTxHash && itemSourceTxHash === sourceTxHash) {
                return item;
            }
            if (correlationId && itemCorrelationId === correlationId) {
                return item;
            }
        }
        return null;
    }

    async waitForRelayEvent(direction, lookup, timeoutMs = QUERY_RELAY_TIMEOUT_REQUEST_MS) {
        return this.relayFacade.waitForRelayEvent(
            direction,
            lookup || {},
            timeoutMs,
            Number(process.env.DEMO_QUERY_RELAY_POLL_INTERVAL_MS) || QUERY_RELAY_POLL_INTERVAL_MS
        );
    }

    mapSessionErrorCode(error) {
        if (error?.code === 'ERR_QUERY_TIMEOUT') {
            return 'ERR_QUERY_TIMEOUT';
        }
        return mapErrorCode(error?.message || '');
    }

    async runQuerySession(queryId) {
        const session = this.querySessions.get(queryId);
        if (!session) {
            return;
        }

        try {
            const requestResult = await this.executeTrigger('FISCO_TO_FABRIC', async () => {
                return this.triggerService.triggerOrchardQueryRequest(queryId, session.orchardBatchId);
            });

            this.patchQuerySession(queryId, {
                status: 'REQUEST_SENT',
                requestCorrelationId: requestResult?.correlationId || null,
                requestTxHash: requestResult?.txHash || null,
                requestPayloadHash: requestResult?.sourcePayloadHash || null,
                updatedAt: new Date().toISOString()
            });
            this.appendQueryStep(queryId, 'REQUEST_SENT', {
                txHash: requestResult?.txHash || null,
                correlationId: requestResult?.correlationId || null
            });

            const requestRelayEvent = await this.waitForRelayEvent(
                'FISCO_TO_FABRIC',
                {
                    sourceTxHash: requestResult?.txHash || null,
                    correlationId: requestResult?.correlationId || null
                },
                QUERY_RELAY_TIMEOUT_REQUEST_MS
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

            this.patchQuerySession(queryId, {
                status: 'A_CHAIN_FETCHED',
                resultFound: found,
                resultPayload: orchardRecord,
                updatedAt: new Date().toISOString()
            });
            this.appendQueryStep(queryId, 'A_CHAIN_FETCHED', {
                found
            });

            const responseResult = await this.executeTrigger('FABRIC_TO_FISCO', async () => {
                return this.triggerService.triggerOrchardQueryResponse({
                    queryId,
                    orchardBatchId: session.orchardBatchId,
                    found,
                    result: orchardRecord
                });
            });

            this.patchQuerySession(queryId, {
                status: 'RESPONSE_SENT',
                responseCorrelationId: responseResult?.correlationId || null,
                responseRequestTxHash: responseResult?.txId || null,
                responsePayloadHash: responseResult?.sourcePayloadHash || null,
                updatedAt: new Date().toISOString()
            });
            this.appendQueryStep(queryId, 'RESPONSE_SENT', {
                txHash: responseResult?.txId || null,
                correlationId: responseResult?.correlationId || null
            });

            const responseRelayEvent = await this.waitForRelayEvent(
                'FABRIC_TO_FISCO',
                {
                    sourceTxHash: responseResult?.txId || null,
                    correlationId: responseResult?.correlationId || null
                },
                QUERY_RELAY_TIMEOUT_RESPONSE_MS
            );
            if (responseRelayEvent.relayState === 'FAILED') {
                throw new Error(responseRelayEvent.message || 'Response relay failed');
            }

            const targetTxHash = this.getEventField(responseRelayEvent, ['targetTxHash', 'data.targetTxHash']);
            const receiptStatus = this.getEventField(responseRelayEvent, ['receiptStatus', 'data.receiptStatus']) || 'SUCCESS';

            this.patchQuerySession(queryId, {
                status: 'COMPLETED',
                responseTargetTxHash: targetTxHash || null,
                receiptStatus,
                verifyStatus: 'PASS',
                settleTs: new Date().toISOString(),
                errorCode: null,
                errorMessage: null,
                updatedAt: new Date().toISOString()
            });
            this.appendQueryStep(queryId, 'COMPLETED', {
                targetTxHash: targetTxHash || null,
                receiptStatus
            });
        } catch (error) {
            const errorCode = this.mapSessionErrorCode(error);
            this.patchQuerySession(queryId, {
                status: 'FAILED',
                verifyStatus: 'FAILED',
                errorCode,
                errorMessage: error?.message || String(error),
                settleTs: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            });
            this.appendQueryStep(queryId, 'FAILED', {
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

    createRoutes() {
        this.app.use(express.json({ limit: '2mb' }));

        this.app.get('/health', (_req, res) => {
            res.json({
                status: 'ok',
                service: 'crosschain-relayer-demo-api',
                ts: new Date().toISOString()
            });
        });

        this.app.get('/status', (_req, res) => {
            res.json(this.relayer.getStatus());
        });

        this.app.get('/demo/schema/orchard-v1', (_req, res) => {
            res.json(ORCHARD_PAYLOAD_V1_SCHEMA);
        });

        this.app.get('/demo/app/orchard', async (req, res) => {
            try {
                const parsedLimit = parseExplorerLimit(req.query.limit);
                if (parsedLimit.error) {
                    return res.status(400).json({
                        success: false,
                        error: parsedLimit.error
                    });
                }
                const bookmark = String(req.query.bookmark || '');
                const result = await this.triggerService.listOrchardRecords(parsedLimit.value, bookmark);
                return res.json({
                    success: true,
                    ...result
                });
            } catch (error) {
                return res.status(500).json({
                    success: false,
                    error: error.message || 'Failed to list orchard records'
                });
            }
        });

        this.app.get('/demo/app/orchard/:batchId', async (req, res) => {
            try {
                const batchId = this.normalizeBatchId(req.params.batchId);
                const record = await this.triggerService.getOrchardRecord(batchId);
                return res.json({
                    success: true,
                    orchardBatchId: batchId,
                    record
                });
            } catch (error) {
                const message = String(error?.message || '');
                const statusCode = /not found/i.test(message) ? 404 : 500;
                return res.status(statusCode).json({
                    success: false,
                    error: message || 'Failed to query orchard record'
                });
            }
        });

        this.app.post('/demo/app/orchard/upsert', async (req, res) => {
            try {
                const body = req.body || {};
                const batchId = this.normalizeBatchId(body.orchardBatchId || body.payload?.orchardBatchId);
                const rawPayload = (body.payload && typeof body.payload === 'object') ? body.payload : body;
                const payload = {
                    payloadVersion: String(rawPayload.payloadVersion || '1.0'),
                    orchardBatchId: batchId,
                    eventType: String(rawPayload.eventType || 'unknown'),
                    eventAt: rawPayload.eventAt || new Date().toISOString(),
                    sourceSystem: rawPayload.sourceSystem || 'orchard-demo',
                    data: rawPayload.data && typeof rawPayload.data === 'object' ? rawPayload.data : {}
                };

                const validation = this.validateOrchardPayload(payload);
                if (!validation.valid) {
                    return res.status(400).json({
                        success: false,
                        error: 'OrchardPayloadV1 validation failed',
                        details: validation.errors
                    });
                }

                const txId = await this.triggerService.putOrchardRecord(batchId, payload);
                return res.json({
                    success: true,
                    orchardBatchId: batchId,
                    txId
                });
            } catch (error) {
                return res.status(500).json({
                    success: false,
                    error: error.message || 'Failed to upsert orchard record'
                });
            }
        });

        this.app.post('/demo/app/query/request', async (req, res) => {
            try {
                const batchId = this.normalizeBatchId(req.body?.orchardBatchId);
                const queryId = this.createQueryId();
                const now = new Date().toISOString();

                const session = {
                    queryId,
                    orchardBatchId: batchId,
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
                    updatedAt: now,
                    steps: [{
                        ts: now,
                        step: 'REQUEST_SENT',
                        details: { orchardBatchId: batchId }
                    }]
                };

                this.saveQuerySession(session);
                this.activeQuerySessions.add(queryId);
                this.eventStore.addEvent({
                    type: 'query',
                    direction: 'FISCO_TO_FABRIC',
                    relayState: 'REQUEST_SENT',
                    correlationId: queryId,
                    message: `Query request created for ${batchId}`,
                    data: {
                        queryId,
                        orchardBatchId: batchId
                    }
                });

                this.runQuerySession(queryId).catch((error) => {
                    this.eventStore.addEvent({
                        level: 'error',
                        type: 'query',
                        direction: 'FISCO_TO_FABRIC',
                        relayState: 'FAILED',
                        correlationId: queryId,
                        errorCode: this.mapSessionErrorCode(error),
                        message: error.message || String(error),
                        data: {
                            queryId,
                            orchardBatchId: batchId
                        }
                    });
                });

                return res.status(202).json({
                    success: true,
                    queryId,
                    session: this.getQuerySession(queryId)
                });
            } catch (error) {
                const statusCode = error.statusCode || 500;
                return res.status(statusCode).json({
                    success: false,
                    error: error.message || 'Failed to create query session'
                });
            }
        });

        this.app.get('/demo/app/query/sessions', (req, res) => {
            const parsedLimit = parseQuerySessionLimit(req.query.limit);
            if (parsedLimit.error) {
                return res.status(400).json({
                    success: false,
                    error: parsedLimit.error
                });
            }
            return res.json({
                items: this.listQuerySessions(parsedLimit.value),
                updatedAt: new Date().toISOString()
            });
        });

        this.app.get('/demo/app/query/sessions/:queryId', (req, res) => {
            const queryId = String(req.params.queryId || '');
            const session = this.getQuerySession(queryId);
            if (!session) {
                return res.status(404).json({
                    success: false,
                    error: `Query session '${queryId}' not found`
                });
            }
            return res.json({
                item: session,
                updatedAt: new Date().toISOString()
            });
        });

        this.app.get('/demo/status', (_req, res) => {
            res.json({
                relayer: this.relayer.getStatus(),
                activeTriggers: Array.from(this.activeTriggers),
                activeQuerySessions: Array.from(this.activeQuerySessions),
                sseClients: this.eventStore.getClientCount(),
                recentEvents: this.eventStore.getEvents(20),
                windowsAccess: {
                    preferred: 'http://localhost:15173',
                    fallbackCandidates: getWslIpCandidates().map((ip) => `http://${ip}:15173`)
                }
            });
        });

        this.app.get('/demo/events', (req, res) => {
            const limit = Number.parseInt(req.query.limit, 10);
            res.json({
                items: this.eventStore.getEvents(Number.isNaN(limit) ? 200 : limit)
            });
        });

        this.app.get('/demo/app/proof-cards', (req, res) => {
            const parsedLimit = parseProofCardLimit(req.query.limit);
            if (parsedLimit.error) {
                return res.status(400).json({
                    success: false,
                    error: parsedLimit.error
                });
            }
            const items = this.buildProofCards(parsedLimit.value);
            return res.json({
                items,
                updatedAt: new Date().toISOString()
            });
        });

        this.app.get('/demo/app/proof-cards/:cardId', (req, res) => {
            const cardId = String(req.params.cardId || '');
            const cards = this.buildProofCards(PROOF_MAX_LIMIT);
            const item = cards.find((card) => card.cardId === cardId);
            if (!item) {
                return res.status(404).json({
                    success: false,
                    error: `Proof card '${cardId}' not found`
                });
            }
            return res.json({
                item,
                updatedAt: new Date().toISOString()
            });
        });

        this.app.get('/demo/explorer/overview', async (_req, res) => {
            try {
                const overview = await this.relayer.getExplorerOverview();
                res.json({
                    chains: overview?.chains || [],
                    recentRelayMarkers: this.buildRelayMarkers(120),
                    updatedAt: new Date().toISOString()
                });
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: error.message || 'Failed to query explorer overview'
                });
            }
        });

        this.app.get('/demo/explorer/blocks', async (req, res) => {
            const chainId = String(req.query.chainId || '').trim();
            if (!EXPLORER_CHAIN_IDS.has(chainId)) {
                return res.status(400).json({
                    success: false,
                    error: `Invalid chainId '${chainId}'`,
                    allowedChainIds: Array.from(EXPLORER_CHAIN_IDS)
                });
            }

            const parsedLimit = parseExplorerLimit(req.query.limit);
            if (parsedLimit.error) {
                return res.status(400).json({
                    success: false,
                    error: parsedLimit.error
                });
            }
            const limit = parsedLimit.value;

            const monitor = this.relayer.getMonitor(chainId);
            if (!monitor) {
                return res.status(404).json({
                    success: false,
                    error: `Monitor for chain '${chainId}' is unavailable`
                });
            }

            if (typeof monitor.getRecentBlocks !== 'function') {
                return res.status(500).json({
                    success: false,
                    error: `Chain '${chainId}' does not support explorer blocks`
                });
            }

            try {
                const items = await monitor.getRecentBlocks(limit);
                return res.json({
                    chainId,
                    limit,
                    items: Array.isArray(items) ? items : [],
                    updatedAt: new Date().toISOString()
                });
            } catch (error) {
                return res.status(500).json({
                    success: false,
                    error: error.message || 'Failed to fetch explorer blocks'
                });
            }
        });

        this.app.get('/demo/stream', (req, res) => {
            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                Connection: 'keep-alive'
            });
            res.write('retry: 2000\n\n');

            this.eventStore.attachClient(res);
            const timer = setInterval(() => {
                res.write(`event: ping\ndata: ${Date.now()}\n\n`);
            }, 15_000);

            req.on('close', () => {
                clearInterval(timer);
                this.eventStore.detachClient(res);
            });
        });

        this.app.post('/demo/trigger/fabric-to-fisco', async (req, res) => {
            try {
                const payload = this.normalizeRequestPayload(req.body || {});
                const result = await this.executeTrigger('FABRIC_TO_FISCO', async () => {
                    return this.triggerService.triggerFabricToFisco(payload);
                });
                res.json(result);
            } catch (error) {
                const statusCode = error.statusCode || 500;
                const errorCode = mapErrorCode(error.message);
                this.eventStore.addEvent({
                    level: 'error',
                    type: 'trigger',
                    direction: 'FABRIC_TO_FISCO',
                    relayState: 'FAILED',
                    errorCode,
                    message: error.message,
                    data: { details: error.details || [] }
                });
                res.status(statusCode).json({
                    success: false,
                    error: error.message,
                    errorCode,
                    details: error.details || []
                });
            }
        });

        this.app.post('/demo/trigger/fisco-to-fabric', async (req, res) => {
            try {
                const payload = this.normalizeRequestPayload(req.body || {});
                const result = await this.executeTrigger('FISCO_TO_FABRIC', async () => {
                    return this.triggerService.triggerFiscoToFabric(payload);
                });
                res.json(result);
            } catch (error) {
                const statusCode = error.statusCode || 500;
                const errorCode = mapErrorCode(error.message);
                this.eventStore.addEvent({
                    level: 'error',
                    type: 'trigger',
                    direction: 'FISCO_TO_FABRIC',
                    relayState: 'FAILED',
                    errorCode,
                    message: error.message,
                    data: { details: error.details || [] }
                });
                res.status(statusCode).json({
                    success: false,
                    error: error.message,
                    errorCode,
                    details: error.details || []
                });
            }
        });
    }

    async start(host, port) {
        this.bindRelayerEvents();
        await new Promise((resolve) => {
            this.server = this.app.listen(port, host, resolve);
        });
    }

    async stop() {
        this.unbindRelayerEvents();
        if (this.server) {
            await new Promise((resolve) => this.server.close(resolve));
            this.server = null;
        }
    }
}

module.exports = { DemoApiServer };
