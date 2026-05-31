#!/usr/bin/env node

/**
 * Test AgentRegistry contract interactions
 */

const { OnChainRegistryClient } = require('../demo/agents/onchain_registry');

const CONFIG = {
    contractAddress: process.env.AGENT_REGISTRY_ADDRESS,
    rpcEndpoint: process.env.FISCO_RPC || 'http://127.0.0.1:8545',
    privateKey: process.env.FISCO_PRIVATE_KEY || '0xc85f4d8bb7b633cd48c2a7a8e4d62a4cf2a82404466d862a17d4692ff89744cf'
};

async function testReadOperations(client) {
    console.log('\n=== Testing Read Operations ===');

    // Get agent count
    const count = await client.getAgentCount();
    console.log(`Total agents: ${count}`);

    // Get active verifiers
    const verifiers = await client.getActiveVerifiers();
    console.log(`Active verifiers: ${verifiers.join(', ')}`);

    // Get agent details
    for (const agentId of verifiers.slice(0, 2)) {
        const agent = await client.getAgent(agentId);
        console.log(`\nAgent: ${agentId}`);
        console.log(`  Role: ${agent.role}`);
        console.log(`  Organization: ${agent.organization}`);
        console.log(`  Strategy: ${agent.strategyType}`);
        console.log(`  Status: ${agent.status}`);
        console.log(`  Endpoint: ${agent.endpoint}`);

        const rep = await client.getAgentReputation(agentId);
        console.log(`  Reputation: ${rep.reputation}`);
        console.log(`  Success Rate: ${rep.successRate}%`);
    }
}

async function testCommitteeSelection(client) {
    console.log('\n=== Testing Committee Selection ===');

    const taskId = `test_task_${Date.now()}`;
    console.log(`Selecting committee for task: ${taskId}`);

    const committee = await client.selectCommittee(taskId, 2, 3, 'NORMAL');
    console.log(`Selected committee: ${committee.agentIds.join(', ')}`);
    console.log(`Seed: ${committee.seed}`);
    console.log(`Block: ${committee.blockNumber}`);

    // Verify committee
    const stored = await client.getCommittee(taskId);
    console.log(`Stored committee: ${stored.agentIds.join(', ')}`);

    return taskId;
}

async function testReputationUpdate(client, taskId) {
    console.log('\n=== Testing Reputation Update ===');

    const committee = await client.getCommittee(taskId);

    // Record results
    const results = committee.agentIds.map((agentId, idx) => ({
        agentId,
        aligned: idx % 2 === 0, // 交替成功/失败
        confidence: 0.7 + Math.random() * 0.2,
        latencyMs: 1000 + Math.random() * 3000
    }));

    for (const result of results) {
        await client.recordTaskResult(
            taskId,
            result.agentId,
            result.aligned,
            result.confidence,
            result.latencyMs
        );
        console.log(`Recorded: ${result.agentId} aligned=${result.aligned} conf=${result.confidence.toFixed(2)}`);
    }

    // Check updated reputations
    console.log('\nUpdated reputations:');
    for (const agentId of committee.agentIds) {
        const rep = await client.getAgentReputation(agentId);
        console.log(`  ${agentId}: ${rep.reputation}`);
    }
}

async function main() {
    console.log('=== AgentRegistry Contract Test ===');

    if (!CONFIG.contractAddress) {
        console.error('❌ AGENT_REGISTRY_ADDRESS not set');
        console.error('Please deploy the contract first:');
        console.error('  node scripts/deploy-agent-registry.js');
        process.exit(1);
    }

    const client = new OnChainRegistryClient(CONFIG);

    try {
        await testReadOperations(client);
        const taskId = await testCommitteeSelection(client);
        await testReputationUpdate(client, taskId);

        console.log('\n✅ All tests passed!');
    } catch (error) {
        console.error('\n❌ Test failed:', error.message);
        process.exit(1);
    }
}

main().catch(console.error);
