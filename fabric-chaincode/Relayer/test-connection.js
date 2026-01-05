#!/usr/bin/env node

/**
 * 测试 Fabric 连接
 */

const grpc = require('@grpc/grpc-js');
const { connect, hash, signers } = require('@hyperledger/fabric-gateway');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const cryptoPath = '/home/tr/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com';
const mspId = 'Org1MSP';
const channelName = 'mychannel';
const peerEndpoint = '172.18.0.4:7051';  // 直接用容器 IP
const peerHostAlias = 'peer0.org1.example.com';

const keyDirectoryPath = path.resolve(cryptoPath, 'users', 'User1@org1.example.com', 'msp', 'keystore');
const certDirectoryPath = path.resolve(cryptoPath, 'users', 'User1@org1.example.com', 'msp', 'signcerts');
const tlsCertPath = path.resolve(cryptoPath, 'peers', 'peer0.org1.example.com', 'tls', 'ca.crt');

async function findFirstFile(dirPath) {
    const files = await fs.readdir(dirPath);
    if (!files[0]) throw new Error(`No files in ${dirPath}`);
    return path.join(dirPath, files[0]);
}

async function main() {
    console.log('Testing Fabric connection...\n');
    
    // 检查文件是否存在
    console.log('1. Checking certificate files...');
    try {
        await fs.access(tlsCertPath);
        console.log('   TLS cert: OK');
    } catch {
        console.error('   TLS cert: NOT FOUND at', tlsCertPath);
        return;
    }
    
    try {
        const keyPath = await findFirstFile(keyDirectoryPath);
        console.log('   Key file: OK -', keyPath);
    } catch (e) {
        console.error('   Key file: ERROR -', e.message);
        return;
    }
    
    try {
        const certPath = await findFirstFile(certDirectoryPath);
        console.log('   Cert file: OK -', certPath);
    } catch (e) {
        console.error('   Cert file: ERROR -', e.message);
        return;
    }
    
    // 创建 gRPC 连接
    console.log('\n2. Creating gRPC connection...');
    const tlsRootCert = await fs.readFile(tlsCertPath);
    const tlsCredentials = grpc.credentials.createSsl(tlsRootCert);
    
    const client = new grpc.Client(peerEndpoint, tlsCredentials, {
        'grpc.ssl_target_name_override': peerHostAlias,
    });
    console.log('   gRPC client created');
    
    // 等待连接建立
    console.log('   Waiting for connection...');
    await new Promise((resolve, reject) => {
        const deadline = Date.now() + 10000; // 10 seconds
        client.waitForReady(deadline, (error) => {
            if (error) {
                reject(error);
            } else {
                resolve();
            }
        });
    });
    console.log('   Connection established!');
    
    // 创建 Gateway 连接
    console.log('\n3. Connecting to Gateway...');
    const keyPath = await findFirstFile(keyDirectoryPath);
    const certPath = await findFirstFile(certDirectoryPath);
    
    const privateKeyPem = await fs.readFile(keyPath);
    const credentials = await fs.readFile(certPath);
    
    const identity = { mspId, credentials };
    const privateKey = crypto.createPrivateKey(privateKeyPem);
    const signer = signers.newPrivateKeySigner(privateKey);
    
    const gateway = connect({
        client,
        identity,
        signer,
        hash: hash.sha256,
        evaluateOptions: () => ({ deadline: Date.now() + 5000 }),
        endorseOptions: () => ({ deadline: Date.now() + 15000 }),
        submitOptions: () => ({ deadline: Date.now() + 5000 }),
        commitStatusOptions: () => ({ deadline: Date.now() + 60000 }),
    });
    console.log('   Gateway connected');
    
    // 获取网络
    console.log('\n4. Getting network...');
    const network = gateway.getNetwork(channelName);
    console.log('   Network obtained:', channelName);
    
    // 测试查询
    console.log('\n5. Testing query (GetChainInfo)...');
    try {
        const qscc = network.getContract('qscc');
        const result = await qscc.evaluateTransaction('GetChainInfo', channelName);
        console.log('   Query successful! Result length:', result.length, 'bytes');
        
        // 尝试解析
        const protos = require('fabric-protos');
        if (protos && protos.common && protos.common.BlockchainInfo) {
            const info = protos.common.BlockchainInfo.decode(result);
            console.log('   Block height:', info.height.toString());
        }
    } catch (error) {
        console.error('   Query failed:', error.message);
    }
    
    // 清理
    gateway.close();
    client.close();
    
    console.log('\n✅ Connection test completed!');
}

main().catch(console.error);

