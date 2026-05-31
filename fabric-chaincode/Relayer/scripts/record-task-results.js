#!/usr/bin/env node

/**
 * Record task results back to on-chain AgentRegistry
 * Usage: node record-task-results.js <taskId> '<json-results-array>'
 *
 * Example:
 *   node record-task-results.js task_001 '[{"agentId":"verifier-proof-01","aligned":true,"confidence":0.85,"latencyMs":1200}]'
 */

const { ethers } = require('ethers');
const AgentRegistryABI = require('../abi/AgentRegistry.json');

const CONFIG = {
    contractAddress: process.env.AGENT_REGISTRY_ADDRESS || '0xfcf9ace6d9653593164b98386f10995acc9115fe',
    rpcEndpoint: process.env.FISCO_RPC || 'http://127.0.0.1:20200',
    privateKey: process.env.FISCO_PRIVATE_KEY || '0xc85f4d8bb7b633cd48c2a7a8e4d62a4cf2a82404466d862a17d4692ff89744cf'
};

async function main() {
    const taskId = process.argv[2];
    const resultsJson = process.argv[3];

    if (!taskId || !resultsJson) {
        console.error('Usage: node record-task-results.js <taskId> \'<json-results-array>\'');
        process.exit(1);
    }

    let results;
    try {
        results = JSON.parse(resultsJson);
    } catch (error) {
        console.error('Invalid JSON results:', error.message);
        process.exit(1);
    }

    if (!Array.isArray(results) || !results.length) {
        console.error('Results must be a non-empty array');
        process.exit(1);
    }

    console.log(`=== Recording Task Results ===`);
    console.log(`Task: ${taskId}`);
    console.log(`Contract: ${CONFIG.contractAddress}`);
    console.log(`Results: ${results.length}\n`);

    const staticNetwork = new ethers.Network('fisco-bcos', 1);
    const provider = new ethers.JsonRpcProvider(CONFIG.rpcEndpoint, staticNetwork, { staticNetwork: true });
    const wallet = new ethers.Wallet(CONFIG.privateKey, provider);
    const contract = new ethers.Contract(CONFIG.contractAddress, AgentRegistryABI, wallet);

    console.log(`Admin: ${wallet.address}\n`);

    for (const result of results) {
        try {
            const tx = await contract.recordTaskResult(
                taskId,
                result.agentId,
                Boolean(result.aligned),
                Math.round((result.confidence || 0.5) * 1000),
                Math.round(result.latencyMs || 0)
            );
            await tx.wait();
            console.log(`✅ Recorded: ${result.agentId} aligned=${result.aligned} conf=${(result.confidence || 0).toFixed(2)}`);
        } catch (error) {
            console.error(`❌ Failed: ${result.agentId} - ${error.message}`);
        }
    }

    console.log('\n=== Done ===');
}

main().catch(console.error);
