#!/usr/bin/env node

/**
 * Sync On-Chain Agent Data with Off-Chain Directory
 *
 * 从链上读取 Agent 身份和信誉，从链下目录读取 endpoint 和密钥，
 * 合并后生成 onchain-state.json 供 Relayer 使用。
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const { AgentDirectory } = require('../demo/agents/agent_directory');

const CONTRACT_ADDR = process.env.AGENT_REGISTRY_ADDRESS || '0xfcf9ace6d9653593164b98386f10995acc9115fe';
const CONSOLE_DIR = '/mnt/fast18/xunuo/qkl/cross-chain/fisco-bcos/console';
const OUTPUT_FILE = path.join(__dirname, '../.demo/agents/onchain-state.json');

function callConsole(method, ...args) {
    const cmd = `cd ${CONSOLE_DIR} && ./console.sh call AgentRegistry ${CONTRACT_ADDR} ${method} ${args.join(' ')} 2>/dev/null`;
    try {
        return execSync(cmd, { encoding: 'utf8' });
    } catch (error) {
        console.error(`Failed to call ${method}:`, error.message);
        return null;
    }
}

function parseReturnValues(output) {
    if (!output) return null;
    const match = output.match(/Return values:\s*\(([^)]+)\)/);
    if (!match) return null;
    return match[1];
}

function parseAgentValues(output) {
    const values = parseReturnValues(output);
    if (!values) return null;
    const parts = values.split(',').map(p => p.trim());
    // Agent struct: agentId, role, organization, strategyType, endpoint, publicKey, reputation, successCount, totalTasks, registeredAt, lastActiveAt, status
    return {
        agentId: parts[0]?.replace(/^"|"$/g, ''),
        role: parseInt(parts[1]) || 0,
        organization: parts[2]?.replace(/^"|"$/g, ''),
        strategyType: parts[3]?.replace(/^"|"$/g, ''),
        endpoint: parts[4]?.replace(/^"|"$/g, ''),
        publicKey: parts[5],
        reputation: parseInt(parts[6]) || 500,
        successCount: parseInt(parts[7]) || 0,
        totalTasks: parseInt(parts[8]) || 0,
        status: parseInt(parts[11]) || 1
    };
}

function main() {
    console.log('=== Syncing On-Chain Data with Off-Chain Directory ===\n');
    console.log(`Contract: ${CONTRACT_ADDR}`);

    const directory = new AgentDirectory();
    const agents = [];

    // Get active verifiers
    const verifiersOutput = callConsole('getActiveVerifiers');
    const verifiersMatch = verifiersOutput?.match(/\[([^\]]+)\]/);
    const verifierIds = verifiersMatch
        ? verifiersMatch[1].split(',').map(s => s.trim().replace(/^"|"$/g, '')).filter(Boolean)
        : [];

    console.log(`Found ${verifierIds.length} active verifiers: ${verifierIds.join(', ')}\n`);

    for (const agentId of verifierIds) {
        const agentOutput = callConsole('getAgent', `"${agentId}"`);
        const onchainData = parseAgentValues(agentOutput);

        if (!onchainData) {
            console.error(`❌ Failed to parse agent: ${agentId}`);
            continue;
        }

        // Load from off-chain directory (preferred)
        const dirConfig = directory.load(agentId);
        const endpoint = dirConfig?.endpoint || onchainData.endpoint;
        const authType = dirConfig?.sharedSecret ? 'hmac-sha256' : 'none';

        if (dirConfig) {
            console.log(`✅ ${agentId}: merged with directory (auth: ${authType})`);
        } else if (onchainData.endpoint) {
            console.log(`⚠️  ${agentId}: using on-chain endpoint (deprecated)`);
        } else {
            console.log(`❌ ${agentId}: no endpoint available (skipped)`);
            continue;
        }

        agents.push({
            ...onchainData,
            endpoint: endpoint || '',
            authType
        });
    }

    const output = {
        contractAddress: CONTRACT_ADDR,
        syncedAt: new Date().toISOString(),
        agents
    };

    fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));

    console.log(`\n✅ Synced ${agents.length} agents to: ${OUTPUT_FILE}`);
    console.log(`   Active: ${agents.filter(a => a.status === 1).length}`);
    console.log(`   With HMAC: ${agents.filter(a => a.authType === 'hmac-sha256').length}`);
    console.log(`   Deprecated endpoint: ${agents.filter(a => a.authType === 'none' && a.endpoint).length}`);
}

main();
