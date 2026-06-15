/**
 * 閾句笅涓户缃戠粶鏈嶅姟 (Off-Chain Relay Network)
 * 璐熻矗锛? * 1. 鐩戝惉鍚勬潯閾剧殑鏂板尯鍧? * 2. 鎻愬彇鏍囧噯鍖栧尯鍧楀ご
 * 3. 灏嗗尯鍧楀ご鎻愪氦鍒板叾浠栭摼鐨凩ightClient鍚堢害
 * 4. 鐩戝惉璺ㄩ摼浜嬩欢骞朵紶閫掓秷鎭? */

const EventEmitter = require('events');
const { FiscoBcosMonitor } = require('./monitors/fisco_bcos_monitor');
const FabricMonitor = require('./monitors/fabric_monitor');
const { BlockHeaderExtractor } = require('./extractors/block_header_extractor');
const { MessageHandler } = require('./handlers/message_handler');

class RelayerService extends EventEmitter {
    constructor(config) {
        super();
        this.config = config;
        this.monitors = new Map();
        this.isRunning = false;
        this.headerSyncQueueByPath = new Map();
        this.crossChainEventQueues = new Map(); // sourceChainId -> Promise chain for serialization
        this.recentTxHashes = new Set(); // short-lived dedup cache for crossChainEvents
        this._txHashCleanupTimer = setInterval(() => this.recentTxHashes.clear(), 5 * 60 * 1000);
        this.enableHeaderBroadcastOnNewBlock = Boolean(
            this.config?.relayer?.enableHeaderBroadcastOnNewBlock
        );
        this.headerSubmitMaxRetries = Number(this.config?.relayer?.headerSubmitMaxRetries ?? 3);
        this.headerSubmitRetryDelayMs = Number(this.config?.relayer?.headerSubmitRetryDelayMs ?? 1200);
        
        // Initialize core components
        this.extractor = new BlockHeaderExtractor();
        this.messageHandler = new MessageHandler(config);
    }
    
    /**
     * 鍒濆鍖栦腑缁ф湇鍔?     */
    async initialize() {
        console.log('[Relayer] Initializing relay service...');
        
        // 鍒濆鍖栧悇閾剧洃鍚櫒
        for (const chainConfig of this.config.chains) {
            await this.initializeMonitor(chainConfig);
        }
        
        console.log('[Relayer] Initialization complete');
    }
    
    /**
     * 鍒濆鍖栭摼鐩戝惉鍣?     */
    async initializeMonitor(chainConfig) {
        let monitor;
        
        switch (chainConfig.type) {
            case 'FISCO_BCOS':
                monitor = new FiscoBcosMonitor(chainConfig);
                break;
            case 'FABRIC':
                monitor = new FabricMonitor(chainConfig);
                break;
            default:
                throw new Error(`Unsupported chain type: ${chainConfig.type}`);
        }
        
        // Listen to new blocks
        monitor.on('newBlock', async (block) => {
            await this.handleNewBlock(chainConfig.chainId, block);
        });
        
        // 鐩戝惉璺ㄩ摼浜嬩欢 - 鎸夋簮閾句覆琛屾帓闃熷鐞嗭紝閬垮厤骞跺彂鎵撶垎 Fabric peer
        monitor.on('crossChainEvent', (event) => {
            const chainId = chainConfig.chainId;
            if (this.recentTxHashes.has(event.txHash)) {
                console.log(`[Relayer] Skipping duplicate crossChainEvent from ${chainId}: ${event.txHash}`);
                return;
            }
            this.recentTxHashes.add(event.txHash);
            const prev = this.crossChainEventQueues.get(chainId) || Promise.resolve();
            const next = prev.then(() => this.handleCrossChainEvent(chainId, event)).catch(() => {});
            this.crossChainEventQueues.set(chainId, next);
        });
        
        await monitor.initialize();
        this.monitors.set(chainConfig.chainId, monitor);
        
        console.log(`[Relayer] Initialized monitor for ${chainConfig.chainId}`);
    }
    
    /**
     * 处理新区块：通过 submitSequentialHeaders 补齐目标链 LightClient 的块头缺口
     */
    async handleNewBlock(sourceChainId, block) {
        try {
            console.log(`[Relayer] New block from ${sourceChainId}: #${block.number}`);
            if (!this.enableHeaderBroadcastOnNewBlock) {
                return;
            }

            const blockNumber = Number(block?.number);
            if (!Number.isInteger(blockNumber) || blockNumber < 0) {
                return;
            }

            // 对每条目标链异步触发顺序补头（内部队列保证不会并发乱序）
            for (const [targetChainId] of this.monitors.entries()) {
                if (targetChainId === sourceChainId) continue;
                this.submitSequentialHeaders(sourceChainId, targetChainId, blockNumber).catch((err) => {
                    console.error(`[Relayer] Header sync error (${sourceChainId}->${targetChainId}): ${err.message}`);
                });
            }

            this.emit('blockRelayed', {
                sourceChainId,
                blockNumber,
                targetsCount: this.monitors.size - 1
            });

        } catch (error) {
            console.error(`[Relayer] Error handling block from ${sourceChainId}:`, error);
            this.emit('error', { sourceChainId, error });
        }
    }
    
    /**
     * 骞挎挱鍖哄潡澶村埌鍏朵粬閾?     */
    async broadcastBlockHeader(sourceChainId, blockHeader) {
        const promises = [];
        
        for (const [chainId, monitor] of this.monitors.entries()) {
            // 涓嶅彂閫佺粰鑷繁
            if (chainId === sourceChainId) {
                continue;
            }
            
            promises.push(
                this.submitBlockHeaderToChain(chainId, blockHeader)
                    .catch(err => {
                        console.error(`[Relayer] Failed to submit header to ${chainId}:`, err);
                    })
            );
        }
        
        await Promise.all(promises);
    }
    
    /**
     * 鎻愪氦鍖哄潡澶村埌鐩爣閾?     */
    async submitBlockHeaderToChain(targetChainId, blockHeader) {
        const monitor = this.monitors.get(targetChainId);
        if (!monitor) {
            throw new Error(`Monitor not found for ${targetChainId}`);
        }
        
        console.log(`[Relayer] Submitting ${blockHeader.chainId} block #${blockHeader.blockNumber} to ${targetChainId}`);
        
        return await monitor.submitBlockHeader(blockHeader);
    }

    isTransientHeaderSubmitError(error) {
        if (!error) {
            return false;
        }
        const text = String(error?.message || error).toLowerCase();
        return (
            text.includes('timeout') ||
            text.includes('etimedout') ||
            text.includes('request timeout') ||
            text.includes('socket hang up') ||
            text.includes('econnreset') ||
            text.includes('connection reset') ||
            text.includes('econnrefused') ||
            text.includes('temporarily unavailable')
        );
    }

    async sleep(ms) {
        await new Promise(resolve => setTimeout(resolve, ms));
    }

    async submitBlockHeaderWithRetry(targetChainId, blockHeader) {
        const maxAttempts = Number.isFinite(this.headerSubmitMaxRetries) && this.headerSubmitMaxRetries > 0
            ? this.headerSubmitMaxRetries
            : 1;
        const baseDelay = Number.isFinite(this.headerSubmitRetryDelayMs) && this.headerSubmitRetryDelayMs > 0
            ? this.headerSubmitRetryDelayMs
            : 1000;

        let lastError = null;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                return await this.submitBlockHeaderToChain(targetChainId, blockHeader);
            } catch (error) {
                lastError = error;
                const isRetryable = this.isTransientHeaderSubmitError(error);
                if (!isRetryable || attempt >= maxAttempts) {
                    throw error;
                }
                const delay = baseDelay * attempt;
                console.warn(
                    `[Relayer] Header submit retry ${attempt}/${maxAttempts} for ${blockHeader.chainId} #${blockHeader.blockNumber} -> ${targetChainId}: ${error.message}`
                );
                await this.sleep(delay);
            }
        }
        throw lastError || new Error('Header submit failed');
    }
    
    /**
     * 澶勭悊璺ㄩ摼浜嬩欢
     */
    async handleCrossChainEvent(sourceChainId, event) {
        try {
            console.log(`[Relayer] Cross-chain event from ${sourceChainId}:`, {
                targetChain: event.targetChainId,
                txHash: event.txHash
            });

            // Submit missing headers sequentially before relaying the message.
            await this.submitSequentialHeaders(sourceChainId, event.targetChainId, event.blockNumber);
            
            // 鑾峰彇浜嬩欢鎵€鍦ㄥ尯鍧楃殑淇℃伅
            const block = await this.getBlock(sourceChainId, event.blockNumber);
            
            // 鎻愬彇鏍囧噯鍖栧尯鍧楀ご
            const blockHeader = await this.extractor.extractBlockHeader(
                sourceChainId,
                block,
                this.config.getChainConfig(sourceChainId)
            );
            
            // receiveLite does not require merkle proof.
            const targetChain = this.config.getChainConfig(event.targetChainId);
            const receiveMethod = targetChain?.receiveMethod || 'receive';
            let merkleProof = [];
            
            if (receiveMethod === 'receive') {
                // 鍙湁 receive 闇€瑕?Merkle 璇佹槑
                merkleProof = await this.generateMerkleProof(
                    sourceChainId,
                    event.blockNumber,
                    event.txHash
                );
            }
            
            // 鏋勯€犺法閾炬秷鎭紙浠?eventData 涓彁鍙栧畬鏁翠俊鎭級
            const ed = event.eventData || {};
            const message = {
                sourceChainId: sourceChainId,
                targetChainId: event.targetChainId,
                sourceTxHash: event.txHash,
                sourceBlockNumber: event.blockNumber,
                targetContract: ed.targetContract || event.targetContract,
                targetFunction: ed.method || event.targetFunction,
                payload: ed.data || JSON.stringify(ed),
                merkleProof: merkleProof,
                blockHeader: blockHeader
            };
            
            // 杞彂娑堟伅鍒扮洰鏍囬摼
            const relayResult = await this.messageHandler.relayMessage(message);
            
            this.emit('messageRelayed', {
                from: sourceChainId,
                to: event.targetChainId,
                txHash: event.txHash,
                sourceBlockNumber: event.blockNumber,
                sourcePayloadHash: relayResult?.sourcePayloadHash || null,
                targetPayloadHash: relayResult?.targetPayloadHash || null,
                targetTxHash: relayResult?.targetTxHash || null,
                targetBlockNumber: relayResult?.targetBlockNumber ?? null,
                receiptStatus: relayResult?.receiptStatus || null
            });
            
        } catch (error) {
            console.error(`[Relayer] Error handling cross-chain event:`, error);
            this.emit('error', { sourceChainId, event, error });
        }
    }

    /**
     * 纭繚鎻愪氦鍒扮洰鏍囬摼鐨勫尯鍧楀ご鏄繛缁殑锛堥伩鍏?LightClient 搴忓彿涓嶈繛缁級
     */
    async submitSequentialHeaders(sourceChainId, targetChainId, uptoBlockNumber) {
        const pathKey = `${sourceChainId}->${targetChainId}`;
        let queueState = this.headerSyncQueueByPath.get(pathKey);
        if (!queueState) {
            queueState = {
                running: false,
                pendingUpto: null,
                promise: null
            };
            this.headerSyncQueueByPath.set(pathKey, queueState);
        }

        const normalizedUpto = Number(uptoBlockNumber);
        if (!Number.isInteger(normalizedUpto) || normalizedUpto < 0) {
            return;
        }

        queueState.pendingUpto = queueState.pendingUpto === null
            ? normalizedUpto
            : Math.max(queueState.pendingUpto, normalizedUpto);

        if (queueState.running) {
            return queueState.promise;
        }

        queueState.running = true;
        queueState.promise = (async () => {
            try {
                while (queueState.pendingUpto !== null) {
                    const nextUpto = queueState.pendingUpto;
                    queueState.pendingUpto = null;
                    await this.submitSequentialHeadersOnce(sourceChainId, targetChainId, nextUpto);
                }
            } finally {
                queueState.running = false;
                if (queueState.pendingUpto === null) {
                    this.headerSyncQueueByPath.delete(pathKey);
                }
            }
        })();

        return queueState.promise;
    }

    async submitSequentialHeadersOnce(sourceChainId, targetChainId, uptoBlockNumber) {
        const targetChain = this.config.getChainConfig(targetChainId);
        if (!targetChain || (targetChain.type !== 'FISCO_BCOS' && targetChain.type !== 'FABRIC')) {
            return;
        }
        if (targetChain.type === 'FISCO_BCOS' && !targetChain.contracts?.lightClient) {
            return;
        }

        const targetMonitor = this.monitors.get(targetChainId);
        if (!targetMonitor || typeof targetMonitor.getLightClientLatestBlockNumber !== 'function') {
            return;
        }

        let latest = await targetMonitor.getLightClientLatestBlockNumber(sourceChainId);
        if (latest === null || Number.isNaN(latest)) {
            return;
        }

        // If LightClient has no history, allow current block as starting point.
        let from;
        if (targetChain.type === 'FISCO_BCOS') {
            from = latest === 0 ? uptoBlockNumber : latest + 1;
        } else {
            from = latest < 0 ? uptoBlockNumber : latest + 1;
        }
        if (from > uptoBlockNumber) {
            return;
        }

        console.log(`[Relayer] Submitting ${sourceChainId} headers to ${targetChainId}: ${from} -> ${uptoBlockNumber}`);
        const PER_BLOCK_MAX_ATTEMPTS = 3;
        const PER_BLOCK_BACKOFF_MS = 1500;
        for (let blockNum = from; blockNum <= uptoBlockNumber; blockNum++) {
            // 瀹炴椂鏌ヨ鏈€鏂伴珮搴︼紝閬垮厤骞跺彂涔卞簭鎻愪氦
            const currentLatest = await targetMonitor.getLightClientLatestBlockNumber(sourceChainId);
            if (currentLatest === null || Number.isNaN(currentLatest)) {
                return;
            }
            if (blockNum <= currentLatest) {
                console.log(`[Relayer] Skip submit ${sourceChainId} #${blockNum} (already at ${currentLatest})`);
                continue;
            }
            if (targetChain.type === 'FABRIC' && currentLatest >= 0 && blockNum !== currentLatest + 1) {
                // Fabric requires strictly sequential headers. If we lag by more than 1,
                // rewind to currentLatest+1 instead of leaving the gap forever.
                if (blockNum > currentLatest + 1) {
                    console.log(`[Relayer] Resyncing ${sourceChainId} headers: requested #${blockNum}, latest=${currentLatest}, rewinding to ${currentLatest + 1}`);
                    blockNum = currentLatest; // for-loop ++ will land at currentLatest+1
                    continue;
                }
                console.log(`[Relayer] Skip submit ${sourceChainId} #${blockNum} (non-sequential, latest=${currentLatest})`);
                continue;
            }

            let lastError = null;
            let succeeded = false;
            for (let attempt = 1; attempt <= PER_BLOCK_MAX_ATTEMPTS; attempt += 1) {
                try {
                    const block = await this.getBlock(sourceChainId, blockNum);
                    const header = await this.extractor.extractBlockHeader(
                        sourceChainId,
                        block,
                        this.config.getChainConfig(sourceChainId)
                    );
                    await this.submitBlockHeaderWithRetry(targetChainId, header);
                    succeeded = true;
                    break;
                } catch (err) {
                    lastError = err;
                    const transient = /timeout|TIMEOUT|ETIMEDOUT|ECONNRESET|ENETUNREACH/i.test(String(err?.message || err?.code || ''));
                    console.warn(`[Relayer] Header attempt ${attempt}/${PER_BLOCK_MAX_ATTEMPTS} failed for ${sourceChainId} #${blockNum}: ${err.message || err}${transient ? ' (transient)' : ''}`);
                    if (attempt < PER_BLOCK_MAX_ATTEMPTS) {
                        await new Promise((resolve) => setTimeout(resolve, PER_BLOCK_BACKOFF_MS * attempt));
                    }
                }
            }
            if (!succeeded) {
                console.error(`[Relayer] Giving up on ${sourceChainId} #${blockNum} after ${PER_BLOCK_MAX_ATTEMPTS} attempts: ${lastError?.message || lastError}`);
                // Re-queue so the next event/block triggers another catch-up instead of dropping the gap forever.
                const queueState = this.headerSyncQueueByPath.get(`${sourceChainId}->${targetChainId}`);
                if (queueState) {
                    queueState.pendingUpto = queueState.pendingUpto === null
                        ? uptoBlockNumber
                        : Math.max(queueState.pendingUpto, uptoBlockNumber);
                }
                return;
            }
        }
    }
    
    /**
     * 鑾峰彇鍖哄潡淇℃伅
     */
    async getBlock(chainId, blockNumber) {
        const monitor = this.monitors.get(chainId);
        if (!monitor) {
            throw new Error(`Monitor not found for ${chainId}`);
        }
        return await monitor.getBlock(blockNumber);
    }
    
    /**
     * 鐢熸垚Merkle璇佹槑
     */
    async generateMerkleProof(chainId, blockNumber, txHash) {
        const monitor = this.monitors.get(chainId);
        if (!monitor) {
            throw new Error(`Monitor not found for ${chainId}`);
        }
        return await monitor.generateMerkleProof(blockNumber, txHash);
    }
    
    /**
     * 鍚姩涓户鏈嶅姟
     */
    async start() {
        if (this.isRunning) {
            console.log('[Relayer] Service already running');
            return;
        }
        
        console.log('[Relayer] Starting relay service...');
        this.isRunning = true;
        
        // 鍚姩鎵€鏈夌洃鍚櫒
        for (const [chainId, monitor] of this.monitors.entries()) {
            await monitor.start();
            console.log(`[Relayer] Started monitoring ${chainId}`);
        }
        
        console.log('[Relayer] Relay service started successfully');
    }
    
    /**
     * 鍋滄涓户鏈嶅姟
     */
    async stop() {
        if (!this.isRunning) {
            return;
        }
        
        console.log('[Relayer] Stopping relay service...');
        this.isRunning = false;
        if (this._txHashCleanupTimer) {
            clearInterval(this._txHashCleanupTimer);
            this._txHashCleanupTimer = null;
        }

        
        // 鍋滄鎵€鏈夌洃鍚櫒
        for (const [chainId, monitor] of this.monitors.entries()) {
            await monitor.stop();
            console.log(`[Relayer] Stopped monitoring ${chainId}`);
        }
        
        console.log('[Relayer] Relay service stopped');
    }
    
    /**
     * 鑾峰彇鏈嶅姟鐘舵€?     */
    getStatus() {
        const status = {
            isRunning: this.isRunning,
            chains: []
        };
        
        for (const [chainId, monitor] of this.monitors.entries()) {
            let isConnected = false;
            if (typeof monitor.isConnected === 'function') {
                try {
                    isConnected = Boolean(monitor.isConnected());
                } catch (_error) {
                    isConnected = false;
                }
            }

            let latestBlock = null;
            if (typeof monitor.getLatestBlockNumberSync === 'function') {
                try {
                    latestBlock = monitor.getLatestBlockNumberSync();
                } catch (_error) {
                    latestBlock = null;
                }
            } else if (typeof monitor.getLatestBlockNumber === 'function') {
                try {
                    const maybeValue = monitor.getLatestBlockNumber();
                    latestBlock = typeof maybeValue?.then === 'function' ? null : maybeValue;
                } catch (_error) {
                    latestBlock = null;
                }
            }

            status.chains.push({
                chainId,
                isConnected,
                latestBlock
            });
        }
        
        return status;
    }

    getMonitor(chainId) {
        return this.monitors.get(chainId) || null;
    }

    async getExplorerOverview() {
        const chains = [];
        for (const chainConfig of this.config.chains) {
            const chainId = chainConfig.chainId;
            const monitor = this.monitors.get(chainId);

            if (!monitor) {
                chains.push({
                    chainId,
                    connected: false,
                    latestBlock: null,
                    latestObservedBlock: null,
                    updatedAt: new Date().toISOString()
                });
                continue;
            }

            let connected = false;
            if (typeof monitor.isConnected === 'function') {
                try {
                    connected = Boolean(monitor.isConnected());
                } catch (_error) {
                    connected = false;
                }
            }

            let latestObservedBlock = null;
            if (typeof monitor.getLatestObservedBlockNumberSync === 'function') {
                try {
                    latestObservedBlock = monitor.getLatestObservedBlockNumberSync();
                } catch (_error) {
                    latestObservedBlock = null;
                }
            } else if (typeof monitor.getLatestBlockNumberSync === 'function') {
                try {
                    latestObservedBlock = monitor.getLatestBlockNumberSync();
                } catch (_error) {
                    latestObservedBlock = null;
                }
            }

            let latestBlock = latestObservedBlock;
            if (typeof monitor.getLatestBlockNumber === 'function') {
                try {
                    const fetched = await monitor.getLatestBlockNumber();
                    if (Number.isInteger(fetched)) {
                        latestBlock = Number.isInteger(latestObservedBlock)
                            ? Math.max(latestObservedBlock, fetched)
                            : fetched;
                    } else if (fetched !== null && fetched !== undefined && !Number.isNaN(Number(fetched))) {
                        const normalizedFetched = Number(fetched);
                        latestBlock = Number.isInteger(latestObservedBlock)
                            ? Math.max(latestObservedBlock, normalizedFetched)
                            : normalizedFetched;
                    }
                } catch (_error) {
                    latestBlock = latestObservedBlock;
                }
            }

            chains.push({
                chainId,
                connected,
                latestBlock,
                latestObservedBlock,
                updatedAt: new Date().toISOString()
            });
        }

        return { chains };
    }
}

module.exports = { RelayerService };
