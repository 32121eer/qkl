const { connect, signers } = require('@hyperledger/fabric-gateway');
const EventEmitter = require('events');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const grpc = require('@grpc/grpc-js');
const { exec } = require('child_process');
const util = require('util');

const execAsync = util.promisify(exec);

class FabricMonitor extends EventEmitter {
    constructor(config) {
        super();
        this.config = config;
        this.gateway = null;
        this.network = null;
        this.running = false;
    }
    
    async initialize() {
        console.log('[FabricMonitor] Initializing Fabric connection...');
        const conn = this.config.connection;
        
        // 根据 cryptoPath 生成证书路径（使用 Admin 用户）
        const cryptoPath = path.resolve(conn.cryptoPath);
        const userPath = path.join(cryptoPath, 'users', 'Admin@org1.example.com', 'msp');
        
        // 读取证书文件（第一个 .pem 文件）
        const signcertsDir = path.join(userPath, 'signcerts');
        const certFiles = fs.readdirSync(signcertsDir);
        const certPath = path.join(signcertsDir, certFiles[0]);
        
        // 读取私钥文件（第一个文件）
        const keyDir = path.join(userPath, 'keystore');
        const keyFiles = fs.readdirSync(keyDir);
        const keyPath = path.join(keyDir, keyFiles[0]);
        
        const tlsCertPath = path.join(cryptoPath, 'peers', conn.peerHostAlias, 'tls', 'ca.crt');

        const credentials = grpc.credentials.createSsl(fs.readFileSync(tlsCertPath));
        const client = new grpc.Client(conn.peerEndpoint, credentials, {
            'grpc.ssl_target_name_override': conn.peerHostAlias,
            'grpc.default_authority': conn.peerHostAlias,
        });

        const identity = {
            mspId: conn.mspId,
            credentials: fs.readFileSync(certPath)
        };

        const signer = signers.newPrivateKeySigner(
            crypto.createPrivateKey(fs.readFileSync(keyPath))
        );

        this.gateway = connect({ identity, signer, client });
        this.network = this.gateway.getNetwork(conn.channelName);
        
        console.log('[FabricMonitor] Fabric connection initialized successfully');
    }

    async start() {
        if (!this.gateway) {
            await this.initialize();
        }

        this.running = true;
        console.log('[FabricMonitor] Starting Fabric block monitoring...');

        // 在后台启动事件监听，不阻塞 start() 方法返回
        this._startEventLoop().catch(err => {
            console.error('[FabricMonitor] Event loop error:', err);
        });
    }

    async _startEventLoop() {
        try {
            const chaincodeName = this.config.contracts.gateway;
            const blockEvents = await this.network.getChaincodeEvents(chaincodeName);
            
            for await (const event of blockEvents) {
                if (!this.running) break;

                const blockNumber = Number(event.blockNumber);
                console.log(`[FabricMonitor] Received chaincode event from block ${blockNumber}`);

                // Parse event payload
                let payloadStr;
                if (Buffer.isBuffer(event.payload)) {
                    payloadStr = event.payload.toString('utf8');
                } else if (event.payload instanceof Uint8Array) {
                    payloadStr = Buffer.from(event.payload).toString('utf8');
                } else {
                    payloadStr = String(event.payload);
                }
                
                console.log(`[FabricMonitor] Event payload: ${payloadStr}`);

                try {
                    const eventData = JSON.parse(payloadStr);
                    
                    // Check if this is a CrossChainCall event
                    if (eventData.eventType === 'CrossChainCall' || event.eventName === 'CrossChainCall') {
                        console.log('[FabricMonitor] CrossChainCall event detected:', eventData);
                        
                        this.emit('crossChainEvent', {
                            sourceChainId: this.config.chainId,
                            targetChainId: eventData.targetChain || eventData.destChain,
                            blockNumber: blockNumber,
                            txHash: event.transactionId,
                            eventData: eventData
                        });
                    }
                } catch (parseError) {
                    console.error('[FabricMonitor] Failed to parse event payload:', parseError.message);
                }
            }
        } catch (error) {
            if (this.running) {
                console.error('[FabricMonitor] Error in block monitoring:', error);
                // Attempt to reconnect after a delay
                setTimeout(() => this.start(), 5000);
            }
        }
    }

    async stop() {
        console.log('[FabricMonitor] Stopping Fabric monitor...');
        this.running = false;
        if (this.gateway) {
            this.gateway.close();
        }
    }

    async getLatestBlockNumber() {
        try {
            const conn = this.config.connection;
            const channelName = conn.channelName;
            const peerAddress = conn.peerEndpoint;
            const cryptoPath = path.resolve(conn.cryptoPath);
            const tlsCertPath = path.join(cryptoPath, 'peers', conn.peerHostAlias, 'tls', 'ca.crt');
            
            // Use peer CLI to get channel info
            const cmd = `peer channel getinfo -c ${channelName} --peerAddresses ${peerAddress} --tlsRootCertFiles ${tlsCertPath}`;
            
            const mspPath = path.join(cryptoPath, 'users', 'Admin@org1.example.com', 'msp');
            
            const { stdout } = await execAsync(cmd, {
                env: {
                    ...process.env,
                    CORE_PEER_LOCALMSPID: conn.mspId,
                    CORE_PEER_TLS_ENABLED: 'true',
                    CORE_PEER_TLS_ROOTCERT_FILE: tlsCertPath,
                    CORE_PEER_MSPCONFIGPATH: mspPath,
                    CORE_PEER_ADDRESS: peerAddress
                }
            });

            const heightMatch = stdout.match(/Blockchain info: \{"height":(\d+)/);
            if (heightMatch) {
                return parseInt(heightMatch[1]) - 1; // Height is 1-indexed, block number is 0-indexed
            }

            throw new Error('Failed to parse block height from peer response');
        } catch (error) {
            console.error('[FabricMonitor] Error getting latest block number:', error.message);
            return 0;
        }
    }
    
    async getBlock(blockNumber) {
        // Fabric Gateway SDK 不直接支持按编号获取区块
        // 对于 receiveLite 模式，返回简化的区块信息即可
        console.log(`[FabricMonitor] Simplified block info for #${blockNumber}`);
        return {
            number: blockNumber,
            chainType: 'FABRIC',
            header: {
                number: blockNumber,
                // 其他字段在 extractBlockHeader 中会被忽略（receiveLite 模式）
            }
        };
    }
    
    async generateMerkleProof(blockNumber, txId) {
        // Fabric Merkle Proof 生成较复杂，暂时返回空
        console.log(`[FabricMonitor] Merkle proof generation not implemented for Fabric`);
        return [];
    }
    
    async _getGatewayContract() {
        if (!this.gateway || !this.network) {
            await this.initialize();
        }
        const chaincodeName = this.config.contracts.gateway;
        return this.network.getContract(chaincodeName);
    }

    async getLightClientLatestBlockNumber(chainId) {
        try {
            const contract = await this._getGatewayContract();
            const result = await contract.evaluateTransaction('GetLatestBlockNumber', chainId);
            const text = Buffer.from(result).toString('utf8').trim();
            const n = parseInt(text, 10);
            return Number.isNaN(n) ? -1 : n;
        } catch (error) {
            console.warn(`[FabricMonitor] Failed to query LightClient latest block for ${chainId}: ${error.message}`);
            return null;
        }
    }

    async submitBlockHeader(blockHeader) {
        // Fabric 目前没有 LightClient chaincode，暂时跳过区块头提交
        const chainId = blockHeader.chainId;
        const blockNumber = Number(blockHeader.blockNumber);

        const latest = await this.getLightClientLatestBlockNumber(chainId);
        if (latest === null) {
            console.warn(`[FabricMonitor] LightClient query failed, skip submit (${chainId} #${blockNumber})`);
            return;
        }

        if (latest >= 0) {
            if (blockNumber <= latest) {
                console.log(`[FabricMonitor] Skip submit ${chainId} #${blockNumber} (already at ${latest})`);
                return;
            }
            if (blockNumber !== latest + 1) {
                console.log(`[FabricMonitor] Skip submit ${chainId} #${blockNumber} (non-sequential, latest=${latest})`);
                return;
            }
        }

        const contract = await this._getGatewayContract();
        const payload = JSON.stringify(blockHeader);
        const result = await contract.submitTransaction('SubmitBlockHeader', payload);
        const out = Buffer.from(result).toString('utf8').trim();
        console.log(`[FabricMonitor] Submitted block header: ${chainId} #${blockNumber} (latest was ${latest})`);
        if (out) {
            console.log(`[FabricMonitor] LightClient output: ${out}`);
        }
        return out;
    }
}

module.exports = FabricMonitor;
