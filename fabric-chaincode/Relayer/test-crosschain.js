#!/usr/bin/env node

/**
 * 跨链测试脚本
 * 从 Fabric 发起跨链调用到 FISCO-BCOS
 */

const grpc = require('@grpc/grpc-js');
const { connect, hash, signers } = require('@hyperledger/fabric-gateway');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { TextDecoder } = require('node:util');

// ============================================================================
// 【可配置】Fabric 网络路径
// 注意：这里需要指向 fabric-samples 中的证书目录
// 如果您的 fabric-samples 在不同位置，请修改此变量
// 也可以通过环境变量 FABRIC_CRYPTO_PATH 覆盖
// ============================================================================
const cryptoPath = process.env.FABRIC_CRYPTO_PATH || '/home/tr/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com';
const mspId = 'Org1MSP';
const channelName = 'mychannel';
const peerEndpoint = 'localhost:7051';
const peerHostAlias = 'peer0.org1.example.com';

const keyDirectoryPath = path.resolve(cryptoPath, 'users', 'User1@org1.example.com', 'msp', 'keystore');
const certDirectoryPath = path.resolve(cryptoPath, 'users', 'User1@org1.example.com', 'msp', 'signcerts');
const tlsCertPath = path.resolve(cryptoPath, 'peers', 'peer0.org1.example.com', 'tls', 'ca.crt');

const utf8Decoder = new TextDecoder();

async function findFirstFile(dirPath) {
    const files = await fs.readdir(dirPath);
    if (!files[0]) throw new Error(`No files in ${dirPath}`);
    return path.join(dirPath, files[0]);
}

async function main() {
    console.log('=== 跨链测试：Fabric -> FISCO-BCOS ===\n');
    
    // 创建 gRPC 连接
    console.log('1. 连接到 Fabric 网络...');
    const tlsRootCert = await fs.readFile(tlsCertPath);
    const tlsCredentials = grpc.credentials.createSsl(tlsRootCert);
    
    const client = new grpc.Client(peerEndpoint, tlsCredentials, {
        'grpc.ssl_target_name_override': peerHostAlias,
    });
    
    // 等待连接（增加超时到 30 秒）
    await new Promise((resolve, reject) => {
        const deadline = Date.now() + 30000;
        client.waitForReady(deadline, (error) => {
            if (error) {
                console.log('   连接错误详情:', error.message);
                reject(error);
            } else {
                resolve();
            }
        });
    });
    console.log('   ✅ 已连接到 Fabric peer');
    
    // 创建 Gateway
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
    
    try {
        const network = gateway.getNetwork(channelName);
        
        // 获取 gateway_cc 合约
        console.log('\n2. 获取 gateway_cc 合约...');
        const gatewayContract = network.getContract('gateway_cc');
        console.log('   ✅ 合约已获取');
        
        // 发起跨链调用
        console.log('\n3. 发起跨链调用...');
        
        const targetChainId = 'FISCO_NET_01';
        const targetContract = '0xcceef68c9b4811b32c75df284a1396c7c5509561';  // FISCO Gateway 合约地址
        const targetFunction = 'echo';  // 目标函数
        const payload = JSON.stringify({
            message: 'Hello from Fabric!',
            timestamp: Date.now()
        });
        
        console.log(`   目标链: ${targetChainId}`);
        console.log(`   目标合约: ${targetContract}`);
        console.log(`   目标函数: ${targetFunction}`);
        console.log(`   负载: ${payload}`);
        
        console.log('\n   正在提交交易...');
        const resultBytes = await gatewayContract.submitTransaction(
            'Send',
            targetChainId,
            targetContract,
            targetFunction,
            payload
        );
        
        const nonce = utf8Decoder.decode(resultBytes);
        console.log(`   ✅ 交易已提交！`);
        console.log(`   Nonce: ${nonce}`);
        
        console.log('\n=== 跨链请求已发送 ===');
        console.log('Relayer 将监听到 CrossChainCall 事件并转发到 FISCO-BCOS');
        console.log('请查看 Relayer 日志确认消息是否被转发');
        
    } catch (error) {
        console.error('\n❌ 错误:', error.message);
        if (error.message.includes('no such chaincode')) {
            console.log('\n提示: gateway_cc 链码可能未安装。');
            console.log('请先部署链码（请根据实际路径调整）：');
            console.log('  cd ~/fabric-samples/test-network');
            console.log('  ./network.sh deployCC -ccn gateway_cc -ccp <cross-chain项目路径>/fabric-chaincode/my-chain-code/gateway_cc -ccl go');
        }
    } finally {
        gateway.close();
        client.close();
    }
}

main().catch(console.error);

