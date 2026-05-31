const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { AgentRuntime } = require('../../../demo/agents/agent_runtime');
const { AgentRegistryJsonStore } = require('../../../demo/store/agent_registry_store');

function createTask() {
    return {
        taskId: 'task_json_registry_1',
        queryId: 'query_json_registry_1',
        targetChain: 'FABRIC_NET_01',
        evidenceVersion: 1,
        evidenceBundle: {
            request: {
                txHash: '0xrequest'
            },
            payload: {
                found: true,
                result: {
                    orchardBatchId: 'APPLE-FARM-2026-S1'
                }
            },
            collectorAttestations: [{
                organization: 'org-collector-a',
                evidenceHash: '0xevidence'
            }, {
                organization: 'org-collector-b',
                evidenceHash: '0xevidence'
            }],
            preVerification: {
                status: 'PASS'
            },
            sourceHeaderHash: '0xheader',
            queryProof: {
                queryObject: {
                    key: 'batch:APPLE-FARM-2026-S1'
                }
            }
        }
    };
}

function tempRegistryPath() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-registry-json-'));
    return path.join(dir, 'agent-registry.json');
}

describe('Agent registry JSON store', () => {
    test('persists agent descriptors and reputation updates after a round', () => {
        const filePath = tempRegistryPath();
        const store = new AgentRegistryJsonStore({ filePath });
        const runtime = new AgentRuntime({
            agentRegistryStore: store
        });

        const opinions = [{
            agentId: 'verifier-proof-01',
            decision: 'APPROVE',
            confidence: 1,
            latencyMs: 12
        }];
        const updates = runtime.finalizeRound({
            opinions,
            finalProposal: {
                proposalId: 'proposal_json_registry_1',
                taskId: 'task_json_registry_1',
                queryId: 'query_json_registry_1',
                finalDecision: 'COMMIT'
            }
        });

        const saved = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        expect(saved.agents).toEqual(expect.arrayContaining([
            expect.objectContaining({
                agentId: 'verifier-proof-01',
                role: 'VERIFIER',
                kind: 'local',
                enabled: true
            })
        ]));
        expect(saved.reputationByAgentId['verifier-proof-01']).toEqual(expect.objectContaining({
            agentId: 'verifier-proof-01',
            successCount: 1,
            totalCount: 1
        }));
        expect(saved.recentRounds[0]).toEqual(expect.objectContaining({
            proposalId: 'proposal_json_registry_1',
            finalDecision: 'COMMIT',
            opinionCount: 1
        }));
        expect(updates[0]).toEqual(expect.objectContaining({
            agentId: 'verifier-proof-01',
            successCount: 1
        }));
    });

    test('reloads persisted reputation and uses JSON enabled flags before selection', async () => {
        const filePath = tempRegistryPath();
        const store = new AgentRegistryJsonStore({ filePath });
        store.save({
            agents: [{
                agentId: 'verifier-proof-01',
                role: 'VERIFIER',
                kind: 'local',
                focus: 'proof',
                strictProof: true,
                organization: 'org-b',
                strategyType: 'A_PROOF_VALIDATOR',
                enabled: false
            }],
            reputationByAgentId: {
                'verifier-balanced-01': {
                    agentId: 'verifier-balanced-01',
                    weight: 0.91,
                    qualityScore: 0.9,
                    trustScore: 0.95,
                    latencyScore: 0.9,
                    riskPenalty: 0,
                    qualityWeight: 0.91,
                    trustWeight: 0.91,
                    combinedWeightRaw: 0.91,
                    successCount: 7,
                    totalCount: 7,
                    avgLatencyMs: 25,
                    faultCount: 0,
                    alignmentScore: 7,
                    overconfidentFaultCount: 0,
                    lastUpdatedAt: '2026-05-10T00:00:00.000Z',
                    formulaVersion: 'ma3c-wbft-v1'
                }
            }
        });

        const runtime = new AgentRuntime({
            agentRegistryStore: store
        });

        expect(runtime.reputationStore.get('verifier-balanced-01')).toEqual(expect.objectContaining({
            successCount: 7,
            trustScore: 0.95
        }));

        const result = await runtime.evaluateTask(createTask(), {
            round: 2,
            session: {
                queryVerifyStatus: 'PASS'
            },
            submitterPlan: {
                readyForSubmission: true
            }
        });

        const selectedIds = result.committee.selected.map((item) => item.agentId);
        expect(selectedIds).not.toContain('verifier-proof-01');
        expect(runtime.registry.get('verifier-proof-01').enabled).toBe(false);
    });
});
