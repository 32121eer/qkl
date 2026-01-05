/**
 * 链下中继网络服务 (Off-Chain Relay Network)
 * 负责：
 * 1. 监听各条链的新区块
 * 2. 提取标准化区块头
 * 3. 将区块头提交到其他链的LightClient合约
 * 4. 监听跨链事件并传递消息
 */

const EventEmitter = require('events');
const { FiscoBcosMonitor } = require('./monitors/fisco_bcos_monitor');
const { FabricMonitor } = require('./monitors/fabric_monitor');
const { BlockHeaderExtractor } = require('./extractors/block_header_extractor');
const { MessageHandler } = require('./handlers/message_handler');

class RelayerService extends EventEmitter {
    constructor(config) {
        super();
        this.config = config;
        this.monitors = new Map();
        this.isRunning = false;
        
        // 初始化组件
        this.extractor = new BlockHeaderExtractor();
        this.messageHandler = new MessageHandler(config);
    }
    
    /**
     * 初始化中继服务
     */
    async initialize() {
        console.log('[Relayer] Initializing relay service...');
        
        // 初始化各链监听器
        for (const chainConfig of this.config.chains) {
            await this.initializeMonitor(chainConfig);
        }
        
        console.log('[Relayer] Initialization complete');
    }
    
    /**
     * 初始化链监听器
     */
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
        
        // 监听新区块
        monitor.on('newBlock', async (block) => {
            await this.handleNewBlock(chainConfig.chainId, block);
        });
        
        // 监听跨链事件
        monitor.on('crossChainEvent', async (event) => {
            await this.handleCrossChainEvent(chainConfig.chainId, event);
        });
        
        await monitor.initialize();
        this.monitors.set(chainConfig.chainId, monitor);
        
        console.log(`[Relayer] Initialized monitor for ${chainConfig.chainId}`);
    }
    
    /**
     * 处理新区块
     */
    async handleNewBlock(sourceChainId, block) {
        try {
            console.log(`[Relayer] New block from ${sourceChainId}: #${block.number}`);
            
            // 提取标准化区块头
            const standardHeader = await this.extractor.extractBlockHeader(
                sourceChainId,
                block,
                this.config.getChainConfig(sourceChainId)
            );
            
            // 广播到其他所有链
            await this.broadcastBlockHeader(sourceChainId, standardHeader);
            
            this.emit('blockRelayed', {
                sourceChainId,
                blockNumber: block.number,
                targetsCount: this.monitors.size - 1
            });
            
        } catch (error) {
            console.error(`[Relayer] Error handling block from ${sourceChainId}:`, error);
            this.emit('error', { sourceChainId, error });
        }
    }
    
    /**
     * 广播区块头到其他链
     */
    async broadcastBlockHeader(sourceChainId, blockHeader) {
        const promises = [];
        
        for (const [chainId, monitor] of this.monitors.entries()) {
            // 不发送给自己
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
     * 提交区块头到目标链
     */
    async submitBlockHeaderToChain(targetChainId, blockHeader) {
        const monitor = this.monitors.get(targetChainId);
        if (!monitor) {
            throw new Error(`Monitor not found for ${targetChainId}`);
        }
        
        console.log(`[Relayer] Submitting ${blockHeader.chainId} block #${blockHeader.blockNumber} to ${targetChainId}`);
        
        return await monitor.submitBlockHeader(blockHeader);
    }
    
    /**
     * 处理跨链事件
     */
    async handleCrossChainEvent(sourceChainId, event) {
        try {
            console.log(`[Relayer] Cross-chain event from ${sourceChainId}:`, {
                targetChain: event.targetChainId,
                txHash: event.txHash
            });
            
            // 获取事件所在区块的信息
            const block = await this.getBlock(sourceChainId, event.blockNumber);
            
            // 提取标准化区块头
            const blockHeader = await this.extractor.extractBlockHeader(
                sourceChainId,
                block,
                this.config.getChainConfig(sourceChainId)
            );
            
            // 生成Merkle证明
            const merkleProof = await this.generateMerkleProof(
                sourceChainId,
                event.blockNumber,
                event.txHash
            );
            
            // 构造跨链消息
            const message = {
                sourceChainId: sourceChainId,
                targetChainId: event.targetChainId,
                sourceTxHash: event.txHash,
                sourceBlockNumber: event.blockNumber,
                targetContract: event.targetContract,
                targetFunction: event.targetFunction,
                payload: event.payload,
                merkleProof: merkleProof,
                blockHeader: blockHeader
            };
            
            // 转发消息到目标链
            await this.messageHandler.relayMessage(message);
            
            this.emit('messageRelayed', {
                from: sourceChainId,
                to: event.targetChainId,
                txHash: event.txHash
            });
            
        } catch (error) {
            console.error(`[Relayer] Error handling cross-chain event:`, error);
            this.emit('error', { sourceChainId, event, error });
        }
    }
    
    /**
     * 获取区块信息
     */
    async getBlock(chainId, blockNumber) {
        const monitor = this.monitors.get(chainId);
        if (!monitor) {
            throw new Error(`Monitor not found for ${chainId}`);
        }
        return await monitor.getBlock(blockNumber);
    }
    
    /**
     * 生成Merkle证明
     */
    async generateMerkleProof(chainId, blockNumber, txHash) {
        const monitor = this.monitors.get(chainId);
        if (!monitor) {
            throw new Error(`Monitor not found for ${chainId}`);
        }
        return await monitor.generateMerkleProof(blockNumber, txHash);
    }
    
    /**
     * 启动中继服务
     */
    async start() {
        if (this.isRunning) {
            console.log('[Relayer] Service already running');
            return;
        }
        
        console.log('[Relayer] Starting relay service...');
        this.isRunning = true;
        
        // 启动所有监听器
        for (const [chainId, monitor] of this.monitors.entries()) {
            await monitor.start();
            console.log(`[Relayer] Started monitoring ${chainId}`);
        }
        
        console.log('[Relayer] Relay service started successfully');
    }
    
    /**
     * 停止中继服务
     */
    async stop() {
        if (!this.isRunning) {
            return;
        }
        
        console.log('[Relayer] Stopping relay service...');
        this.isRunning = false;
        
        // 停止所有监听器
        for (const [chainId, monitor] of this.monitors.entries()) {
            await monitor.stop();
            console.log(`[Relayer] Stopped monitoring ${chainId}`);
        }
        
        console.log('[Relayer] Relay service stopped');
    }
    
    /**
     * 获取服务状态
     */
    getStatus() {
        const status = {
            isRunning: this.isRunning,
            chains: []
        };
        
        for (const [chainId, monitor] of this.monitors.entries()) {
            status.chains.push({
                chainId,
                isConnected: monitor.isConnected(),
                latestBlock: monitor.getLatestBlockNumber()
            });
        }
        
        return status;
    }
}

module.exports = { RelayerService };
