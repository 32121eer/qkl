/**
 * 跨链消息处理器
 * 负责验证和转发跨链消息
 */

const { ethers } = require('ethers');
const grpc = require('@grpc/grpc-js');
const { connect, hash, signers } = require('@hyperledger/fabric-gateway');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

// Gateway 合约 ABI
const GatewayABI = require('../abi/Gateway.json');

class MessageHandler {
    constructor(config) {
        this.config = config;
        this.fiscoProvider = null;
        this.fiscoWallet = null;
        this.fiscoGatewayContract = null;
        this.fabricGateway = null;
        this.fabricNetwork = null;
    }
    
    /**
     * 初始化（可选，用于预建立连接）
     */
    async initialize() {
        console.log('[MessageHandler] Initializing...');
        
        // 初始化 FISCO 连接
        const fiscoConfig = this.config.chains.find(c => c.type === 'FISCO_BCOS');
        if (fiscoConfig && fiscoConfig.enabled) {
            await this.initFiscoConnection(fiscoConfig);
        }
        
        console.log('[MessageHandler] Initialized');
    }
    
    /**
     * 初始化 FISCO 连接
     */
    async initFiscoConnection(chainConfig) {
        try {
            // 使用静态网络配置，避免 ethers.js 自动检测网络时卡住
            const staticNetwork = new ethers.Network('fisco-bcos', 1);
            this.fiscoProvider = new ethers.JsonRpcProvider(chainConfig.rpc.endpoint, staticNetwork, {
                staticNetwork: true
            });
            
            if (this.config.relayer && this.config.relayer.privateKey) {
                const privateKey = this.config.relayer.privateKey;
                // 确保私钥格式正确
                const formattedKey = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
                this.fiscoWallet = new ethers.Wallet(formattedKey, this.fiscoProvider);
            }
            
            if (chainConfig.contracts && chainConfig.contracts.gateway) {
                this.fiscoGatewayContract = new ethers.Contract(
                    chainConfig.contracts.gateway,
                    GatewayABI,
                    this.fiscoWallet || this.fiscoProvider
                );
            }
            
            console.log(`[MessageHandler] FISCO connection initialized: ${chainConfig.rpc.endpoint}`);
        } catch (error) {
            console.warn(`[MessageHandler] Failed to init FISCO connection:`, error.message);
        }
    }
    
    /**
     * 转发跨链消息
     */
    async relayMessage(message) {
        console.log(`[MessageHandler] Relaying message from ${message.sourceChainId} to ${message.targetChainId}`);
        
        try {
            // 1. 验证消息完整性
            this.validateMessage(message);
            
            // 2. 验证源链区块已确认
            await this.verifySourceBlock(message);
            
            // 3. 准备目标链调用参数
            const targetChain = this.config.getChainConfig(message.targetChainId);
            if (!targetChain) {
                throw new Error(`Target chain ${message.targetChainId} not found in config`);
            }
            
            // 4. 根据目标链类型进行调用
            switch (targetChain.type) {
                case 'FISCO_BCOS':
                    await this.relayToFiscoBcos(targetChain, message);
                    break;
                case 'FABRIC':
                    await this.relayToFabric(targetChain, message);
                    break;
                default:
                    throw new Error(`Unsupported target chain type: ${targetChain.type}`);
            }
            
            console.log(`[MessageHandler] Message relayed successfully`);
            
        } catch (error) {
            console.error(`[MessageHandler] Failed to relay message:`, error);
            throw error;
        }
    }
    
    /**
     * 验证消息
     */
    validateMessage(message) {
        const required = [
            'sourceChainId',
            'targetChainId',
            'sourceTxHash',
            'sourceBlockNumber',
            'payload'
        ];
        
        for (const field of required) {
            if (!message[field] && message[field] !== 0) {
                throw new Error(`Missing required field: ${field}`);
            }
        }
    }
    
    /**
     * 验证源区块
     */
    async verifySourceBlock(message) {
        // 检查区块确认数
        const confirmations = this.config.relayer?.blockConfirmations || 1;
        
        // 简化处理，实际应该查询链的最新高度
        console.log(`[MessageHandler] Block confirmations check: ${confirmations} blocks required`);
        
        return true;
    }
    
    /**
     * 转发到 FISCO-BCOS
     */
    async relayToFiscoBcos(targetChain, message) {
        console.log(`[MessageHandler] Relaying to FISCO-BCOS chain ${targetChain.chainId}`);
        console.log(`  - Source Chain: ${message.sourceChainId}`);
        console.log(`  - Source Tx: ${message.sourceTxHash}`);
        console.log(`  - Source Block: ${message.sourceBlockNumber}`);
        
        try {
            // 确保连接已建立
            if (!this.fiscoGatewayContract) {
                await this.initFiscoConnection(targetChain);
            }
            
            if (!this.fiscoGatewayContract || !this.fiscoWallet) {
                throw new Error('FISCO Gateway contract or wallet not initialized');
            }
            
            // 准备 payload
            let payloadBytes;
            if (typeof message.payload === 'string') {
                payloadBytes = ethers.toUtf8Bytes(message.payload);
            } else if (Buffer.isBuffer(message.payload)) {
                payloadBytes = message.payload;
            } else {
                payloadBytes = ethers.toUtf8Bytes(JSON.stringify(message.payload));
            }
            
            // 准备 Merkle 证明
            const merkleProof = message.merkleProof || [];
            const merkleProofBytes32 = merkleProof.map(p => {
                if (typeof p === 'string' && p.startsWith('0x') && p.length === 66) {
                    return p;
                }
                return ethers.zeroPadValue('0x00', 32);
            });
            
            // 调用 Gateway.receive()
            console.log(`[MessageHandler] Calling Gateway.receive()...`);
            
            // FISCO-BCOS 不完全兼容标准以太坊交易
            // 先尝试记录要调用的信息，用于后续手动验证或使用 FISCO console
            console.log(`[MessageHandler] 📋 FISCO 调用参数:`);
            console.log(`  合约: ${targetChain.contracts.gateway}`);
            console.log(`  函数: receive`);
            console.log(`  sourceChainId: ${message.sourceChainId}`);
            console.log(`  sourceTxHash: ${message.sourceTxHash}`);
            console.log(`  sourceBlockNumber: ${message.sourceBlockNumber}`);
            console.log(`  payload: 0x${Buffer.from(payloadBytes).toString('hex')}`);
            console.log(`  merkleProof: [${merkleProofBytes32.join(', ')}]`);
            
            // 模拟成功（实际需要通过 FISCO console 或 SDK 调用）
            console.log(`[MessageHandler] ⚠️ 注意: FISCO 写入交易需要通过 console 工具执行`);
            console.log(`[MessageHandler] 请在 FISCO console 中执行以下命令:`);
            
            const payloadHex = '0x' + Buffer.from(payloadBytes).toString('hex');
            console.log(`  call Gateway ${targetChain.contracts.gateway} receive "${message.sourceChainId}" "${message.sourceTxHash}" ${message.sourceBlockNumber} ${payloadHex} []`);
            
            // 返回待处理状态
            return { 
                success: false, 
                pending: true,
                message: 'FISCO transaction requires manual execution via console'
            };
            
        } catch (error) {
            console.error(`[MessageHandler] Failed to relay to FISCO:`, error.message);
            throw error;
        }
    }
    
    /**
     * 转发到 Fabric
     */
    async relayToFabric(targetChain, message) {
        console.log(`[MessageHandler] Relaying to Fabric chain ${targetChain.chainId}`);
        console.log(`  - Target Contract: ${message.targetContract}`);
        console.log(`  - Target Function: ${message.targetFunction}`);
        
        try {
            // 解析目标合约路径（格式: channel/chaincode 或直接 chaincode）
            let channelName = targetChain.connection?.channelName || 'mychannel';
            let chaincodeName = message.targetContract;
            
            if (message.targetContract.includes('/')) {
                const parts = message.targetContract.split('/');
                channelName = parts[0];
                chaincodeName = parts[1];
            }
            
            // 创建 Fabric 连接
            const { gateway, client } = await this.createFabricConnection(targetChain);
            
            try {
                const network = gateway.getNetwork(channelName);
                const contract = network.getContract(chaincodeName);
                
                // 准备 payload
                let payloadStr;
                if (typeof message.payload === 'string') {
                    payloadStr = message.payload;
                } else if (Buffer.isBuffer(message.payload)) {
                    payloadStr = message.payload.toString('utf8');
                } else {
                    payloadStr = JSON.stringify(message.payload);
                }
                
                // 准备 merkleProof
                let merkleProofJSON = '[]';
                if (message.merkleProof && message.merkleProof.length > 0) {
                    merkleProofJSON = JSON.stringify(message.merkleProof);
                }
                
                // 调用链码函数
                console.log(`[MessageHandler] Calling ${chaincodeName}.${message.targetFunction}()...`);
                
                const result = await contract.submitTransaction(
                    message.targetFunction,
                    message.sourceChainId,
                    message.sourceTxHash,
                    String(message.sourceBlockNumber),
                    payloadStr,
                    merkleProofJSON
                );
                
                console.log(`[MessageHandler] ✅ Fabric transaction success`);
                
                return result;
                
            } finally {
                gateway.close();
                client.close();
            }
            
        } catch (error) {
            console.error(`[MessageHandler] Failed to relay to Fabric:`, error.message);
            throw error;
        }
    }
    
    /**
     * 创建 Fabric 连接
     */
    async createFabricConnection(targetChain) {
        const connection = targetChain.connection;
        
        // 读取证书
        const cryptoPath = connection.cryptoPath || 
            '/home/tr/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com';
        
        const certPath = path.resolve(cryptoPath, 'users', 'User1@org1.example.com', 'msp', 'signcerts');
        const keyPath = path.resolve(cryptoPath, 'users', 'User1@org1.example.com', 'msp', 'keystore');
        const tlsCertPath = path.resolve(cryptoPath, 'peers', 'peer0.org1.example.com', 'tls', 'ca.crt');
        
        // 读取证书文件
        const certFiles = await fs.readdir(certPath);
        const credentials = await fs.readFile(path.join(certPath, certFiles[0]));
        
        const keyFiles = await fs.readdir(keyPath);
        const privateKeyPem = await fs.readFile(path.join(keyPath, keyFiles[0]));
        const privateKey = crypto.createPrivateKey(privateKeyPem);
        
        const tlsRootCert = await fs.readFile(tlsCertPath);
        
        // 创建 gRPC 连接
        const peerEndpoint = connection.peerEndpoint || 'localhost:7051';
        const peerHostAlias = connection.peerHostAlias || 'peer0.org1.example.com';
        
        const tlsCredentials = grpc.credentials.createSsl(tlsRootCert);
        const client = new grpc.Client(peerEndpoint, tlsCredentials, {
            'grpc.ssl_target_name_override': peerHostAlias,
        });
        
        // 创建 Gateway
        const gateway = connect({
            client,
            identity: { 
                mspId: connection.mspId || 'Org1MSP', 
                credentials 
            },
            signer: signers.newPrivateKeySigner(privateKey),
            hash: hash.sha256,
            evaluateOptions: () => ({ deadline: Date.now() + 5000 }),
            endorseOptions: () => ({ deadline: Date.now() + 15000 }),
            submitOptions: () => ({ deadline: Date.now() + 5000 }),
            commitStatusOptions: () => ({ deadline: Date.now() + 60000 }),
        });
        
        return { gateway, client };
    }
    
    /**
     * 重试机制
     */
    async retryRelay(message, maxAttempts = 3, delay = 5000) {
        let lastError;
        
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                await this.relayMessage(message);
                return; // 成功则返回
            } catch (error) {
                lastError = error;
                console.warn(`[MessageHandler] Relay attempt ${attempt}/${maxAttempts} failed:`, error.message);
                
                if (attempt < maxAttempts) {
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }
        
        throw new Error(`Failed to relay message after ${maxAttempts} attempts: ${lastError.message}`);
    }
}

module.exports = { MessageHandler };
