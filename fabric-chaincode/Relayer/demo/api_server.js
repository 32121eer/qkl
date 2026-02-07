const express = require('express');
const os = require('node:os');
const { DemoEventStore } = require('./event_store');
const { DemoTriggerService } = require('./trigger_service');
const { buildOrchardValidator, ORCHARD_PAYLOAD_V1_SCHEMA } = require('./payload_schema');

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

function getWslIpCandidates() {
    const interfaces = os.networkInterfaces();
    const result = [];
    for (const records of Object.values(interfaces)) {
        for (const record of records || []) {
            if (record.family === 'IPv4' && !record.internal) {
                result.push(record.address);
            }
        }
    }
    return result;
}

const EXPLORER_CHAIN_IDS = new Set(['FABRIC_NET_01', 'FISCO_NET_01']);
const EXPLORER_DEFAULT_LIMIT = 20;
const EXPLORER_MAX_LIMIT = 50;
const PROOF_DEFAULT_LIMIT = 20;
const PROOF_MAX_LIMIT = 100;
const PROOF_PENDING_TIMEOUT_MS = 180_000;

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

class DemoApiServer {
    constructor(relayer, config) {
        this.relayer = relayer;
        this.config = config;
        this.app = express();
        this.server = null;
        this.eventStore = new DemoEventStore(1000);
        this.triggerService = new DemoTriggerService(config, this.eventStore);
        this.validateOrchardPayload = buildOrchardValidator();
        this.activeTriggers = new Set();
        this.pendingCorrelationBySourceTx = new Map();
        this.pendingCorrelationByPayloadHash = new Map();
        this.listeners = [];
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

        this.app.get('/demo/status', (_req, res) => {
            res.json({
                relayer: this.relayer.getStatus(),
                activeTriggers: Array.from(this.activeTriggers),
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
        this.createRoutes();
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
