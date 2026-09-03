/**
 * FISCO-BCOS 链监听器
 * 使用 ethers.js 连接 FISCO-BCOS 节点并监听 CrossChainCall 事件
 */

const EventEmitter = require('events');
const { ethers } = require('ethers');
const path = require('path');
const { execFile } = require('node:child_process');

// Gateway 合约 ABI
const GatewayABI = require('../abi/Gateway.json');

const LightClientAirABI = [
    'function getLatestBlockNumber(string chainId) view returns (uint64)',
    'function getBlockHash(string chainId, uint64 blockNumber) view returns (bytes32)',
];

function execFileAsync(file, args, options = {}) {
    return new Promise((resolve, reject) => {
        execFile(file, args, options, (error, stdout, stderr) => {
            if (error) {
                const details = [
                    error.message,
                    stdout ? `STDOUT:\n${stdout}` : '',
                    stderr ? `STDERR:\n${stderr}` : '',
                ].filter(Boolean).join('\n\n');
                const err = new Error(details);
                err.cause = error;
                return reject(err);
            }
            resolve({ stdout, stderr });
        });
    });
}

function toBytes32Hex(v) {
    if (!v) return ethers.ZeroHash;
    if (typeof v === 'string') {
        if (v.startsWith('0x') && v.length === 66) return v;
        if (v.startsWith('0x')) return ethers.zeroPadValue(v, 32);
        return ethers.zeroPadValue('0x' + v, 32);
    }
    // Buffer/Uint8Array
    return ethers.zeroPadValue(ethers.hexlify(v), 32);
}

class FiscoBcosMonitor extends EventEmitter {
    constructor(config) {
        super();
        this.config = config;
        this.provider = null;
        this.gatewayContract = null;
        this.wallet = null;
        this.latestBlockNumber = 0;
        this.recentBlocks = [];
        this.maxRecentBlocks = 200;
        this.isMonitoring = false;
        this.pollTimer = null;
        this._isPolling = false;
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
            // FISCO-BCOS web3_rpc chain_id comes from config.genesis [web3] chain_id (default 20200)
            const staticNetwork = new ethers.Network('fisco-bcos', 20200);
            const pollIntervalMs = this.config.monitoring?.pollInterval || 5000;
            this.provider = new ethers.JsonRpcProvider(rpcEndpoint, staticNetwork, {
                staticNetwork: true,
                polling: true,
                pollingInterval: pollIntervalMs,
                // FISCO-BCOS web3_rpc accepts individual JSON-RPC requests but
                // does not reliably respond to the JSON-RPC batch arrays that
                // ethers v6 enables by default.
                batchMaxCount: 1,
                // FISCO returns a fresh transaction nonce. Reusing ethers'
                // default 250 ms request cache can trigger NonceCheckFail when
                // receipts are anchored back-to-back.
                cacheTimeout: -1
            });
            this.provider.pollingInterval = pollIntervalMs;

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
        if (!this.isMonitoring || !this.provider || this._isPolling) {
            return;
        }
        this._isPolling = true;
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
        } finally {
            this._isPolling = false;
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

            const txCount = block.transactions ? block.transactions.length : 0;
            this.recentBlocks.push({
                chainId: this.config.chainId,
                blockNumber: Number(block.number),
                blockHash: block.hash || null,
                parentHash: block.parentHash || null,
                timestamp: block.timestamp ? Number(block.timestamp) : null,
                txCount: Number.isFinite(txCount) ? txCount : null,
                source: 'rpc'
            });
            if (this.recentBlocks.length > this.maxRecentBlocks) {
                this.recentBlocks.shift();
            }
            
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
                console.log(`  - Target Chain: ${event.args.targetChain}`);
                console.log(`  - Target Contract: ${event.args.targetContract}`);
                console.log(`  - Method: ${event.args.method}`);
                console.log(`  - Data: ${event.args.data}`);
                
                // 只处理发往 Fabric 的跨链消息
                const targetChainId = event.args.targetChain;
                if (targetChainId && targetChainId.toLowerCase().includes('fabric')) {
                    this.emit('crossChainEvent', {
                        txHash: event.transactionHash,
                        blockNumber: blockNumber,
                        targetChainId: event.args.targetChain,
                        targetContract: event.args.targetContract,
                        targetFunction: event.args.method,
                        payload: event.args.data,
                        eventData: {
                            targetChain: event.args.targetChain,
                            targetContract: event.args.targetContract,
                            method: event.args.method,
                            data: event.args.data
                        }
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
     * 提交区块头到 LightClient 合约（可选功能）
     */
    async submitBlockHeader(blockHeader) {
        const lightClientAddr = this.config.contracts?.lightClient;
        if (!lightClientAddr) {
            console.log(`[FiscoBcosMonitor] LightClient not configured, skip submitBlockHeader (${blockHeader.chainId} #${blockHeader.blockNumber})`);
            return;
        }

        try {
            // 1) 读取 LightClient 当前高度，以便计算 previousHash（顺序提交）
            const lightClient = new ethers.Contract(lightClientAddr, LightClientAirABI, this.provider);
            const latest = await lightClient.getLatestBlockNumber(blockHeader.chainId);
            const latestNum = Number(latest);
            
            // 跳过已提交的区块
            if (blockHeader.blockNumber <= latestNum) {
                console.log(`[FiscoBcosMonitor] Skip submit ${blockHeader.chainId} #${blockHeader.blockNumber} (already at ${latestNum})`);
                return;
            }
            
            // LightClientAir 的"上一块哈希"要求与其内部计算的 hash 一致，
            // Fabric 的 header.previous_hash 与该计算规则不一致，因此强制使用合约内记录的 hash
            let previousHash = ethers.ZeroHash;
            if (latestNum > 0) {
                previousHash = await lightClient.getBlockHash(blockHeader.chainId, latest);
            }

            // 2) 归一化字段
            const chainId = blockHeader.chainId;
            const blockNumber = Number(blockHeader.blockNumber);
            const timestamp = Number(blockHeader.timestamp);
            const transactionsRoot = toBytes32Hex(blockHeader.transactionsRoot);
            const stateRoot = toBytes32Hex(blockHeader.stateRoot || ethers.ZeroHash);
            const consensusType = String(blockHeader.consensusType || 'RAFT');
            const extraData = '0x';

            // 3) 通过 console.sh 写入（避免 ethers.js 写入兼容性问题）
            const defaultConsoleDir = path.resolve(__dirname, '..', '..', 'fisco-bcos', 'console');
            const consoleDir = process.env.FISCO_CONSOLE_DIR || this.config.consoleDir || defaultConsoleDir;
            const consoleBin = path.resolve(consoleDir, 'console.sh');
            const lightClientName =
                process.env.FISCO_LIGHTCLIENT_CONTRACT_NAME ||
                this.config.contracts?.lightClientName ||
                'LightClientAir';

            const args = [
                'call',
                lightClientName,
                lightClientAddr,
                'submitBlockHeader',
                chainId,
                String(blockNumber),
                String(timestamp),
                previousHash,
                transactionsRoot,
                stateRoot,
                consensusType,
                extraData,
            ];

            const { stdout } = await execFileAsync(consoleBin, args, { cwd: consoleDir, timeout: 120_000 });
            const out = String(stdout || '').trim();
            console.log(`[FiscoBcosMonitor] Submitted block header: ${chainId} #${blockNumber} (prev=${previousHash})`);
            if (out) {
                console.log(`[FiscoBcosMonitor] LightClient console output:\n${out}`);
                // 检查 transaction status
                if (!/transaction status:\s*0\b/i.test(out)) {
                    throw new Error(`LightClient transaction failed (status not 0)`);
                }
            }
            return out;
        } catch (error) {
            console.warn(`[FiscoBcosMonitor] Failed to submit block header: ${blockHeader.chainId} #${blockHeader.blockNumber}: ${error.message}`);
            throw error;
        }
    }
    
    /**
     * 获取 LightClient 当前已提交的最新区块号（通过 console.sh 查询，避免超时）
     */
    async getLightClientLatestBlockNumber(chainId) {
        const lightClientAddr = this.config.contracts?.lightClient;
        if (!lightClientAddr) {
            return null;
        }
        
        try {
            const defaultConsoleDir = path.resolve(__dirname, '..', '..', 'fisco-bcos', 'console');
            const consoleDir = process.env.FISCO_CONSOLE_DIR || this.config.consoleDir || defaultConsoleDir;
            const consoleBin = path.resolve(consoleDir, 'console.sh');
            const lightClientName =
                process.env.FISCO_LIGHTCLIENT_CONTRACT_NAME ||
                this.config.contracts?.lightClientName ||
                'LightClientAir';
            
            const { stdout } = await execFileAsync(
                consoleBin,
                ['call', lightClientName, lightClientAddr, 'getLatestBlockNumber', chainId],
                { cwd: consoleDir, timeout: 10_000 }
            );
            
            const out = String(stdout || '').trim();
            // 解析返回值：Return values:(123)
            const match = out.match(/Return values:\((\d+)\)/i);
            if (match) {
                return Number(match[1]);
            }
            return null;
        } catch (error) {
            console.warn(`[FiscoBcosMonitor] Failed to query LightClient latest block for ${chainId}: ${error.message}`);
            return null;
        }
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

    getLatestBlockNumberSync() {
        return this.latestBlockNumber;
    }

    getLatestObservedBlockNumberSync() {
        return this.latestBlockNumber;
    }

    async getRecentBlocks(limit = 20) {
        const parsedLimit = Number.parseInt(limit, 10);
        const finalLimit = Number.isNaN(parsedLimit) ? 20 : Math.max(1, Math.min(50, parsedLimit));

        if (this.recentBlocks.length < finalLimit && this.provider) {
            const latest = await this.provider.getBlockNumber();
            const from = Math.max(0, latest - finalLimit + 1);
            const fetched = [];
            for (let blockNumber = from; blockNumber <= latest; blockNumber++) {
                const block = await this.provider.getBlock(blockNumber, false);
                if (!block) {
                    continue;
                }
                const txCount = block.transactions ? block.transactions.length : 0;
                fetched.push({
                    chainId: this.config.chainId,
                    blockNumber: Number(block.number),
                    blockHash: block.hash || null,
                    parentHash: block.parentHash || null,
                    timestamp: block.timestamp ? Number(block.timestamp) : null,
                    txCount: Number.isFinite(txCount) ? txCount : null,
                    source: 'rpc'
                });
            }
            this.recentBlocks = fetched.slice(-this.maxRecentBlocks);
        }

        return this.recentBlocks.slice(-finalLimit).reverse();
    }
}

module.exports = { FiscoBcosMonitor };
