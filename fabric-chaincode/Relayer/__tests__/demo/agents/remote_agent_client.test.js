const http = require('node:http');
const { AgentRuntime } = require('../../../demo/agents/agent_runtime');
const { createAgentApp } = require('../../../demo/agents/agent_service');
const { VerifierAgent } = require('../../../demo/agents/verifier_agent');
const { RemoteAgentClient } = require('../../../demo/agents/remote_agent_client');
const { readRemoteAgentSpecs } = require('../../../demo/agents/remote_agent_registry');

async function withServer(app, handler) {
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;
    try {
        await handler(baseUrl);
    } finally {
        await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
}

function createTask() {
    return {
        taskId: 'task_remote_1',
        queryId: 'query_remote_1',
        targetChain: 'FABRIC_NET_01',
        evidenceVersion: 3,
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

describe('remote agent client', () => {
    test('loads descriptor and executes a remote verifier agent', async () => {
        const app = createAgentApp({
            agent: new VerifierAgent({
                agentId: 'verifier-remote-http-01',
                focus: 'balanced',
                organization: 'org-remote-http'
            })
        });

        await withServer(app, async (baseUrl) => {
            const client = new RemoteAgentClient({
                baseUrl,
                agentId: 'placeholder-remote',
                organization: 'placeholder-org'
            });

            const descriptor = await client.refreshDescriptor();
            expect(descriptor).toEqual(expect.objectContaining({
                agentId: 'verifier-remote-http-01',
                role: 'VERIFIER',
                organization: 'org-remote-http',
                remote: true,
                available: true
            }));

            const result = await client.execute(createTask(), {
                round: 2,
                assignedWeight: 0.5,
                session: {
                    queryVerifyStatus: 'PASS'
                },
                submitterPlan: {
                    readyForSubmission: true
                }
            });

            expect(result).toEqual(expect.objectContaining({
                agentId: 'verifier-remote-http-01',
                role: 'VERIFIER',
                decision: 'APPROVE',
                assignedWeight: 0.5,
                remote: true,
                remoteEndpoint: baseUrl
            }));
        });
    });

    test('AgentRuntime can evaluate with a remote verifier in replace mode', async () => {
        const app = createAgentApp({
            agent: new VerifierAgent({
                agentId: 'verifier-remote-runtime-01',
                focus: 'balanced',
                organization: 'org-remote-runtime'
            })
        });

        await withServer(app, async (baseUrl) => {
            const runtime = new AgentRuntime({
                remoteVerifierMode: 'replace',
                remoteAgents: [{
                    baseUrl,
                    agentId: 'verifier-remote-runtime-01',
                    role: 'VERIFIER',
                    organization: 'org-remote-runtime',
                    strategyType: 'B_POLICY_CHECKER',
                    focus: 'balanced',
                    timeoutMs: 1000
                }]
            });

            const result = await runtime.evaluateTask(createTask(), {
                round: 2,
                session: {
                    queryVerifyStatus: 'PASS'
                },
                submitterPlan: {
                    readyForSubmission: true
                }
            });

            expect(result.committee.selected).toHaveLength(1);
            expect(result.committee.selected[0]).toEqual(expect.objectContaining({
                agentId: 'verifier-remote-runtime-01',
                remote: true,
                endpoint: baseUrl
            }));
            expect(result.opinions).toHaveLength(1);
            expect(result.opinions[0]).toEqual(expect.objectContaining({
                agentId: 'verifier-remote-runtime-01',
                decision: 'APPROVE',
                remote: true,
                commitReveal: expect.objectContaining({
                    valid: true
                })
            }));
            expect(result.coordination).toEqual(expect.objectContaining({
                status: 'READY',
                summary: expect.objectContaining({
                    approve: 1,
                    reject: 0,
                    question: 0
                })
            }));
            expect(result.submitterPlan).toEqual(expect.objectContaining({
                agentId: 'submitter-01'
            }));
        });
    });

    test('reads remote verifier URLs from environment-style config', () => {
        const specs = readRemoteAgentSpecs({
            DEMO_REMOTE_VERIFIER_URLS: 'http://agent-a:19111, http://agent-b:19112'
        });

        expect(specs).toEqual([
            expect.objectContaining({
                baseUrl: 'http://agent-a:19111',
                agentId: 'remote-verifier-01',
                role: 'VERIFIER'
            }),
            expect.objectContaining({
                baseUrl: 'http://agent-b:19112',
                agentId: 'remote-verifier-02',
                role: 'VERIFIER'
            })
        ]);
    });
});
