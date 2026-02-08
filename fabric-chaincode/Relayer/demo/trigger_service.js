const grpc = require('@grpc/grpc-js');
const { connect, signers, hash } = require('@hyperledger/fabric-gateway');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');
const { ethers } = require('ethers');

const execFileAsync = promisify(execFile);

class DemoTriggerService {
    constructor(config, eventStore) {
        this.config = config;
        this.eventStore = eventStore;
    }

    getFabricChain() {
        const chain = this.config.chains.find((item) => item.type === 'FABRIC' && item.enabled);
        if (!chain) {
            throw new Error('Fabric chain config not found');
        }
        return chain;
    }

    getFiscoChain() {
        const chain = this.config.chains.find((item) => item.type === 'FISCO_BCOS' && item.enabled);
        if (!chain) {
            throw new Error('FISCO chain config not found');
        }
        return chain;
    }

    resolveFabricUserMspPath(cryptoPath) {
        const candidates = [
            path.join(cryptoPath, 'users', 'User1@org1.example.com', 'msp'),
            path.join(cryptoPath, 'users', 'Admin@org1.example.com', 'msp')
        ];
        return candidates;
    }

    async createFabricGatewayConnection(fabricChain) {
        const connection = fabricChain.connection || {};
        const cryptoPath = path.resolve(
            connection.cryptoPath ||
            '/home/tr/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com'
        );
        const peerHostAlias = connection.peerHostAlias || 'peer0.org1.example.com';
        const peerEndpoint = connection.peerEndpoint || 'localhost:7051';
        const mspId = connection.mspId || 'Org1MSP';

        const tlsCertPath = path.join(cryptoPath, 'peers', peerHostAlias, 'tls', 'ca.crt');
        const tlsRootCert = await fs.readFile(tlsCertPath);

        let mspPath = null;
        for (const candidate of this.resolveFabricUserMspPath(cryptoPath)) {
            try {
                await fs.access(path.join(candidate, 'signcerts'));
                await fs.access(path.join(candidate, 'keystore'));
                mspPath = candidate;
                break;
            } catch (_error) {
                // Try next candidate.
            }
        }
        if (!mspPath) {
            throw new Error('No available Fabric MSP user credentials found');
        }

        const certFiles = await fs.readdir(path.join(mspPath, 'signcerts'));
        if (!certFiles.length) {
            throw new Error('Fabric signcerts directory is empty');
        }
        const keyFiles = await fs.readdir(path.join(mspPath, 'keystore'));
        if (!keyFiles.length) {
            throw new Error('Fabric keystore directory is empty');
        }

        const credentials = await fs.readFile(path.join(mspPath, 'signcerts', certFiles[0]));
        const privateKeyPem = await fs.readFile(path.join(mspPath, 'keystore', keyFiles[0]));
        const privateKey = crypto.createPrivateKey(privateKeyPem);

        const tlsCredentials = grpc.credentials.createSsl(tlsRootCert);
        const client = new grpc.Client(peerEndpoint, tlsCredentials, {
            'grpc.ssl_target_name_override': peerHostAlias,
            'grpc.default_authority': peerHostAlias
        });

        const gateway = connect({
            client,
            identity: { mspId, credentials },
            signer: signers.newPrivateKeySigner(privateKey),
            hash: hash.sha256
        });

        return { gateway, client };
    }

    async withFabricGatewayContract(handler) {
        const fabricChain = this.getFabricChain();
        const channelName = fabricChain.connection?.channelName || 'mychannel';
        const chaincodeName = fabricChain.contracts?.gateway || 'gateway_cc';
        const { gateway, client } = await this.createFabricGatewayConnection(fabricChain);
        try {
            const network = gateway.getNetwork(channelName);
            const contract = network.getContract(chaincodeName);
            return await handler(contract, { fabricChain, channelName, chaincodeName });
        } finally {
            gateway.close();
            client.close();
        }
    }

    async putOrchardRecord(orchardBatchId, payload) {
        const batchId = String(orchardBatchId || '').trim();
        if (!batchId) {
            throw new Error('orchardBatchId is required');
        }
        const payloadJson = JSON.stringify(payload || {});
        await this.withFabricGatewayContract(async (contract) => {
            await contract.submitTransaction('PutOrchardRecord', batchId, payloadJson);
        });
        return null;
    }

    async getOrchardRecord(orchardBatchId) {
        const batchId = String(orchardBatchId || '').trim();
        if (!batchId) {
            throw new Error('orchardBatchId is required');
        }

        const output = await this.withFabricGatewayContract(async (contract) => {
            const raw = await contract.evaluateTransaction('GetOrchardRecord', batchId);
            return Buffer.from(raw).toString('utf8');
        });

        return JSON.parse(output);
    }

    async listOrchardRecords(limit = 20, bookmark = '') {
        const parsedLimit = Number.parseInt(limit, 10);
        const finalLimit = Number.isNaN(parsedLimit) ? 20 : Math.max(1, Math.min(100, parsedLimit));
        const text = await this.withFabricGatewayContract(async (contract) => {
            const raw = await contract.evaluateTransaction(
                'ListOrchardRecords',
                String(finalLimit),
                String(bookmark || '')
            );
            return Buffer.from(raw).toString('utf8');
        });
        return JSON.parse(text);
    }

    normalizePayload(payload) {
        if (payload === undefined || payload === null) {
            return JSON.stringify({
                message: 'Demo payload',
                timestamp: Date.now()
            });
        }
        if (typeof payload === 'string') {
            return payload;
        }
        return JSON.stringify(payload);
    }

    createCorrelationId() {
        if (typeof crypto.randomUUID === 'function') {
            return crypto.randomUUID();
        }
        return `corr_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
    }

    createPayloadHash(payloadText) {
        return crypto.createHash('sha256').update(String(payloadText), 'utf8').digest('hex');
    }

    createPayloadPreview(payloadText, limit = 180) {
        const raw = String(payloadText || '');
        return raw.length > limit ? `${raw.slice(0, limit)}...` : raw;
    }

    async triggerFabricToFisco(payload) {
        const fabricChain = this.getFabricChain();
        const fiscoChain = this.getFiscoChain();

        const payloadStr = this.normalizePayload(payload);
        const correlationId = this.createCorrelationId();
        const sourcePayloadHash = this.createPayloadHash(payloadStr);
        const payloadPreview = this.createPayloadPreview(payloadStr);
        const channelName = fabricChain.connection?.channelName || 'mychannel';
        const chaincodeName = fabricChain.contracts?.gateway || 'gateway_cc';
        const targetChainId = fiscoChain.chainId;
        const targetContract = fiscoChain.contracts?.gateway;
        const targetFunction = fiscoChain.receiveMethod || 'receiveLite';

        if (!targetContract) {
            throw new Error('FISCO gateway contract is not configured');
        }

        this.eventStore.addEvent({
            type: 'trigger',
            direction: 'FABRIC_TO_FISCO',
            relayState: 'TRIGGERED',
            message: 'Fabric trigger requested',
            correlationId,
            sourcePayloadHash,
            data: {
                channelName,
                chaincodeName,
                targetContract,
                targetFunction,
                sourceChainId: fabricChain.chainId,
                targetChainId,
                payloadPreview
            }
        });

        const { gateway, client } = await this.createFabricGatewayConnection(fabricChain);
        try {
            const network = gateway.getNetwork(channelName);
            const contract = network.getContract(chaincodeName);
            const raw = await contract.submitTransaction(
                'Send',
                targetChainId,
                targetContract,
                targetFunction,
                payloadStr
            );
            const responseText = Buffer.from(raw).toString('utf8');

            let parsed = null;
            try {
                parsed = JSON.parse(responseText);
            } catch (_error) {
                // Keep raw output only.
            }

            this.eventStore.addEvent({
                type: 'trigger',
                direction: 'FABRIC_TO_FISCO',
                relayState: 'OBSERVED',
                message: 'Fabric trigger transaction submitted',
                correlationId,
                sourcePayloadHash,
                sourceTxHash: parsed?.txId || null,
                data: {
                    txId: parsed?.txId || null,
                    sourceChainId: fabricChain.chainId,
                    targetChainId
                }
            });

            return {
                success: true,
                direction: 'FABRIC_TO_FISCO',
                correlationId,
                sourcePayloadHash,
                txId: parsed?.txId || null,
                output: parsed || responseText
            };
        } finally {
            gateway.close();
            client.close();
        }
    }

    resolveFiscoConsoleDir(fiscoChain) {
        return process.env.FISCO_CONSOLE_DIR ||
            fiscoChain.consoleDir ||
            path.resolve(__dirname, '../../../fisco-bcos/console');
    }

    mapFiscoStatus(outputText) {
        const statusMatch = outputText.match(/transaction status:\s*(\d+)/i);
        if (!statusMatch) {
            return null;
        }
        return Number(statusMatch[1]);
    }

    async triggerFiscoToFabric(payload) {
        const fabricChain = this.getFabricChain();
        const fiscoChain = this.getFiscoChain();

        const channelName = fabricChain.connection?.channelName || 'mychannel';
        const chaincodeName = fabricChain.contracts?.gateway || 'gateway_cc';
        const gatewayAddress = fiscoChain.contracts?.gateway;
        const gatewayName = fiscoChain.contracts?.gatewayName || 'GatewayAir';

        if (!gatewayAddress) {
            throw new Error('FISCO gateway contract is not configured');
        }

        const payloadStr = this.normalizePayload(payload);
        const correlationId = this.createCorrelationId();
        const sourcePayloadHash = this.createPayloadHash(payloadStr);
        const payloadPreview = this.createPayloadPreview(payloadStr);
        const payloadHex = ethers.hexlify(Buffer.from(payloadStr, 'utf8'));
        const consoleDir = this.resolveFiscoConsoleDir(fiscoChain);
        const consolePath = path.resolve(consoleDir, 'console.sh');

        const args = [
            'call',
            gatewayName,
            gatewayAddress,
            'send',
            `"${fabricChain.chainId}"`,
            `"${channelName}/${chaincodeName}"`,
            '"Receive"',
            payloadHex
        ];

        this.eventStore.addEvent({
            type: 'trigger',
            direction: 'FISCO_TO_FABRIC',
            relayState: 'TRIGGERED',
            message: 'FISCO trigger requested',
            correlationId,
            sourcePayloadHash,
            data: {
                gatewayAddress,
                gatewayName,
                sourceChainId: fiscoChain.chainId,
                targetChainId: fabricChain.chainId,
                payloadPreview
            }
        });

        const { stdout, stderr } = await execFileAsync(consolePath, args, {
            cwd: consoleDir,
            timeout: 60_000
        });
        const outputText = `${stdout || ''}${stderr || ''}`.trim();
        const status = this.mapFiscoStatus(outputText);
        if (status !== 0) {
            throw new Error(`FISCO send failed, status=${status === null ? 'unknown' : status}`);
        }

        const txHashMatch = outputText.match(/transaction hash:\s*(0x[0-9a-fA-F]+)/i);
        const txHash = txHashMatch ? txHashMatch[1] : null;

        this.eventStore.addEvent({
            type: 'trigger',
            direction: 'FISCO_TO_FABRIC',
            relayState: 'OBSERVED',
            message: 'FISCO trigger transaction submitted',
            correlationId,
            sourcePayloadHash,
            sourceTxHash: txHash,
            data: {
                txHash,
                sourceChainId: fiscoChain.chainId,
                targetChainId: fabricChain.chainId
            }
        });

        return {
            success: true,
            direction: 'FISCO_TO_FABRIC',
            correlationId,
            sourcePayloadHash,
            txHash,
            output: outputText
        };
    }

    async triggerOrchardQueryRequest(queryId, orchardBatchId) {
        const payload = {
            payloadVersion: '1.0',
            messageType: 'ORCHARD_QUERY_REQUEST',
            queryId,
            orchardBatchId,
            requestTs: new Date().toISOString(),
            requestedBy: 'FISCO_NET_01'
        };
        return this.triggerFiscoToFabric(payload);
    }

    async triggerOrchardQueryResponse({
        queryId,
        orchardBatchId,
        found,
        result
    }) {
        const payload = {
            payloadVersion: '1.0',
            messageType: 'ORCHARD_QUERY_RESPONSE',
            queryId,
            orchardBatchId,
            found: Boolean(found),
            result: found ? (result ?? null) : null,
            responseTs: new Date().toISOString()
        };
        return this.triggerFabricToFisco(payload);
    }
}

module.exports = { DemoTriggerService };
