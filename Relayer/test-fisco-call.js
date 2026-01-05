#!/usr/bin/env node

/**
 * 测试直接调用 FISCO Gateway 合约
 */

const { ethers } = require('ethers');
const GatewayABI = require('./abi/Gateway.json');

async function main() {
    console.log('=== 测试 FISCO Gateway 合约调用 ===\n');
    
    // 配置
    const rpcEndpoint = 'http://127.0.0.1:8545';
    const privateKey = '0xc85f4d8bb7b633cd48c2a7a8e4d62a4cf2a82404466d862a17d4692ff89744cf';
    const gatewayAddress = '0xcceef68c9b4811b32c75df284a1396c7c5509561';
    
    // 使用静态网络
    console.log('1. 连接到 FISCO RPC...');
    const staticNetwork = new ethers.Network('fisco-bcos', 1);
    const provider = new ethers.JsonRpcProvider(rpcEndpoint, staticNetwork, {
        staticNetwork: true
    });
    
    // 测试 RPC 连接
    try {
        const blockNumber = await provider.getBlockNumber();
        console.log(`   ✅ 已连接，当前区块: ${blockNumber}`);
    } catch (error) {
        console.error('   ❌ RPC 连接失败:', error.message);
        return;
    }
    
    // 创建钱包
    console.log('\n2. 创建钱包...');
    const wallet = new ethers.Wallet(privateKey, provider);
    console.log(`   地址: ${wallet.address}`);
    
    // 测试获取余额
    try {
        const balance = await provider.getBalance(wallet.address);
        console.log(`   余额: ${ethers.formatEther(balance)} ETH`);
    } catch (error) {
        console.log(`   余额查询失败: ${error.message}`);
    }
    
    // 创建合约实例
    console.log('\n3. 连接到 Gateway 合约...');
    const gateway = new ethers.Contract(gatewayAddress, GatewayABI, wallet);
    
    // 测试只读调用
    console.log('\n4. 测试只读调用 (admin)...');
    try {
        const admin = await gateway.admin();
        console.log(`   ✅ admin: ${admin}`);
    } catch (error) {
        console.error(`   ❌ 调用失败: ${error.message}`);
    }
    
    // 测试 isMessageProcessed
    console.log('\n5. 测试 isMessageProcessed...');
    try {
        const processed = await gateway.isMessageProcessed(
            'FABRIC_NET_01',
            'test-tx-hash',
            1
        );
        console.log(`   ✅ isMessageProcessed: ${processed}`);
    } catch (error) {
        console.error(`   ❌ 调用失败: ${error.message}`);
    }
    
    // 测试 receive 调用（写入操作）
    console.log('\n6. 测试 receive 调用（写入）...');
    try {
        const payload = ethers.toUtf8Bytes('{"message":"test"}');
        const merkleProof = [];
        
        console.log('   正在发送交易...');
        
        // 先估算 gas
        console.log('   估算 gas...');
        const gasEstimate = await gateway.receive.estimateGas(
            'FABRIC_NET_01',
            'test-tx-' + Date.now(),
            1,
            payload,
            merkleProof
        );
        console.log(`   预估 gas: ${gasEstimate.toString()}`);
        
        // 发送交易
        const tx = await gateway.receive(
            'FABRIC_NET_01',
            'test-tx-' + Date.now(),
            1,
            payload,
            merkleProof
        );
        
        console.log(`   ✅ 交易已发送: ${tx.hash}`);
        
        console.log('   等待确认...');
        const receipt = await tx.wait();
        console.log(`   ✅ 交易已确认，区块: ${receipt.blockNumber}`);
        
    } catch (error) {
        console.error(`   ❌ 调用失败:`);
        console.error(`      code: ${error.code}`);
        console.error(`      message: ${error.message}`);
        if (error.data) {
            console.error(`      data: ${error.data}`);
        }
        if (error.reason) {
            console.error(`      reason: ${error.reason}`);
        }
    }
    
    console.log('\n=== 测试完成 ===');
}

main().catch(console.error);

