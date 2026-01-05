'use strict';

const grpc = require('@grpc/grpc-js');
const { connect, hash, signers } = require('@hyperledger/fabric-gateway');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { TextDecoder } = require('node:util');

const channelName = process.env.CHANNEL_NAME || 'mychannel';
const chaincodeName = process.env.CHAINCODE_NAME || 'crosschain_cc';
const mspId = process.env.MSP_ID || 'Org1MSP';

// Path to crypto materials.
const cryptoPath = process.env.CRYPTO_PATH || '/root/czs/fabric/fabric-samples-main/test-network/organizations/peerOrganizations/org1.example.com';

// Path to user private key directory.
// const keyDirectoryPath = process.env.KEY_DIRECTORY_PATH || path.resolve(
//     cryptoPath,
//     'users',
//     'User1@org1.example.com',
//     'msp',
//     'keystore'
// );
const keyDirectoryPath = path.resolve(cryptoPath, 'users', 'Admin@org1.example.com', 'msp', 'keystore');
const certDirectoryPath = path.resolve(cryptoPath, 'users', 'Admin@org1.example.com', 'msp', 'signcerts');
// Path to user certificate directory.
// const certDirectoryPath = process.env.CERT_DIRECTORY_PATH || path.resolve(
//     cryptoPath,
//     'users',
//     'User1@org1.example.com',
//     'msp',
//     'signcerts'
// );

// Path to peer tls certificate.
const tlsCertPath = process.env.TLS_CERT_PATH || path.resolve(
    cryptoPath,
    'peers',
    'peer0.org1.example.com',
    'tls',
    'ca.crt'
);

// Gateway peer endpoint.
const peerEndpoint = process.env.PEER_ENDPOINT || 'localhost:7051';

// Gateway peer SSL host name override.
const peerHostAlias = process.env.PEER_HOST_ALIAS || 'peer0.org1.example.com';

const utf8Decoder = new TextDecoder();

async function newGrpcConnection() {
    const tlsRootCert = await fs.readFile(tlsCertPath);
    const tlsCredentials = grpc.credentials.createSsl(tlsRootCert);
    return new grpc.Client(peerEndpoint, tlsCredentials, {
        'grpc.ssl_target_name_override': peerHostAlias,
    });
}

async function newIdentity() {
    const certPath = await getFirstDirFileName(certDirectoryPath);
    const credentials = await fs.readFile(certPath);
    return { mspId, credentials };
}

async function getFirstDirFileName(dirPath) {
    const files = await fs.readdir(dirPath);
    const file = files[0];
    if (!file) {
        throw new Error(`No files in directory: ${dirPath}`);
    }
    return path.join(dirPath, file);
}

async function newSigner() {
    const keyPath = await getFirstDirFileName(keyDirectoryPath);
    const privateKeyPem = await fs.readFile(keyPath);
    const privateKey = crypto.createPrivateKey(privateKeyPem);
    return signers.newPrivateKeySigner(privateKey);
}

function envOrDefault(key, defaultValue) {
    return process.env[key] || defaultValue;
}

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

async function main() {
    displayInputParameters();

    // The gRPC client connection should be shared by all Gateway connections to this endpoint.
    const client = await newGrpcConnection();

    const gateway = connect({
        client,
        identity: await newIdentity(),
        signer: await newSigner(),
        hash: hash.sha256,
        // Default timeouts for different gRPC calls 
        evaluateOptions: () => { return { deadline: Date.now() + 5000 }; },     // 5 seconds
        endorseOptions: () => { return { deadline: Date.now() + 15000 }; },    // 15 seconds
        submitOptions: () => { return { deadline: Date.now() + 5000 }; },      // 5 seconds
        commitStatusOptions: () => { return { deadline: Date.now() + 60000 }; },// 1 minute
    });

    try {
        const network = gateway.getNetwork(channelName);
        console.log('开始监听 CrossChainCall 事件...');
        const events = await network.getChaincodeEvents(chaincodeName); // 不指定startBlock
        // 处理事件流
        (async () => {
            try {
                for await (const event of events) {
                    // 检查事件名称
                    console.log('收到事件:', event.eventName, 'payload:', utf8Decoder.decode(event.payload));
                    if (event.eventName === 'CrossChainCall') {
                        const payload = utf8Decoder.decode(event.payload);
                        console.log(`收到事件 CrossChainCall, payload: ${payload}`);
                    }
                }
            } catch (error) {
                console.error('事件监听错误:', error);
            }
        })();

        // 保持进程运行
        console.log('事件监听已启动，等待事件...');
        process.stdin.resume();
        
        // 处理进程退出
        process.on('SIGINT', async () => {
            console.log('\n正在关闭连接...');
            events.close();
            gateway.close();
            client.close();
            process.exit(0);
        });

    } catch (error) {
        console.error('监听失败:', error);
        gateway.close();
        client.close();
        process.exit(1);
    }
}

main().catch((error) => {
    console.error('******** FAILED to run the application:', error);
    process.exitCode = 1;
});
