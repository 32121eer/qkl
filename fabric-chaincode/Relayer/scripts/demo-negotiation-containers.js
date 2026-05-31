#!/usr/bin/env node

/**
 * Multi-Agent Negotiation across Docker containers (single-machine phase).
 *
 * Drives the relayer's AgentRuntime against the 5 verifier Agents that run as
 * independent Docker containers (docker-compose.agents.yml). Each Agent is reached
 * over HTTP through its published port and authenticated with HMAC-SHA256 using the
 * shared secret stored in the off-chain directory (.demo/agents/directory).
 *
 * This proves the multi-Agent negotiation flow end to end WITHOUT requiring the live
 * Fabric/FISCO chains: it feeds a synthetic, fully-formed cross-chain verification
 * task, collects each container's sealed (commit-reveal) opinion, runs the weighted
 * BFT aggregation, and prints the final consensus proposal.
 *
 * Prereqs:
 *   node scripts/setup-agent-directory.js --regenerate
 *   docker compose -f docker-compose.agents.yml up -d --build
 *
 * Usage:
 *   node scripts/demo-negotiation-containers.js
 *   node scripts/demo-negotiation-containers.js --json   # also write JSON artifact
 */

const path = require('path');
const fs = require('fs');

// Keep this run self-contained: no chain sync, no registry-file mutation.
process.env.DEMO_ONCHAIN_AGENTS_ENABLED = 'false';
process.env.DEMO_AGENT_REGISTRY_DISABLED = 'true';

const { AgentDirectory } = require('../demo/agents/agent_directory');
const { AgentRuntime } = require('../demo/agents/agent_runtime');
const { NegotiationProtocol } = require('../demo/negotiation/negotiation_protocol');

const DIRECTORY_PATH = process.env.AGENT_DIRECTORY_PATH
    || path.resolve(__dirname, '../../../.demo/agents/directory');

const AGENT_META = {
    'verifier-proof-01': { organization: 'org-b', strategyType: 'A_PROOF_VALIDATOR', focus: 'proof' },
    'verifier-proof-02': { organization: 'org-d', strategyType: 'A_PROOF_VALIDATOR', focus: 'proof' },
    'verifier-policy-01': { organization: 'org-c', strategyType: 'B_POLICY_CHECKER', focus: 'balanced' },
    'verifier-semantic-01': { organization: 'org-f', strategyType: 'C_SEMANTIC_REASONER', focus: 'semantic' },
    'verifier-semantic-02': { organization: 'org-g', strategyType: 'C_SEMANTIC_REASONER', focus: 'semantic' }
};

function buildRemoteAgentSpecs() {
    const directory = new AgentDirectory({ dirPath: DIRECTORY_PATH });
    const ids = directory.list();
    if (!ids.length) {
        throw new Error(`No agents found in directory ${DIRECTORY_PATH}. Run scripts/setup-agent-directory.js first.`);
    }
    return ids.map((agentId) => {
        const cfg = directory.load(agentId);
        const meta = AGENT_META[agentId] || {};
        return {
            baseUrl: cfg.endpoint,
            agentId,
            role: 'VERIFIER',
            organization: cfg.organization || meta.organization || null,
            strategyType: cfg.strategyType || meta.strategyType || null,
            focus: meta.focus || null,
            sharedSecret: cfg.sharedSecret || null,
            timeoutMs: Number(process.env.AGENT_DEMO_TIMEOUT_MS) || 45000,
            enabled: true
        };
    });
}

/**
 * A fully-formed, legitimate cross-chain verification task: complete evidence bundle,
 * two independent collectors agreeing on one evidence hash, passing pre-verification,
 * and a clear semantic payload. This lets rule-based proof agents APPROVE and gives
 * the LLM-backed policy/semantic agents enough context to judge.
 */
function buildTaskAndContext() {
    const evidenceHash = '0x9f1c4e2a77b3d8e15c0a6b4f2d9e8a1c3b5d7f0e2a4c6b8d0f1e3a5c7b9d1e3f5';
    const sourceTxHash = '0xabc123def4567890aabbccddeeff00112233445566778899aabbccddeeff0011';
    const record = {
        batchId: 'ORCH-2024-001',
        product: 'organic apples',
        harvestDate: '2024-09-15',
        certification: 'organic',
        origin: 'Yantai orchard #7',
        custodyTransfer: 'FISCO_NET_01 -> FABRIC_NET_01'
    };

    const task = {
        taskId: 'cc_task_query_demo_001',
        queryId: 'query_demo_001',
        risk: 'NORMAL',
        sourceChain: 'FISCO_NET_01',
        targetChain: 'FABRIC_NET_01',
        evidenceVersion: 1,
        queryType: 'ORCHARD_PROVENANCE',
        // task.query is what the LLM prompt reads for query type and expected result.
        query: { type: 'ORCHARD_PROVENANCE', expected: record },
        payload: `Cross-chain orchard traceability query. Source chain FISCO_NET_01 block height 184213, `
            + `transaction ${sourceTxHash}, query type ORCHARD_PROVENANCE. Record: batch ORCH-2024-001 `
            + `(organic apples, harvested 2024-09-15, origin Yantai orchard #7), custody transferred to `
            + `FABRIC_NET_01. Evidence hash ${evidenceHash} confirmed by two independent collectors.`,
        evidenceBundle: {
            request: { txHash: sourceTxHash, blockHeight: 184213 },
            sourceTxHash,
            // Aliases the LLM prompt reads directly (evidence.blockHeight / evidence.txHash).
            blockHeight: 184213,
            txHash: sourceTxHash,
            payload: { found: true, result: record, record },
            payloadHash: '0x5d41402abc4b2a76b9719d911017c5924f0e3b6a8c2d1e9f7a3b5c7d9e1f3a5b',
            preVerification: { status: 'PASS', ok: true, checkedAt: new Date().toISOString() },
            sourceHeader: { number: 184213, hash: '0xhdr184213' },
            sourceHeaderHash: '0xhdr184213',
            queryProof: { commitment: { value: '0xc0mm1tment' }, queryObject: { statement: 'verify ORCH-2024-001 provenance' } },
            proofBundle: { commitment: { value: '0xc0mm1tment' }, queryObject: { statement: 'verify ORCH-2024-001 provenance' } },
            queryObject: { statement: 'verify ORCH-2024-001 provenance', queryType: 'ORCHARD_PROVENANCE' },
            collectorAttestations: [
                { organization: 'org-collector-a', evidenceHash },
                { organization: 'org-collector-b', evidenceHash }
            ]
        }
    };

    const context = {
        round: 1,
        session: {
            queryVerifyStatus: 'PASS',
            resultPayload: record
        }
    };

    return { task, context };
}

function createEventStore() {
    return {
        events: [],
        addEvent(event) {
            this.events.push(event);
        }
    };
}

function fmtPct(x) {
    return `${(Number(x || 0) * 100).toFixed(1)}%`;
}

async function main() {
    const writeJson = process.argv.includes('--json');
    console.log('========================================================');
    console.log(' Multi-Agent Negotiation over Docker containers');
    console.log('========================================================');

    const remoteAgents = buildRemoteAgentSpecs();
    console.log(`\nContainerized verifier Agents (${remoteAgents.length}), reached via published ports:`);
    for (const spec of remoteAgents) {
        console.log(`  - ${spec.agentId.padEnd(22)} ${spec.baseUrl.padEnd(26)} ${spec.strategyType}  [HMAC ${spec.sharedSecret ? 'on' : 'OFF'}]`);
    }

    const eventStore = createEventStore();
    const runtime = new AgentRuntime({
        eventStore,
        remoteAgents,
        remoteVerifierMode: 'replace' // exclude local in-process verifiers: negotiate ONLY with containers
    });

    const { task, context } = buildTaskAndContext();
    console.log(`\nTask: ${task.taskId} (risk=${task.risk}, ${task.sourceChain} -> ${task.targetChain})`);

    const t0 = Date.now();
    const evaluation = await runtime.evaluateTask(task, context);
    const protocol = new NegotiationProtocol({ eventStore });
    const outcome = await protocol.run({
        task,
        opinions: evaluation.opinions,
        coordination: evaluation.coordination,
        submitterPlan: evaluation.submitterPlan,
        round: 1,
        maxRounds: 1,
        behaviorAnalysis: evaluation.behaviorAnalysis,
        committee: evaluation.committee
    });
    runtime.finalizeRound({ opinions: evaluation.opinions, finalProposal: outcome.finalProposal });
    const elapsedMs = Date.now() - t0;

    const fp = outcome.finalProposal;

    console.log('\n--- Per-container opinions (commit-reveal sealed) ---');
    for (const op of evaluation.opinions) {
        const cr = op.commitReveal || {};
        console.log(
            `  ${String(op.agentId).padEnd(22)} ${String(op.decision).padEnd(8)} `
            + `conf=${Number(op.confidence).toFixed(2)} w=${Number(op.assignedWeight).toFixed(3)} `
            + `${op.remote ? '[remote ' + op.remoteEndpoint + ']' : '[local]'} `
            + `latency=${op.latencyMs}ms commitReveal=${cr.valid === true ? 'OK' : cr.valid}`
        );
    }

    console.log('\n--- Committee selection ---');
    console.log(`  groupSize=${fp.consensusRule.groupSize} threshold(theta)=${fp.consensusRule.threshold} minReveals=${fp.consensusRule.minimumRevealCount}`);
    console.log(`  selected: ${evaluation.committee.selected.map((a) => a.agentId).join(', ')}`);
    if ((evaluation.committee.excluded || []).length) {
        console.log(`  excluded: ${evaluation.committee.excluded.map((a) => a.agentId || a).join(', ')}`);
    }

    console.log('\n--- Weighted BFT aggregation (w_i = rep_i * confidence_i) ---');
    const q = fp.quorum || {};
    const decisiveWeight = Number(q.approvedEffectiveWeight || 0) + Number(q.rejectedEffectiveWeight || 0);
    console.log(`  validReveals=${q.validRevealCount}/${q.total} (need >=${q.required}, enough=${q.enoughReveals})`);
    console.log(`  approve=${q.approved} reject=${q.rejected} question=${q.questioned}  decisiveEffectiveWeight=${decisiveWeight.toFixed(4)}`);
    console.log(`  acceptRatio=${fmtPct(q.acceptRatio)}  rejectRatio=${fmtPct(q.rejectRatio)}  thresholdRatio=${fmtPct(q.thresholdRatio)}`);
    console.log(`  commitRevealValid(all)=${fp.weightVector.every((w) => w.commitRevealValid === true)}`);

    console.log('\n========================================================');
    console.log(` FINAL DECISION: ${fp.finalDecision}   (proposal ${fp.proposalId})`);
    console.log(` status=${outcome.status}  rounds=${fp.rounds}  total negotiation time=${elapsedMs}ms`);
    console.log('========================================================');

    if (writeJson) {
        const outDir = path.resolve(__dirname, '../../../docs/xn/experiments');
        fs.mkdirSync(outDir, { recursive: true });
        const outFile = path.join(outDir, 'container-negotiation-latest.json');
        const artifact = {
            generatedAt: new Date().toISOString(),
            mode: 'docker-multi-container',
            transport: 'http + hmac-sha256',
            agents: remoteAgents.map((s) => ({ agentId: s.agentId, endpoint: s.baseUrl, strategyType: s.strategyType, hmac: Boolean(s.sharedSecret) })),
            task: { taskId: task.taskId, queryId: task.queryId, risk: task.risk, sourceChain: task.sourceChain, targetChain: task.targetChain },
            elapsedMs,
            finalProposal: fp,
            negotiationEvents: eventStore.events
        };
        fs.writeFileSync(outFile, JSON.stringify(artifact, null, 2));
        console.log(`\nArtifact written: ${outFile}`);
    }
}

main().catch((error) => {
    console.error('\nDEMO FAILED:', error.message);
    process.exit(1);
});
