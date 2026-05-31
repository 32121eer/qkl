#!/usr/bin/env node

const { ethers } = require('ethers');
const AgentRegistryABI = require('../abi/AgentRegistry.json');
const { AgentDirectory } = require('../demo/agents/agent_directory');

const CONFIG = {
    contractAddress: '0xfcf9ace6d9653593164b98386f10995acc9115fe',
    rpcEndpoint: 'http://127.0.0.1:20200',
    privateKey: '0xc85f4d8bb7b633cd48c2a7a8e4d62a4cf2a82404466d862a17d4692ff89744cf'
};

const AGENTS = [
    { agentId: 'verifier-proof-01', role: 2, org: 'org-b', strategy: 'A_PROOF_VALIDATOR', endpoint: 'http://agent-verifier-proof-01:19111' },
    { agentId: 'verifier-proof-02', role: 2, org: 'org-d', strategy: 'A_PROOF_VALIDATOR', endpoint: 'http://agent-verifier-proof-02:19112' },
    { agentId: 'verifier-policy-01', role: 2, org: 'org-c', strategy: 'B_POLICY_CHECKER', endpoint: 'http://agent-verifier-policy-01:19113' },
    { agentId: 'verifier-semantic-01', role: 2, org: 'org-f', strategy: 'C_SEMANTIC_REASONER', endpoint: 'http://agent-verifier-semantic-01:19114' },
    { agentId: 'verifier-semantic-02', role: 2, org: 'org-g', strategy: 'C_SEMANTIC_REASONER', endpoint: 'http://agent-verifier-semantic-02:19115' }
];

async function main() {
    console.log('=== Registering Agents to On-Chain Registry ===\n');

    const staticNetwork = new ethers.Network('fisco-bcos', 1);
    const provider = new ethers.JsonRpcProvider(CONFIG.rpcEndpoint, staticNetwork, { staticNetwork: true });
    const wallet = new ethers.Wallet(CONFIG.privateKey, provider);
    const contract = new ethers.Contract(CONFIG.contractAddress, AgentRegistryABI, wallet);
    const directory = new AgentDirectory();

    console.log(`Contract: ${CONFIG.contractAddress}`);
    console.log(`Deployer: ${wallet.address}\n`);

    for (const agent of AGENTS) {
        try {
            // 注册到链上（endpoint 传空，表示使用链下目录）
            const tx = await contract.registerAgent(
                agent.agentId,
                agent.role,
                agent.org,
                agent.strategy,
                '', // endpoint 留空，从链下目录读取
                ethers.ZeroHash
            );
            await tx.wait();
            console.log(`✅ Registered on-chain: ${agent.agentId}`);

            // 保存到链下安全目录
            const sharedSecret = AgentDirectory.generateSharedSecret();
            directory.save(agent.agentId, {
                endpoint: agent.endpoint,
                organization: agent.org,
                strategyType: agent.strategy,
                sharedSecret: sharedSecret,
                authType: 'hmac-sha256',
                createdAt: new Date().toISOString()
            });
            console.log(`✅ Saved to directory: ${agent.agentId}`);
            console.log(`   Endpoint: ${agent.endpoint}`);
            console.log(`   Secret: ${sharedSecret.substring(0, 20)}...\n`);
        } catch (error) {
            console.error(`❌ Failed: ${agent.agentId} - ${error.message}`);
        }
    }

    // Verify
    console.log('\n=== Verification ===');
    const count = await contract.getAgentCount();
    console.log(`Total agents: ${count}`);

    const verifiers = await contract.getActiveVerifiers();
    console.log(`Active verifiers: ${verifiers.join(', ')}`);

    for (const agentId of verifiers) {
        const rep = await contract.getAgentReputation(agentId);
        console.log(`  ${agentId}: rep=${rep.reputation / 1000}, success=${rep.successRate / 100}%`);
    }

    console.log('\n=== Done ===');
    console.log('\n📋 Next steps:');
    console.log('1. Review directory files: ls -la .demo/agents/directory/');
    console.log('2. Set permissions: chmod 600 .demo/agents/directory/*.json');
    console.log('3. Restart Agent containers to load new shared secrets');
}

main().catch(console.error);
