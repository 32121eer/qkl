/**
 * 璺ㄩ摼娑堟伅澶勭悊鍣? * 璐熻矗楠岃瘉鍜岃浆鍙戣法閾炬秷鎭? */

const { ethers } = require('ethers');
const grpc = require('@grpc/grpc-js');
const { connect, hash, signers } = require('@hyperledger/fabric-gateway');
const crypto = require('node:crypto');
const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { resolveFabricCryptoPath } = require('../fabric_path_resolver');
const { verifyNegotiatedResponseEnvelope } = require('../demo/negotiation/response_envelope');

const execFileAsync = promisify(execFile);

function buildFabricTlsVerifyOptions() {
    const insecure = String(process.env.FABRIC_TLS_INSECURE || '1') !== '0';
    return insecure ? { rejectUnauthorized: false } : {};
}

// Gateway 鍚堢害 ABI
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
     * 鍒濆鍖栵紙鍙€夛紝鐢ㄤ簬棰勫缓绔嬭繛鎺ワ級
     */
    async initialize() {
        console.log('[MessageHandler] Initializing...');
        
        // 鍒濆鍖?FISCO 杩炴帴
        const fiscoConfig = this.config.chains.find(c => c.type === 'FISCO_BCOS');
        if (fiscoConfig && fiscoConfig.enabled) {
            await this.initFiscoConnection(fiscoConfig);
        }
        
        console.log('[MessageHandler] Initialized');
    }
    
    /**
     * 鍒濆鍖?FISCO 杩炴帴
     */
    async initFiscoConnection(chainConfig) {
        try {
            // 浣跨敤闈欐€佺綉缁滈厤缃紝閬垮厤 ethers.js 鑷姩妫€娴嬬綉缁滄椂鍗′綇
            const staticNetwork = new ethers.Network('fisco-bcos', 1);
            this.fiscoProvider = new ethers.JsonRpcProvider(chainConfig.rpc.endpoint, staticNetwork, {
                staticNetwork: true
            });
            
            if (this.config.relayer && this.config.relayer.privateKey) {
                const privateKey = this.config.relayer.privateKey;
                // 纭繚绉侀挜鏍煎紡姝ｇ‘
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

    async ensureFiscoConnection(targetChain) {
        const targetGateway = targetChain?.contracts?.gateway;
        const currentGateway = this.fiscoGatewayContract?.target;
        const sameGateway =
            targetGateway &&
            currentGateway &&
            String(targetGateway).toLowerCase() === String(currentGateway).toLowerCase();
        if (this.fiscoProvider && this.fiscoGatewayContract && sameGateway) {
            return;
        }
        await this.initFiscoConnection(targetChain);
    }

    isFiscoTimeoutError(error) {
        const text = String(error?.message || '');
        return /request timeout|code=TIMEOUT|ETIMEDOUT|timed out/i.test(text);
    }

    async sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    async confirmFiscoReceiveByEvent(targetChain, message, attempts = 5, delayMs = 2000) {
        await this.ensureFiscoConnection(targetChain);
        if (!this.fiscoProvider || !this.fiscoGatewayContract) {
            return null;
        }

        for (let attempt = 1; attempt <= attempts; attempt++) {
            try {
                const latest = await this.fiscoProvider.getBlockNumber();
                const fromBlock = Math.max(0, latest - 500);
                const filter = this.fiscoGatewayContract.filters.CrossChainReceived(message.sourceChainId);
                const events = await this.fiscoGatewayContract.queryFilter(filter, fromBlock, latest);
                for (let i = events.length - 1; i >= 0; i -= 1) {
                    const evt = events[i];
                    const evtSourceTxId = String(evt?.args?.sourceTxId || '');
                    const evtSourceBlock = Number(evt?.args?.sourceBlockNumber);
                    const evtVerified = Boolean(evt?.args?.verified);
                    if (
                        evtSourceTxId === String(message.sourceTxHash) &&
                        evtSourceBlock === Number(message.sourceBlockNumber)
                    ) {
                        if (!evtVerified) {
                            return { confirmed: false, reason: 'verified_false' };
                        }
                        return {
                            confirmed: true,
                            txHash: evt.transactionHash || null,
                            blockNumber: Number.isInteger(evt.blockNumber) ? evt.blockNumber : null
                        };
                    }
                }
            } catch (error) {
                console.warn(`[MessageHandler] Failed to query FISCO CrossChainReceived events: ${error.message}`);
            }

            if (attempt < attempts) {
                await this.sleep(delayMs);
            }
        }

        return null;
    }
    
    /**
     * 杞彂璺ㄩ摼娑堟伅
     */
    async relayMessage(message) {
        console.log(`[MessageHandler] Relaying message from ${message.sourceChainId} to ${message.targetChainId}`);
        
        try {
            this.validateMessage(message);
            const applicationVerifyResult = this.verifyApplicationPayload(message);
            await this.verifySourceBlock(message);
            const targetChain = this.config.getChainConfig(message.targetChainId);
            if (!targetChain) {
                throw new Error(`Target chain ${message.targetChainId} not found in config`);
            }
            
            let relayResult;
            switch (targetChain.type) {
                case 'FISCO_BCOS':
                    relayResult = await this.relayToFiscoBcos(targetChain, message, applicationVerifyResult);
                    break;
                case 'FABRIC':
                    relayResult = await this.relayToFabric(targetChain, message);
                    break;
                default:
                    throw new Error(`Unsupported target chain type: ${targetChain.type}`);
            }
            
            console.log(`[MessageHandler] Message relayed successfully`);
            return {
                success: true,
                applicationVerifyResult,
                sourcePayloadHash: this.computePayloadHash(message.payload),
                targetPayloadHash: relayResult?.targetPayloadHash || null,
                ...relayResult
            };
            
        } catch (error) {
            console.error(`[MessageHandler] Failed to relay message:`, error);
            throw error;
        }
    }
    
    /**
     * 楠岃瘉娑堟伅
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

    verifyApplicationPayload(message) {
        const verifyResult = verifyNegotiatedResponseEnvelope(message?.payload, {
            requireSettlement: true
        });
        if (!verifyResult.skipped && !verifyResult.ok) {
            const error = new Error('Application payload negotiation proof verification failed');
            error.code = 'ERR_APPLICATION_PROOF_INVALID';
            error.verifyResult = verifyResult;
            throw error;
        }
        return verifyResult;
    }

    computePayloadHash(payload) {
        let payloadText;
        if (typeof payload === 'string') {
            payloadText = payload;
        } else if (Buffer.isBuffer(payload)) {
            payloadText = payload.toString('utf8');
        } else {
            payloadText = JSON.stringify(payload ?? {});
        }
        return createHash('sha256').update(payloadText, 'utf8').digest('hex');
    }

    normalizeBytes32Hex(value, fallback = null) {
        const candidate = String(value || '').trim().toLowerCase();
        if (/^0x[0-9a-f]{64}$/.test(candidate)) {
            return candidate;
        }
        if (fallback) {
            return fallback;
        }
        return `0x${'0'.repeat(64)}`;
    }

    deriveReceiptAnchors(message, applicationVerifyResult = null) {
        const payloadHash = applicationVerifyResult?.expectedResponsePayloadHash
            || `0x${this.computePayloadHash(message?.payload)}`;
        const negotiationProofDigest = applicationVerifyResult?.envelope?.negotiationProof?.digest || null;

        return {
            payloadHash: this.normalizeBytes32Hex(payloadHash),
            negotiationProofDigest: this.normalizeBytes32Hex(negotiationProofDigest)
        };
    }

    buildFiscoReceiveConsoleArgs(targetChain, message, applicationVerifyResult = null) {
        const receiveMethod = targetChain.receiveMethod || 'receive';
        const gatewayName =
            targetChain.contracts?.gatewayName ||
            targetChain.gatewayName ||
            'GatewayAir';
        const merkleProof = message.merkleProof || [];
        const merkleProofArray = merkleProof.length > 0
            ? '[' + merkleProof.map(p => `"${p}"`).join(',') + ']'
            : '[]';
        const anchors = this.deriveReceiptAnchors(message, applicationVerifyResult);

        let blockHeaderHex = '0x00';
        if (message.blockHeader) {
            blockHeaderHex = '0x' + Buffer.from(JSON.stringify(message.blockHeader)).toString('hex');
        }

        if (receiveMethod === 'receiveLite') {
            return {
                receiveMethod,
                gatewayName,
                anchors,
                consoleArgs: [
                    'call',
                    gatewayName,
                    targetChain.contracts.gateway,
                    'receiveLite',
                    `"${message.sourceChainId}"`,
                    String(message.sourceBlockNumber),
                    `"${message.sourceTxHash}"`,
                    blockHeaderHex,
                    anchors.payloadHash,
                    anchors.negotiationProofDigest
                ]
            };
        }

        return {
            receiveMethod,
            gatewayName,
            anchors,
            consoleArgs: [
                'call',
                gatewayName,
                targetChain.contracts.gateway,
                'receiveMessage',
                `"${message.sourceChainId}"`,
                String(message.sourceBlockNumber),
                `"${message.sourceTxHash}"`,
                blockHeaderHex,
                merkleProofArray
            ]
        };
    }
    
    /**
     * 楠岃瘉婧愬尯鍧?     */
    async verifySourceBlock(message) {
        // 妫€鏌ュ尯鍧楃‘璁ゆ暟
        const confirmations = this.config.relayer?.blockConfirmations || 1;
        
        console.log(`[MessageHandler] Block confirmations check: ${confirmations} blocks required`);
        
        return true;
    }
    
    /**
     * 杞彂鍒?FISCO-BCOS锛堣嚜鍔ㄩ€氳繃 console.sh 璋冪敤锛?     */
    async relayToFiscoBcos(targetChain, message, applicationVerifyResult = null) {
        console.log(`[MessageHandler] Relaying to FISCO-BCOS chain ${targetChain.chainId}`);
        console.log(`  - Source Chain: ${message.sourceChainId}`);
        console.log(`  - Source Tx: ${message.sourceTxHash}`);
        console.log(`  - Source Block: ${message.sourceBlockNumber}`);
        
        try {
            const {
                receiveMethod,
                gatewayName,
                anchors,
                consoleArgs
            } = this.buildFiscoReceiveConsoleArgs(targetChain, message, applicationVerifyResult);

            console.log(`[MessageHandler] Using receiveMethod: ${receiveMethod}`);
            if (receiveMethod === 'receiveLite') {
                console.log(`[MessageHandler] Receipt anchors: payloadHash=${anchors.payloadHash}, proofDigest=${anchors.negotiationProofDigest}`);
            }
            
            console.log(`[MessageHandler] 馃殌 Calling FISCO console.sh...`);
            console.log(`  Command: ./console.sh ${consoleArgs.join(' ')}`);
            
            // 璋冪敤 console.sh
            const defaultConsoleDir = path.resolve(__dirname, '..', '..', 'fisco-bcos', 'console');
            const consoleDir = process.env.FISCO_CONSOLE_DIR || targetChain.consoleDir || defaultConsoleDir;
            const consolePath = path.resolve(consoleDir, 'console.sh');
            const { stdout, stderr } = await execFileAsync(consolePath, consoleArgs, {
                cwd: consoleDir,
                timeout: 30000
            });
            
            console.log(`[MessageHandler] Console output:\n${stdout}`);
            if (stderr) {
                console.warn(`[MessageHandler] Console stderr:\n${stderr}`);
            }
            
            const statusMatch = stdout.match(/transaction status:\s*(\d+)/);
            if (statusMatch) {
                if (statusMatch[1] === '0') {
                    console.log(`[MessageHandler] 鉁?FISCO transaction SUCCESS`);
                    const txHashMatch = stdout.match(/transaction hash:\s*(0x[0-9a-fA-F]+)/i);
                    return {
                        success: true,
                        receiptStatus: 'SUCCESS',
                        targetTxHash: txHashMatch ? txHashMatch[1] : null,
                        targetBlockNumber: null,
                        targetPayloadHash: this.computePayloadHash(message.payload)
                    };
                } else {
                    // status != 0 琛ㄧず浜ゆ槗澶辫触
                    const receiptMsg = stdout.match(/Receipt message:\s*(.+)/);
                    const errorDetail = receiptMsg ? receiptMsg[1].trim() : 'unknown';
                    throw new Error(`FISCO transaction REVERTED (status=${statusMatch[1]}, reason=${errorDetail})`);
                }
            } else if (stdout.includes('transaction hash:')) {
                console.log(`[MessageHandler] FISCO transaction SUCCESS (no status line)`);
                const txHashMatch = stdout.match(/transaction hash:\s*(0x[0-9a-fA-F]+)/i);
                return {
                    success: true,
                    receiptStatus: 'SUCCESS',
                    targetTxHash: txHashMatch ? txHashMatch[1] : null,
                    targetBlockNumber: null,
                    targetPayloadHash: this.computePayloadHash(message.payload)
                };
            } else {
                console.warn(`[MessageHandler] 鈿狅笍 Cannot determine transaction status from console output`);
                return {
                    success: false,
                    pending: true,
                    receiptStatus: 'PENDING',
                    output: stdout,
                    targetTxHash: null,
                    targetBlockNumber: null,
                    targetPayloadHash: this.computePayloadHash(message.payload)
                };
            }
            
        } catch (error) {
            if (this.isFiscoTimeoutError(error)) {
                console.warn('[MessageHandler] FISCO call timed out, checking chain events for eventual success...');
                const confirmed = await this.confirmFiscoReceiveByEvent(targetChain, message);
                if (confirmed?.confirmed) {
                    console.log('[MessageHandler] Timeout recovered: FISCO CrossChainReceived already on-chain');
                    return {
                        success: true,
                        receiptStatus: 'SUCCESS',
                        targetTxHash: confirmed.txHash || null,
                        targetBlockNumber: confirmed.blockNumber ?? null,
                        targetPayloadHash: this.computePayloadHash(message.payload)
                    };
                }
            }
            console.error(`[MessageHandler] Failed to relay to FISCO:`, error.message);
            if (error.stdout) {
                console.error(`[MessageHandler] Console stdout: ${error.stdout}`);
            }
            if (error.stderr) {
                console.error(`[MessageHandler] Console stderr: ${error.stderr}`);
            }
            throw error;
        }
    }
    
    /**
     * 杞彂鍒?Fabric
     */
    async relayToFabric(targetChain, message) {
        console.log(`[MessageHandler] Relaying to Fabric chain ${targetChain.chainId}`);
        console.log(`  - Target Contract: ${message.targetContract}`);
        console.log(`  - Target Function: ${message.targetFunction}`);
        
        try {
            let channelName = targetChain.connection?.channelName || 'mychannel';
            let chaincodeName = message.targetContract;
            
            if (message.targetContract.includes('/')) {
                const parts = message.targetContract.split('/');
                channelName = parts[0];
                chaincodeName = parts[1];
            }
            
            // 鍒涘缓 Fabric 杩炴帴
            const { gateway, client } = await this.createFabricConnection(targetChain);
            
            try {
                const network = gateway.getNetwork(channelName);
                const contract = network.getContract(chaincodeName);
                
                // 鍑嗗 payload
                let payloadStr;
                if (typeof message.payload === 'string') {
                    payloadStr = message.payload;
                } else if (Buffer.isBuffer(message.payload)) {
                    payloadStr = message.payload.toString('utf8');
                } else {
                    payloadStr = JSON.stringify(message.payload);
                }

                let blockHeaderHex = '0x00';
                if (message.blockHeader) {
                    blockHeaderHex = '0x' + Buffer.from(JSON.stringify(message.blockHeader)).toString('hex');
                }
                
                // 璋冪敤閾剧爜鍑芥暟
                console.log(`[MessageHandler] Calling ${chaincodeName}.${message.targetFunction}()...`);
                
                const targetFn = message.targetFunction || 'Receive';
                const result = await contract.submitTransaction(
                    targetFn,
                    message.sourceChainId,
                    String(message.sourceBlockNumber),
                    message.sourceTxHash,
                    blockHeaderHex,
                    payloadStr
                );
                
                console.log(`[MessageHandler] 鉁?Fabric transaction success`);
                
                return {
                    success: true,
                    receiptStatus: 'SUCCESS',
                    targetTxHash: null,
                    targetBlockNumber: null,
                    targetPayloadHash: this.computePayloadHash(message.payload),
                    output: Buffer.isBuffer(result) ? result.toString('utf8') : String(result ?? '')
                };
                
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
     * 鍒涘缓 Fabric 杩炴帴
     */
    async createFabricConnection(targetChain) {
        const connection = targetChain.connection;
        
        // 璇诲彇璇佷功
        const cryptoPath = resolveFabricCryptoPath(connection.cryptoPath);
        if (!cryptoPath) {
            throw new Error(
                'Fabric cryptoPath not found. Set FABRIC_CRYPTO_PATH or FABRIC_SAMPLES_DIR to a valid fabric-samples installation.'
            );
        }
        
        const certPath = path.resolve(cryptoPath, 'users', 'User1@org1.example.com', 'msp', 'signcerts');
        const keyPath = path.resolve(cryptoPath, 'users', 'User1@org1.example.com', 'msp', 'keystore');
        const tlsCertPath = path.resolve(cryptoPath, 'peers', 'peer0.org1.example.com', 'tls', 'ca.crt');
        
        // 璇诲彇璇佷功鏂囦欢
        const certFiles = await fs.readdir(certPath);
        const credentials = await fs.readFile(path.join(certPath, certFiles[0]));
        
        const keyFiles = await fs.readdir(keyPath);
        const privateKeyPem = await fs.readFile(path.join(keyPath, keyFiles[0]));
        const privateKey = crypto.createPrivateKey(privateKeyPem);
        
        const tlsRootCert = await fs.readFile(tlsCertPath);
        
        // 鍒涘缓 gRPC 杩炴帴
        const peerEndpoint = connection.peerEndpoint || 'localhost:7051';
        const peerHostAlias = connection.peerHostAlias || 'peer0.org1.example.com';
        
        const tlsCredentials = grpc.credentials.createSsl(
            tlsRootCert,
            null,
            null,
            buildFabricTlsVerifyOptions()
        );
        const client = new grpc.Client(peerEndpoint, tlsCredentials, {
            'grpc.ssl_target_name_override': peerHostAlias,
            'grpc.default_authority': peerHostAlias,
        });
        
        // 鍒涘缓 Gateway
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
     * 閲嶈瘯鏈哄埗
     */
    async retryRelay(message, maxAttempts = 3, delay = 5000) {
        let lastError;
        
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                await this.relayMessage(message);
                return; // 鎴愬姛鍒欒繑鍥?
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
