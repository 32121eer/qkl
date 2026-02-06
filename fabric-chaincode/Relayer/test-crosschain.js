/**
 * 跨链测试脚本：Fabric -> FISCO-BCOS
 */

const grpc = require('@grpc/grpc-js');
const { connect, hash, signers } = require('@hyperledger/fabric-gateway');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

// 配置
const channelName = 'mychannel';
const chaincodeName = 'gateway_cc';
const mspId = 'Org1MSP';

// fabric-samples 路径（根据实际情况调整）
const cryptoPath = process.env.FABRIC_CRYPTO_PATH || 
    '/home/tr/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com';

const certPath = path.resolve(cryptoPath, 'users', 'User1@org1.example.com', 'msp', 'signcerts');
const keyPath = path.resolve(cryptoPath, 'users', 'User1@org1.example.com', 'msp', 'keystore');
const tlsCertPath = path.resolve(cryptoPath, 'peers', 'peer0.org1.example.com', 'tls', 'ca.crt');

const peerEndpoint = 'localhost:7051';
const peerHostAlias = 'peer0.org1.example.com';

async function main() {
    console.log('=== 跨链测试：Fabric -> FISCO-BCOS ===\n');
    
    try {
        // 1. 连接到 Fabric
        console.log('1. 连接到 Fabric 网络...');
        const client = await newGrpcConnection();
        const gateway = connect({
            client,
            identity: await newIdentity(),
            signer: await newSigner(),
            hash: hash.sha256,
        });
        
        console.log('   ✅ 已连接到 Fabric peer\n');
        
        // 2. 获取合约
        console.log('2. 获取 gateway_cc 合约...');
        const network = gateway.getNetwork(channelName);
        const contract = network.getContract(chaincodeName);
        console.log('   ✅ 合约已获取\n');
        
        // 3. 发起跨链调用
        console.log('3. 发起跨链调用...');
        const targetChainId = 'FISCO_NET_01';
        const targetContract = '0xcceef68c9b4811b32c75df284a1396c7c5509561'; // FISCO Gateway 地址
        const targetFunction = 'echo';
        const payload = JSON.stringify({
            message: 'Hello from Fabric!',
            timestamp: Date.now()
        });
        
        console.log(`   目标链: ${targetChainId}`);
        console.log(`   目标合约: ${targetContract}`);
        console.log(`   目标函数: ${targetFunction}`);
        console.log(`   负载: ${payload}\n`);
        
        console.log('   正在提交交易...');
        const result = await contract.submitTransaction(
            'Send',
            targetChainId,
            targetContract,
            targetFunction,
            payload
        );
        
        const nonce = result.toString();
        console.log('   ✅ 交易已提交！');
        console.log(`   Nonce: ${nonce}\n`);
        
        console.log('=== 跨链请求已发送 ===');
        console.log('Relayer 将监听到 CrossChainCall 事件并转发到 FISCO-BCOS');
        console.log('请查看 Relayer 日志确认消息是否被转发');
        
        gateway.close();
        client.close();
        
    } catch (error) {
        console.error('❌ 测试失败:', error);
        
        if (error.message.includes('no such chaincode')) {
            console.log('\n提示: gateway_cc 链码可能未安装。');
            console.log('请先部署链码：');
            console.log('  cd ${FABRIC_SAMPLES_DIR}/test-network');
            console.log('  ./network.sh deployCC -ccn gateway_cc -ccp /home/tr/projects/cross-chain/fabric-chaincode/my-chain-code/gateway_cc -ccl go');
        }
        
        process.exit(1);
    }
}

async function newGrpcConnection() {
    const tlsRootCert = await fs.readFile(tlsCertPath);
    const tlsCredentials = grpc.credentials.createSsl(tlsRootCert);
    return new grpc.Client(peerEndpoint, tlsCredentials, {
        'grpc.ssl_target_name_override': peerHostAlias,
    });
}

async function newIdentity() {
    const certFiles = await fs.readdir(certPath);
    const credentials = await fs.readFile(path.join(certPath, certFiles[0]));
    return { mspId, credentials };
}

async function newSigner() {
    const keyFiles = await fs.readdir(keyPath);
    const privateKeyPem = await fs.readFile(path.join(keyPath, keyFiles[0]));
    const privateKey = crypto.createPrivateKey(privateKeyPem);
    return signers.newPrivateKeySigner(privateKey);
}

main();
