/**
 * Hyperledger Fabric 链监听器
 */

const EventEmitter = require('events');
const grpc = require('@grpc/grpc-js');
const { connect, hash, signers } = require('@hyperledger/fabric-gateway');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { TextDecoder } = require('node:util');

// 导入 fabric-protos
let protos;
try {
    protos = require('fabric-protos');
} catch (error) {
    console.warn('[FabricMonitor] fabric-protos not available:', error.message);
    protos = null;
}

/**
 * 辅助函数：从环境变量获取值，如果不存在则使用默认值
 */
function envOrDefault(key, defaultValue) {
    return process.env[key] || defaultValue;
}

/**
 * 创建新的 gRPC 连接
 */
async function newGrpcConnection(endpoint, hostAlias, tlsCertPath) {
    const tlsCert = await fs.readFile(tlsCertPath);
    const tlsCredentials = grpc.credentials.createSsl(tlsCert);
    return new grpc.Client(endpoint, tlsCredentials, {
        'grpc.ssl_target_name_override': hostAlias,
    });
}

/**
 * 创建新的身份
 */
async function newIdentity(certDirPath, mspIdValue) {
    const certPath = await findFirstFile(certDirPath);
    const credentials = await fs.readFile(certPath);
    return { mspId: mspIdValue, credentials };
}

/**
 * 创建新的签名者
 */
async function newSigner(keyDirPath) {
    const keyPath = await findFirstFile(keyDirPath);
    const privateKeyPem = await fs.readFile(keyPath);
    const privateKey = crypto.createPrivateKey(privateKeyPem);
    return signers.newPrivateKeySigner(privateKey);
}

/**
 * 查找目录中的第一个文件
 */
async function findFirstFile(dirPath) {
    const files = await fs.readdir(dirPath);
    const file = files[0];
    if (!file) {
        throw new Error(`No files found in directory: ${dirPath}`);
    }
    return path.join(dirPath, file);
}

// ============================================================================
// 【可配置】Fabric 网络配置
// 这些值可以通过环境变量覆盖，也可以直接修改下面的默认值
// 注意：cryptoPath 指向 fabric-samples 中的证书目录，不在本项目内
// ============================================================================

const channelName = envOrDefault('CHANNEL_NAME', 'mychannel');
const chaincodeName = envOrDefault('CHAINCODE_NAME', 'basic');
const mspId = envOrDefault('MSP_ID', 'Org1MSP');

// 【可配置】fabric-samples 证书路径
// 如果您的 fabric-samples 在不同位置，请修改此路径或设置环境变量 FABRIC_CRYPTO_PATH
const cryptoPath = envOrDefault('FABRIC_CRYPTO_PATH', '/home/tr/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com');

// Path to user private key directory.
const keyDirectoryPath = envOrDefault(
    'KEY_DIRECTORY_PATH',
    path.resolve(
        cryptoPath,
        'users',
        'User1@org1.example.com',
        'msp',
        'keystore'
    )
);

// Path to user certificate directory.
const certDirectoryPath = envOrDefault(
    'CERT_DIRECTORY_PATH',
    path.resolve(
        cryptoPath,
        'users',
        'User1@org1.example.com',
        'msp',
        'signcerts'
    )
);

// Path to peer tls certificate.
const tlsCertPath = envOrDefault(
    'TLS_CERT_PATH',
    path.resolve(cryptoPath, 'peers', 'peer0.org1.example.com', 'tls', 'ca.crt')
);

// Gateway peer endpoint.
// 使用容器 IP 避免代理问题，或者确保运行时清除代理环境变量
const peerEndpoint = envOrDefault('PEER_ENDPOINT', 'localhost:7051');

// Gateway peer SSL host name override.
const peerHostAlias = envOrDefault('PEER_HOST_ALIAS', 'peer0.org1.example.com');

/**
 * displayInputParameters() will print the global scope parameters used by the main driver routine.
 */
function displayInputParameters() {
    console.log(`channelName:       ${channelName}`);
    console.log(`chaincodeName:     ${chaincodeName}`);
    console.log(`mspId:             ${mspId}`);
    console.log(`cryptoPath:        ${cryptoPath}`);
    console.log(`keyDirectoryPath:  ${keyDirectoryPath}`);
    console.log(`certDirectoryPath: ${certDirectoryPath}`);
    console.log(`tlsCertPath:       ${tlsCertPath}`);
    console.log(`peerEndpoint:      ${peerEndpoint}`);
    console.log(`peerHostAlias:     ${peerHostAlias}`);
}

class FabricMonitor extends EventEmitter {
    constructor(config) {
        super();
        this.config = config;
        this.gateway = null;
        this.network = null;
        this.contracts = {};
        this.latestBlockNumber = 0;
        this.isMonitoring = false;
        this.pollTimer = null;
    }
    
    /**
     * 初始化
     */
    async initialize() {
        console.log(`[FabricMonitor] Initializing monitor for ${this.config.chainId}`);
        displayInputParameters();

    // The gRPC client connection should be shared by all Gateway connections to this endpoint.
    this.client = await newGrpcConnection(peerEndpoint, peerHostAlias, tlsCertPath);

    this.gateway = connect({
        client: this.client,
        identity: await newIdentity(certDirectoryPath, mspId),
        signer: await newSigner(keyDirectoryPath),
        hash: hash.sha256,
        // Default timeouts for different gRPC calls 
        evaluateOptions: () => {return { deadline: Date.now() + 5000 };},     // 5 seconds
        endorseOptions: () => {return { deadline: Date.now() + 15000 }; },    // 15 seconds
        submitOptions: () => {return { deadline: Date.now() + 5000 }; },      // 5 seconds
        commitStatusOptions: () => {return { deadline: Date.now() + 60000 };},// 1 minute
    });
    this.network = await this.gateway.getNetwork(this.config.connection.channelName);
    // this.contracts.gateway = this.network.getContract(this.config.contracts.gateway);
    // this.contracts.lightClient = this.network.getContract(this.config.contracts.lightClient);


        // 获取起始区块
        if (this.config.monitoring.startBlock === 'latest') {
            // 获取最新区块号
            this.latestBlockNumber = 0; // 模拟
        } else {
            this.latestBlockNumber = parseInt(this.config.monitoring.startBlock);
        }
        
        console.log(`[FabricMonitor] Initialized, starting from block ${this.latestBlockNumber}`);
    }
    
    /**
     * 启动监听
     */
    async start() {
        if (this.isMonitoring) {
            return;
        }
        
        this.isMonitoring = true;
        console.log(`[FabricMonitor] Started monitoring ${this.config.chainId}`);
        
        // 注册区块监听器
        // TODO: 使用Fabric的事件监听
        // const listener = await this.network.addBlockListener(
        //     async (event) => {
        //         await this.handleBlockEvent(event);
        //     },
        //     { startBlock: this.latestBlockNumber }
        // );
        
        // 启动轮询作为备选
        this.pollTimer = setInterval(
            () => this.poll(),
            this.config.monitoring.pollInterval
        );
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
        
        // if (this.gateway) {
        //     await this.gateway.disconnect();
        // }
        
        console.log(`[FabricMonitor] Stopped monitoring ${this.config.chainId}`);
    }
    
    /**
     * 处理区块事件
     */
    async handleBlockEvent(event) {
        try {
            const blockNumber = event.blockNumber.toNumber();
            const block = event.blockData;
            
            // 触发新区块事件
            this.emit('newBlock', {
                number: blockNumber,
                header: block.header,
                data: block.data,
                metadata: block.metadata,
                channelId: this.config.connection.channelName
            });
            
            // 解析链码事件
            await this.parseBlockEvents(block, blockNumber);
            
            this.latestBlockNumber = blockNumber;
            
        } catch (error) {
            console.error(`[FabricMonitor] Error handling block event:`, error);
        }
    }
    
    /**
     * 轮询新区块
     */
    async poll() {
        if (!this.isMonitoring) {
            return;
        }
        
        try {
            // 获取区块高度（区块数量，最新区块号 = height - 1）
            const blockHeight = await this.getLatestBlockHeight();
            const latestBlockNum = Number(blockHeight) - 1;  // 转换为 Number，减 1 得到最新区块号
            
            console.log(`\n[FabricMonitor] Current height: ${blockHeight}, latest block: ${latestBlockNum}, processed up to: ${this.latestBlockNumber}`);
            
            for (let blockNum = this.latestBlockNumber + 1; blockNum <= latestBlockNum; blockNum++) {
                await this.processBlock(blockNum);
            }
            
            this.latestBlockNumber = latestBlockNum;
            
        } catch (error) {
            console.error(`[FabricMonitor] Error polling:`, error);
        }
    }
    
    /**
     * 获取最新区块高度
     */
    async getLatestBlockHeight() {
        try {
            const qscc_contract = this.network.getContract('qscc');
            const resultByte = await qscc_contract.evaluateTransaction('GetChainInfo', channelName);
            
            // 使用 fabric-protos 解析 BlockchainInfo
            if (protos && protos.common && protos.common.BlockchainInfo) {
                const info = protos.common.BlockchainInfo.decode(resultByte);
                return BigInt(info.height);
            }
            
            // 如果 fabric-protos 不可用，返回当前已知的最新区块号
            console.warn('[FabricMonitor] fabric-protos not available, using cached block number');
            return BigInt(this.latestBlockNumber || 0);
            
        } catch (error) {
            console.error(`[FabricMonitor] Error getting latest block height:`, error);
            // 如果获取失败，返回当前已知的最新区块号
            return BigInt(this.latestBlockNumber || 0);
        }
    }
    /**
     * 处理区块
     */
    async processBlock(blockNumber) {
        try {
            const block = await this.getBlock(blockNumber);
            
            // this.emit('newBlock', block);
            await this.parseBlockEvents(block, blockNumber);
            
        } catch (error) {
            console.error(`[FabricMonitor] Error processing block ${blockNumber}:`, error);
        }
    }
    
    /**
     * 获取区块
     */
    async getBlock(blockNumber) {
        try {
            const qscc = this.network.getContract('qscc');
            const blockBytes = await qscc.evaluateTransaction('GetBlockByNumber', channelName, String(blockNumber));
            
            // 使用 fabric-protos 解析区块
            if (protos && protos.common && protos.common.Block) {
                const block = protos.common.Block.decode(blockBytes);
                return block;
            }
            
            // 如果没有 protos，返回原始数据
            return { raw: blockBytes, number: blockNumber };
        } catch (error) {
            console.error(`[FabricMonitor] Error getting block ${blockNumber}:`, error);
            throw error;
        }
    }

    /**
     * 解析区块事件
     */
    async parseBlockEvents(block, blockNumber) {
        console.log(`[FabricMonitor] Parsing events from block ${blockNumber}`);
        
        // 如果没有 protos，无法解析
        if (!protos) {
            console.warn('[FabricMonitor] fabric-protos not available, cannot parse block events');
            return;
        }
        
        try {
            // 检查区块数据
            if (!block.data || !block.data.data) {
                console.log(`[FabricMonitor] Block ${blockNumber} has no transaction data`);
                return;
            }
            
            console.log(`[FabricMonitor] Block ${blockNumber} has ${block.data.data.length} transaction(s)`);
            
            // 遍历区块中的每个交易
            for (let i = 0; i < block.data.data.length; i++) {
                let txData = block.data.data[i];
                
                console.log(`[FabricMonitor] TX ${i} data type: ${txData.constructor.name}, length: ${txData.length || 'N/A'}`);
                
                try {
                    // 确保 txData 是 Buffer 或 Uint8Array
                    if (!(txData instanceof Buffer) && !(txData instanceof Uint8Array)) {
                        // 可能已经是解析过的对象
                        if (txData.payload) {
                            // 直接使用已解析的结构
                            await this.parseEnvelope(txData, blockNumber, i);
                            continue;
                        }
                        console.log(`[FabricMonitor] Skipping tx ${i}: unexpected data type ${typeof txData}`);
                        continue;
                    }
                    
                    // 解析 Envelope
                    const envelope = protos.common.Envelope.decode(txData);
                    await this.parseEnvelope(envelope, blockNumber, i);
                    
                } catch (txError) {
                    // 忽略非交易数据（如配置块）
                    if (blockNumber <= 2) {
                        // 前几个块通常是配置块，静默跳过
                        continue;
                    }
                    console.log(`[FabricMonitor] Error parsing tx ${i} in block ${blockNumber}: ${txError.message}`);
                }
            }
        } catch (error) {
            console.error(`[FabricMonitor] Error parsing block events:`, error);
        }
    }
    
    /**
     * 解析 Envelope
     */
    async parseEnvelope(envelope, blockNumber, txIndex) {
        try {
            console.log(`[FabricMonitor] parseEnvelope called for block ${blockNumber} tx ${txIndex}`);
            
            let payload;
            if (envelope.payload instanceof Uint8Array || envelope.payload instanceof Buffer) {
                payload = protos.common.Payload.decode(envelope.payload);
            } else {
                payload = envelope.payload;
            }
            
            console.log(`[FabricMonitor] Payload header:`, payload.header ? Object.keys(payload.header) : 'null');
            
            let channelHeader;
            // fabric-protos 可能使用 channel_header 而不是 channelHeader
            const chHeader = payload.header?.channelHeader || payload.header?.channel_header;
            
            if (chHeader) {
                if (chHeader instanceof Uint8Array || chHeader instanceof Buffer) {
                    channelHeader = protos.common.ChannelHeader.decode(chHeader);
                } else {
                    channelHeader = chHeader;
                }
            } else {
                console.log(`[FabricMonitor] No channel header found, header keys:`, payload.header ? JSON.stringify(Object.keys(payload.header)) : 'null');
                return;
            }
            
            console.log(`[FabricMonitor] Channel header type: ${channelHeader.type}`);
            
            // 只处理 ENDORSER_TRANSACTION 类型 (type = 3)
            if (channelHeader.type !== 3) {
                console.log(`[FabricMonitor] Not ENDORSER_TRANSACTION, skipping`);
                return;
            }
            
            const txId = channelHeader.txId || channelHeader.tx_id || 'unknown';
            console.log(`[FabricMonitor] Processing tx: ${txId.substring(0, 16)}... (type: ${channelHeader.type})`);
            console.log(`[FabricMonitor] ChannelHeader keys:`, Object.keys(channelHeader));
            
            // 解析交易
            let transaction;
            if (payload.data instanceof Uint8Array || payload.data instanceof Buffer) {
                transaction = protos.protos.Transaction.decode(payload.data);
            } else {
                transaction = payload.data;
            }
            
            console.log(`[FabricMonitor] Transaction keys:`, transaction ? Object.keys(transaction) : 'null');
            
            if (!transaction || !transaction.actions) {
                console.log(`[FabricMonitor] No actions in transaction`);
                return;
            }
            
            console.log(`[FabricMonitor] Found ${transaction.actions.length} action(s)`);
            
            for (const action of transaction.actions) {
                await this.parseAction(action, txId, blockNumber);
            }
        } catch (error) {
            console.error(`[FabricMonitor] parseEnvelope error:`, error.message);
            throw error;
        }
    }
    
    /**
     * 解析 Action
     */
    async parseAction(action, txId, blockNumber) {
        try {
            console.log(`[FabricMonitor] parseAction called, action keys:`, Object.keys(action));
            
            let chaincodeActionPayload;
            if (action.payload instanceof Uint8Array || action.payload instanceof Buffer) {
                chaincodeActionPayload = protos.protos.ChaincodeActionPayload.decode(action.payload);
            } else {
                chaincodeActionPayload = action.payload;
            }
            
            console.log(`[FabricMonitor] ChaincodeActionPayload keys:`, chaincodeActionPayload ? Object.keys(chaincodeActionPayload) : 'null');
            
            // 可能是下划线格式
            const ccAction = chaincodeActionPayload.action || chaincodeActionPayload.chaincode_action;
            
            if (!ccAction) {
                console.log(`[FabricMonitor] No action in ChaincodeActionPayload`);
                return;
            }
            
            const prp = ccAction.proposalResponsePayload || ccAction.proposal_response_payload;
            if (!prp) {
                console.log(`[FabricMonitor] No proposalResponsePayload`);
                return;
            }
            
            let proposalResponsePayload;
            if (prp instanceof Uint8Array || prp instanceof Buffer) {
                proposalResponsePayload = protos.protos.ProposalResponsePayload.decode(prp);
            } else {
                proposalResponsePayload = prp;
            }
            
            console.log(`[FabricMonitor] ProposalResponsePayload keys:`, proposalResponsePayload ? Object.keys(proposalResponsePayload) : 'null');
            
            let chaincodeAction;
            const ext = proposalResponsePayload.extension;
            if (ext instanceof Uint8Array || ext instanceof Buffer) {
                chaincodeAction = protos.protos.ChaincodeAction.decode(ext);
            } else {
                chaincodeAction = ext;
            }
            
            console.log(`[FabricMonitor] ChaincodeAction keys:`, chaincodeAction ? Object.keys(chaincodeAction) : 'null');
            
            // 检查是否有事件
            const events = chaincodeAction.events;
            if (events && events.length > 0) {
                console.log(`[FabricMonitor] Found events, length: ${events.length}`);
                let event;
                if (events instanceof Uint8Array || events instanceof Buffer) {
                    event = protos.protos.ChaincodeEvent.decode(events);
                } else {
                    event = events;
                }
                
                console.log(`[FabricMonitor] Event keys:`, Object.keys(event));
                
                // 支持下划线和驼峰命名
                const eventName = event.eventName || event.event_name;
                const chaincodeId = event.chaincodeId || event.chaincode_id;
                const eventPayloadBytes = event.payload;
                
                console.log(`[FabricMonitor] Found event: ${eventName} from chaincode: ${chaincodeId}`);
                
                if (eventName === 'CrossChainCall') {
                    // 解析事件 payload
                    const payloadStr = Buffer.from(eventPayloadBytes).toString('utf8');
                    console.log(`[FabricMonitor] Event payload:`, payloadStr);
                    const eventPayload = JSON.parse(payloadStr);
                    
                    console.log(`[FabricMonitor] 🎯 CrossChainCall event detected!`);
                    console.log(`  - Target Chain: ${eventPayload.targetChainId}`);
                    console.log(`  - Target Contract: ${eventPayload.targetContract}`);
                    console.log(`  - Target Function: ${eventPayload.targetFunction}`);
                    console.log(`  - Nonce: ${eventPayload.nonce}`);
                    
                    this.emit('crossChainEvent', {
                        txHash: txId,
                        blockNumber: blockNumber,
                        targetChainId: eventPayload.targetChainId,
                        targetContract: eventPayload.targetContract,
                        targetFunction: eventPayload.targetFunction,
                        payload: eventPayload.payload,
                        nonce: eventPayload.nonce
                    });
                }
            }
        } catch (error) {
            // 静默忽略解析错误
        }
    }
    
    /**
     * 提交区块头到LightClient链码
     */
    async submitBlockHeader(blockHeader) {
        try {
            const headerJSON = JSON.stringify(blockHeader);
            
            // TODO: 调用LightClient链码
            // await this.contracts.lightClient.submitTransaction(
            //     'SubmitBlockHeader',
            //     headerJSON
            // );
            
            console.log(`[FabricMonitor] Submitted block header: ${blockHeader.chainId} #${blockHeader.blockNumber}`);
            
        } catch (error) {
            console.error(`[FabricMonitor] Failed to submit block header:`, error);
            throw error;
        }
    }
    
    /**
     * 生成Merkle证明
     */
    async generateMerkleProof(blockNumber, txHash) {
        // TODO: 实现Merkle证明生成
        // Fabric的区块结构与以太坊不同，需要特殊处理
        
        return [];
    }
    
    isConnected() {
        return this.gateway !== null;
    }
    
    getLatestBlockNumber() {
        return this.latestBlockNumber;
    }
}

module.exports = { FabricMonitor };
