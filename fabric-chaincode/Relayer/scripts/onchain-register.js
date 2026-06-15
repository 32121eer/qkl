#!/usr/bin/env node
//
// onchain-register.js — Paper §IV-B reproduction: on-chain agent registry.
//
// Reads the agent pool from cloud-agents.env (DEMO_REMOTE_AGENTS_JSON +
// DEMO_LOCAL_VERIFIER_IDS), registers each one on the AgentRegistryAir
// contract via FISCO console.sh, then writes the resulting state to
// .demo/agents/onchain-state.json so the Relayer's bootstrapOnchainAgents()
// picks them up next start.
//
// Usage:
//   AGENT_REGISTRY_ADDRESS=0x... node scripts/onchain-register.js
//
// Prerequisite:
//   - AgentRegistryAir contract deployed (see deploy step in README)
//   - Java in PATH for console.sh
//   - Sender address must equal the deploying admin (private key in env or
//     console default account).

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { AgentDirectory } = require('../demo/agents/agent_directory');

const RELAYER_DIR = path.resolve(__dirname, '..');
const PROJECT_ROOT = path.resolve(RELAYER_DIR, '../..');
const CLOUD_AGENTS_ENV = path.join(PROJECT_ROOT, '.demo/cloud-agents.env');
const FISCO_CONSOLE_DIR = path.join(PROJECT_ROOT, 'fisco-bcos/console');
const ONCHAIN_STATE_PATH = path.join(RELAYER_DIR, '.demo/agents/onchain-state.json');

const REGISTRY_ADDR = process.env.AGENT_REGISTRY_ADDRESS;
if (!REGISTRY_ADDR) {
    console.error('Set AGENT_REGISTRY_ADDRESS to the deployed contract address.');
    process.exit(2);
}

const ROLE_VERIFIER = 2;

const LOCAL_META = {
    'verifier-structural-01': { organization: 'org-a', strategyType: 'A_PROOF_VALIDATOR' },
    'verifier-proof-01':      { organization: 'org-b', strategyType: 'A_PROOF_VALIDATOR' },
    'verifier-balanced-01':   { organization: 'org-c', strategyType: 'B_POLICY_CHECKER' },
    'verifier-proof-02':      { organization: 'org-d', strategyType: 'A_PROOF_VALIDATOR' },
    'verifier-balanced-02':   { organization: 'org-e', strategyType: 'B_POLICY_CHECKER' },
    'verifier-semantic-01':   { organization: 'org-f', strategyType: 'C_SEMANTIC_REASONER' },
    'verifier-semantic-02':   { organization: 'org-g', strategyType: 'C_SEMANTIC_REASONER' }
};

function loadAgentPool() {
    const helper = `set -a; source "${CLOUD_AGENTS_ENV}"; set +a; printf '%s\\n__SENTINEL__\\n%s' "$DEMO_REMOTE_AGENTS_JSON" "$DEMO_LOCAL_VERIFIER_IDS"`;
    const res = spawnSync('bash', ['-c', helper], { encoding: 'utf8' });
    if (res.status !== 0) throw new Error(`Failed to source env: ${res.stderr || res.error}`);
    const [remoteRaw, localRaw] = res.stdout.split('__SENTINEL__');
    const remoteSpecs = JSON.parse(remoteRaw.trim());
    const localIds = (localRaw || '').trim().split(',').map((s) => s.trim()).filter(Boolean);

    const locals = localIds.map((id, idx) => ({
        kind: 'local',
        agentId: id,
        organization: LOCAL_META[id]?.organization || `org-local-${idx + 1}`,
        strategyType: LOCAL_META[id]?.strategyType || 'B_POLICY_CHECKER',
        endpoint: '',
        sharedSecret: null
    }));
    const remotes = remoteSpecs.map((s) => ({
        kind: 'remote',
        agentId: s.agentId,
        organization: s.organization,
        strategyType: s.strategyType,
        endpoint: s.baseUrl,
        sharedSecret: s.sharedSecret || null
    }));
    return [...locals, ...remotes];
}

function callConsole(args) {
    const consoleSh = path.join(FISCO_CONSOLE_DIR, 'console.sh');
    const env = { ...process.env };
    // Ensure Java is on PATH (mirror start-all.sh).
    for (const p of [
        '/opt/homebrew/opt/openjdk@21/bin',
        '/opt/homebrew/opt/openjdk@17/bin',
        '/opt/homebrew/opt/openjdk/bin',
        '/usr/local/opt/openjdk@21/bin'
    ]) {
        if (fs.existsSync(path.join(p, 'java'))) {
            env.PATH = `${p}:${env.PATH || ''}`;
            break;
        }
    }
    return spawnSync(consoleSh, args, { cwd: FISCO_CONSOLE_DIR, encoding: 'utf8', env });
}

function consoleCall(method, ...args) {
    // call <contract> <addr> <method> args...
    const quoted = args.map((a) => `"${String(a).replace(/"/g, '\\"')}"`);
    return callConsole(['call', 'AgentRegistryAir', REGISTRY_ADDR, method, ...quoted]);
}

async function main() {
    console.log('=== On-chain agent registration (paper §IV-B) ===\n');
    console.log(`Contract: AgentRegistryAir @ ${REGISTRY_ADDR}\n`);

    const pool = loadAgentPool();
    console.log(`Pool: ${pool.length} agents (${pool.filter((a) => a.kind === 'local').length} local + ${pool.filter((a) => a.kind === 'remote').length} cloud)\n`);

    const directory = new AgentDirectory();
    const registered = [];
    for (const spec of pool) {
        // registerAgent(string agentId, uint8 role, string org, string strategy)
        const r = consoleCall(
            'registerAgent',
            spec.agentId,
            ROLE_VERIFIER,
            spec.organization,
            spec.strategyType
        );
        const ok = r.stdout && /transaction status: 0|description: transaction executed successfully/.test(r.stdout);
        const dup = r.stdout && /Agent already exists/.test(r.stdout);
        if (ok || dup) {
            console.log(`  ${dup ? '·' : '✓'} ${spec.agentId.padEnd(22)} ${spec.organization.padEnd(18)} ${spec.strategyType.padEnd(22)} (${spec.kind}${dup ? ', already registered' : ''})`);
            registered.push(spec);
            const secret = spec.sharedSecret || AgentDirectory.generateSharedSecret();
            directory.save(spec.agentId, {
                endpoint: spec.endpoint || null,
                organization: spec.organization,
                strategyType: spec.strategyType,
                sharedSecret: secret,
                authType: 'hmac-sha256',
                createdAt: new Date().toISOString()
            });
        } else {
            console.error(`  ✗ ${spec.agentId} — console output:\n${r.stdout || r.stderr}`);
        }
    }

    console.log('\nWriting onchain-state.json snapshot...');
    fs.mkdirSync(path.dirname(ONCHAIN_STATE_PATH), { recursive: true });
    fs.writeFileSync(ONCHAIN_STATE_PATH, JSON.stringify({
        contractAddress: REGISTRY_ADDR,
        syncedAt: new Date().toISOString(),
        agents: registered.map((spec) => ({
            agentId: spec.agentId,
            role: ROLE_VERIFIER,
            organization: spec.organization,
            strategyType: spec.strategyType,
            endpoint: spec.endpoint,
            status: 1,
            reputation: 500
        }))
    }, null, 2));
    console.log(`✓ ${ONCHAIN_STATE_PATH}\n`);

    console.log('=== Done ===\n');
    console.log('Add these lines to .demo/cloud-agents.env if not already there, then restart demo:');
    console.log(`  export DEMO_ONCHAIN_AGENTS_ENABLED=true`);
    console.log(`  export AGENT_REGISTRY_ADDRESS=${REGISTRY_ADDR}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
