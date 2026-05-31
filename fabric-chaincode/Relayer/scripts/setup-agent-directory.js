#!/usr/bin/env node

/**
 * Setup Agent Directory - 初始化链下安全目录
 *
 * 为已注册的 Agent 生成共享密钥并写入安全目录。
 * 运行前需要先部署合约并注册 Agent。
 *
 * Usage:
 *   node scripts/setup-agent-directory.js
 *   node scripts/setup-agent-directory.js --regenerate  # 强制重新生成
 */

const path = require('path');
const { AgentDirectory } = require('../demo/agents/agent_directory');

// Endpoint host used by the orchestrator (host-run Relayer / demo script) to reach
// each Agent. For the single-machine Docker phase the Relayer runs on the host and
// reaches containers through published ports, so the default is 127.0.0.1 (NOT the
// Docker-internal service hostname, which the host cannot resolve).
//
// Phase 2 (multi-server): set AGENT_ENDPOINT_HOST to the agent host/IP, or override a
// single agent fully via <AGENT_ID_UPPER_SNAKE>_ENDPOINT, e.g.
//   AGENT_ENDPOINT_HOST=10.0.0.21
//   VERIFIER_PROOF_01_ENDPOINT=https://node-a.example.com:19111
const ENDPOINT_HOST = process.env.AGENT_ENDPOINT_HOST || '127.0.0.1';
const ENDPOINT_SCHEME = process.env.AGENT_ENDPOINT_SCHEME || 'http';

const AGENT_DEFS = [
    { agentId: 'verifier-proof-01', port: 19111, org: 'org-b', strategy: 'A_PROOF_VALIDATOR' },
    { agentId: 'verifier-proof-02', port: 19112, org: 'org-d', strategy: 'A_PROOF_VALIDATOR' },
    { agentId: 'verifier-policy-01', port: 19113, org: 'org-c', strategy: 'B_POLICY_CHECKER' },
    { agentId: 'verifier-semantic-01', port: 19114, org: 'org-f', strategy: 'C_SEMANTIC_REASONER' },
    { agentId: 'verifier-semantic-02', port: 19115, org: 'org-g', strategy: 'C_SEMANTIC_REASONER' }
];

function resolveEndpoint(agent) {
    const overrideKey = `${agent.agentId.toUpperCase().replace(/-/g, '_')}_ENDPOINT`;
    if (process.env[overrideKey]) {
        return process.env[overrideKey];
    }
    return `${ENDPOINT_SCHEME}://${ENDPOINT_HOST}:${agent.port}`;
}

const AGENTS = AGENT_DEFS.map((agent) => ({ ...agent, endpoint: resolveEndpoint(agent) }));

// Write to the repo-root directory that docker-compose.agents.yml mounts into the
// containers (../../.demo/agents/directory relative to the Relayer dir). Overridable
// via AGENT_DIRECTORY_PATH so both the containers and the host orchestrator agree.
const DEFAULT_DIRECTORY_PATH = path.resolve(__dirname, '../../../.demo/agents/directory');

const REGENERATE = process.argv.includes('--regenerate');

async function main() {
    console.log('=== Setting up Agent Directory ===\n');

    const dirPath = process.env.AGENT_DIRECTORY_PATH || DEFAULT_DIRECTORY_PATH;
    console.log(`Directory: ${dirPath}`);
    console.log(`Endpoint host: ${ENDPOINT_HOST} (scheme ${ENDPOINT_SCHEME})\n`);
    const directory = new AgentDirectory({ dirPath });
    let created = 0;
    let skipped = 0;

    for (const agent of AGENTS) {
        const exists = directory.exists(agent.agentId);

        if (exists && !REGENERATE) {
            console.log(`⏭️  Skipped ${agent.agentId} (already exists, use --regenerate to overwrite)`);
            skipped++;
            continue;
        }

        const sharedSecret = AgentDirectory.generateSharedSecret();

        const config = {
            endpoint: agent.endpoint,
            organization: agent.org,
            strategyType: agent.strategy,
            sharedSecret: sharedSecret,
            authType: 'hmac-sha256',
            createdAt: new Date().toISOString()
        };

        try {
            const filePath = directory.save(agent.agentId, config);
            console.log(`✅ Created ${agent.agentId}`);
            console.log(`   Endpoint: ${agent.endpoint}`);
            console.log(`   Secret: ${sharedSecret.substring(0, 20)}...`);
            console.log(`   File: ${filePath}\n`);
            created++;
        } catch (error) {
            console.error(`❌ Failed ${agent.agentId}: ${error.message}`);
        }
    }

    console.log('=== Summary ===');
    console.log(`Created: ${created}`);
    console.log(`Skipped: ${skipped}`);
    console.log(`\nNext steps:`);
    console.log('1. Set file permissions: chmod 600 .demo/agents/directory/*.json');
    console.log('2. Restart Agent containers to load shared secrets');
    console.log('3. Enable authentication in Relayer');

    // Print docker-compose environment variables
    console.log('\n=== Docker Compose Environment ===');
    console.log('Add these to your .env file or docker-compose.yml:');
    for (const agent of AGENTS) {
        const config = directory.load(agent.agentId);
        if (config) {
            console.log(`# ${agent.agentId}`);
            console.log(`${agent.agentId.toUpperCase().replace(/-/g, '_')}_SECRET=${config.sharedSecret}`);
        }
    }
}

main().catch(console.error);
