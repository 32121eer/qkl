/**
 * FISCO-BCOS 链监听器
 * 使用 ethers.js 连接 FISCO-BCOS 节点并监听 CrossChainCall 事件
 */

const EventEmitter = require('events');
const { ethers } = require('ethers');
const path = require('path');

// Gateway 合约 ABI
const GatewayABI = require('../abi/Gateway.json');

class FiscoBcosMonitor extends EventEmitter {
    constructor(config) {
        super();
        this.config = config;
        this.provider = null;
        this.gatewayContract = null;
        this.wallet = null;
        this.latestBlockNumber = 0;
        this.isMonitoring = false;
        this.pollTimer = null;
    }
    
    /**
     * 初始化连接
     */
    async initialize() {
        console.log(`[FiscoBcosMonitor] Initializing monitor for ${this.config.chainId}`);
        
        try {
            // 连接到 FISCO-BCOS 节点（JSON-RPC）
            const rpcEndpoint = this.config.rpc.endpoint;
            console.log(`[FiscoBcosMonitor] Connecting to ${rpcEndpoint}`);
            
            // 使用静态网络配置，避免 ethers.js 自动检测网络时卡住
            // FISCO-BCOS 使用 chainId 1（或根据实际配置）
            const staticNetwork = new ethers.Network('fisco-bcos', 1);
            this.provider = new ethers.JsonRpcProvider(rpcEndpoint, staticNetwork, {
                staticNetwork: true
            });
            
            // 测试连接
            const blockNumber = await this.provider.getBlockNumber();
            console.log(`[FiscoBcosMonitor] Connected! Current block: ${blockNumber}`);
            
            // 加载钱包（用于发送交易）
            if (this.config.relayer && this.config.relayer.privateKey) {
                this.wallet = new ethers.Wallet(this.config.relayer.privateKey, this.provider);
                console.log(`[FiscoBcosMonitor] Wallet loaded: ${this.wallet.address}`);
            }
            
            // 初始化 Gateway 合约
            const gatewayAddress = this.config.contracts.gateway;
            if (gatewayAddress) {
                this.gatewayContract = new ethers.Contract(
                    gatewayAddress,
                    GatewayABI,
                    this.wallet || this.provider
                );
                console.log(`[FiscoBcosMonitor] Gateway contract: ${gatewayAddress}`);
            }
            
            // 设置起始区块
            if (this.config.monitoring.startBlock === 'latest') {
                this.latestBlockNumber = blockNumber;
            } else {
                this.latestBlockNumber = parseInt(this.config.monitoring.startBlock);
            }
            
            console.log(`[FiscoBcosMonitor] Initialized, starting from block ${this.latestBlockNumber}`);
            
        } catch (error) {
            console.error(`[FiscoBcosMonitor] Initialization failed:`, error.message);
            throw error;
        }
    }
    
    /**
     * 启动监听
     */
    async start() {
        if (this.isMonitoring) {
            return;
        }
        
        this.isMonitoring = true;
        console.log(`[FiscoBcosMonitor] Started monitoring ${this.config.chainId}`);
        
        // 启动轮询
        const pollInterval = this.config.monitoring.pollInterval || 3000;
        this.pollTimer = setInterval(
            () => this.poll(),
            pollInterval
        );
        
        // 立即执行一次
        await this.poll();
    }
    
    /**
     * 停止监听
     */
    async stop() {
        this.isMonitoring = false;
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }
        console.log(`[FiscoBcosMonitor] Stopped monitoring ${this.config.chainId}`);
    }
    
    /**
     * 轮询新区块
     */
    async poll() {
        if (!this.isMonitoring || !this.provider) {
            return;
        }
        
        try {
            // 获取最新区块号
            const currentBlock = await this.provider.getBlockNumber();
            
            if (currentBlock <= this.latestBlockNumber) {
                return; // 没有新区块
            }
            
            console.log(`\n[FiscoBcosMonitor] New blocks: ${this.latestBlockNumber + 1} -> ${currentBlock}`);
            
            // 处理新区块
            for (let blockNum = this.latestBlockNumber + 1; blockNum <= currentBlock; blockNum++) {
                await this.processBlock(blockNum);
            }
            
            this.latestBlockNumber = currentBlock;
            
        } catch (error) {
            console.error(`[FiscoBcosMonitor] Error polling:`, error.message);
        }
    }
    
    /**
     * 处理区块
     */
    async processBlock(blockNumber) {
        try {
            // 获取区块详情（不包含完整交易，避免 FISCO nonce 解析问题）
            const block = await this.provider.getBlock(blockNumber, false);
            
            if (!block) {
                console.log(`[FiscoBcosMonitor] Block ${blockNumber} not found`);
                return;
            }
            
            // 触发新区块事件
            this.emit('newBlock', {
                number: block.number,
                hash: block.hash,
                parentHash: block.parentHash,
                timestamp: block.timestamp,
                transactionCount: block.transactions ? block.transactions.length : 0
            });
            
            // 直接查询该区块的 CrossChainCall 事件
            await this.parseBlockEventsDirectly(blockNumber);
            
        } catch (error) {
            console.error(`[FiscoBcosMonitor] Error processing block ${blockNumber}:`, error.message);
        }
    }
    
    /**
     * 直接查询区块事件（绕过交易解析）
     */
    async parseBlockEventsDirectly(blockNumber) {
        if (!this.gatewayContract) {
            return;
        }
        
        try {
            // 直接查询 CrossChainCall 事件
            const filter = this.gatewayContract.filters.CrossChainCall();
            const events = await this.gatewayContract.queryFilter(filter, blockNumber, blockNumber);
            
            for (const event of events) {
                console.log(`[FiscoBcosMonitor] 🎯 CrossChainCall event detected!`);
                console.log(`  - Target Chain: ${event.args.targetChainId}`);
                console.log(`  - Target Contract: ${event.args.targetContract}`);
                console.log(`  - Target Function: ${event.args.targetFunction}`);
                console.log(`  - Nonce: ${event.args.nonce.toString()}`);
                
                // 只处理发往 Fabric 的跨链消息
                const targetChainId = event.args.targetChainId;
                if (targetChainId.toLowerCase().includes('fabric')) {
                    this.emit('crossChainEvent', {
                        txHash: event.transactionHash,
                        blockNumber: blockNumber,
                        targetChainId: event.args.targetChainId,
                        targetContract: event.args.targetContract,
                        targetFunction: event.args.targetFunction,
                        payload: event.args.payload,
                        nonce: event.args.nonce.toString()
                    });
                }
            }
            
        } catch (error) {
            console.error(`[FiscoBcosMonitor] Error querying events for block ${blockNumber}:`, error.message);
        }
    }
    
    /**
     * 获取区块（不包含完整交易以避免 FISCO nonce 解析问题）
     */
    async getBlock(blockNumber) {
        return await this.provider.getBlock(blockNumber, false);
    }
    
    /**
     * 解析区块事件
     */
    async parseBlockEvents(block) {
        if (!this.gatewayContract) {
            return;
        }
        
        // 获取 CrossChainCall 事件
        const filter = this.gatewayContract.filters.CrossChainCall();
        
        try {
            // 查询该区块的事件
            const events = await this.gatewayContract.queryFilter(
                filter,
                block.number,
                block.number
            );
            
            for (const event of events) {
                console.log(`[FiscoBcosMonitor] 🎯 CrossChainCall event detected!`);
                console.log(`  - Target Chain: ${event.args.targetChainId}`);
                console.log(`  - Target Contract: ${event.args.targetContract}`);
                console.log(`  - Target Function: ${event.args.targetFunction}`);
                console.log(`  - Nonce: ${event.args.nonce.toString()}`);
                
                // 只处理发往 Fabric 的跨链消息
                const targetChainId = event.args.targetChainId;
                if (targetChainId.toLowerCase().includes('fabric')) {
                    this.emit('crossChainEvent', {
                        txHash: event.transactionHash,
                        blockNumber: block.number,
                        targetChainId: event.args.targetChainId,
                        targetContract: event.args.targetContract,
                        targetFunction: event.args.targetFunction,
                        payload: event.args.payload,
                        nonce: event.args.nonce.toString()
                    });
                }
            }
            
        } catch (error) {
            console.error(`[FiscoBcosMonitor] Error parsing events:`, error.message);
        }
    }
    
    /**
     * 调用 Gateway 合约的 receive 方法
     * @param {string} sourceChainId - 源链 ID
     * @param {string} sourceTxHash - 源链交易哈希
     * @param {number} sourceBlockNumber - 源链区块号
     * @param {string|Buffer} payload - 消息内容
     * @param {string[]} merkleProof - Merkle 证明
     */
    async callReceive(sourceChainId, sourceTxHash, sourceBlockNumber, payload, merkleProof = []) {
        if (!this.gatewayContract || !this.wallet) {
            throw new Error('Gateway contract or wallet not initialized');
        }
        
        console.log(`[FiscoBcosMonitor] Calling Gateway.receive()`);
        console.log(`  - Source Chain: ${sourceChainId}`);
        console.log(`  - Source Tx: ${sourceTxHash}`);
        console.log(`  - Source Block: ${sourceBlockNumber}`);
        
        try {
            // 将 payload 转换为 bytes
            let payloadBytes;
            if (typeof payload === 'string') {
                payloadBytes = ethers.toUtf8Bytes(payload);
            } else if (Buffer.isBuffer(payload)) {
                payloadBytes = payload;
            } else {
                payloadBytes = ethers.toUtf8Bytes(JSON.stringify(payload));
            }
            
            // 将 merkleProof 转换为 bytes32[]
            const merkleProofBytes32 = merkleProof.map(p => {
                if (p.startsWith('0x') && p.length === 66) {
                    return p;
                }
                return ethers.zeroPadValue(ethers.toBeHex(p), 32);
            });
            
            // 调用合约
            const tx = await this.gatewayContract.receive(
                sourceChainId,
                sourceTxHash,
                sourceBlockNumber,
                payloadBytes,
                merkleProofBytes32
            );
            
            console.log(`[FiscoBcosMonitor] Transaction sent: ${tx.hash}`);
            
            // 等待确认
            const receipt = await tx.wait();
            console.log(`[FiscoBcosMonitor] Transaction confirmed in block ${receipt.blockNumber}`);
            
            return receipt;
            
        } catch (error) {
            console.error(`[FiscoBcosMonitor] Failed to call receive:`, error.message);
            throw error;
        }
    }
    
    /**
     * 提交区块头到 LightClient 合约（可选功能）
     */
    async submitBlockHeader(blockHeader) {
        // TODO: 实现 LightClient 合约调用
        console.log(`[FiscoBcosMonitor] Submitted block header: ${blockHeader.chainId} #${blockHeader.blockNumber}`);
    }
    
    /**
     * 生成 Merkle 证明
     */
    async generateMerkleProof(blockNumber, txHash) {
        // TODO: 实现 Merkle 证明生成
        return [];
    }
    
    isConnected() {
        return this.provider !== null;
    }
    
    getLatestBlockNumber() {
        return this.latestBlockNumber;
    }
}

module.exports = { FiscoBcosMonitor };
