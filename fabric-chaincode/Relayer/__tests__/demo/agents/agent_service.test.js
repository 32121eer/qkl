const http = require('node:http');
const { createAgentApp, createAgentFromEnv } = require('../../../demo/agents/agent_service');
const { VerifierAgent } = require('../../../demo/agents/verifier_agent');

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
        taskId: 'task_1',
        queryId: 'query_1',
        targetChain: 'FABRIC_NET_01',
        evidenceVersion: 2,
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

describe('agent service', () => {
    test('exposes health and descriptor for a verifier agent', async () => {
        const agent = new VerifierAgent({
            agentId: 'verifier-http-01',
            focus: 'balanced',
            organization: 'org-http'
        });
        const app = createAgentApp({ agent, serviceName: 'test-agent-service' });

        await withServer(app, async (baseUrl) => {
            const healthResponse = await fetch(`${baseUrl}/health`);
            const health = await healthResponse.json();
            expect(healthResponse.status).toBe(200);
            expect(health.status).toBe('ok');
            expect(health.agentId).toBe('verifier-http-01');

            const descriptorResponse = await fetch(`${baseUrl}/descriptor`);
            const descriptor = await descriptorResponse.json();
            expect(descriptorResponse.status).toBe(200);
            expect(descriptor.success).toBe(true);
            expect(descriptor.descriptor).toEqual(expect.objectContaining({
                agentId: 'verifier-http-01',
                role: 'VERIFIER',
                organization: 'org-http'
            }));
        });
    });

    test('executes verifier task through POST /execute', async () => {
        const agent = new VerifierAgent({
            agentId: 'verifier-http-02',
            focus: 'balanced',
            organization: 'org-http'
        });
        const app = createAgentApp({ agent });

        await withServer(app, async (baseUrl) => {
            const response = await fetch(`${baseUrl}/execute`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    task: createTask(),
                    context: {
                        round: 2,
                        assignedWeight: 0.25,
                        session: {
                            queryVerifyStatus: 'PASS'
                        },
                        submitterPlan: {
                            readyForSubmission: true
                        }
                    }
                })
            });
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.success).toBe(true);
            expect(data.result).toEqual(expect.objectContaining({
                agentId: 'verifier-http-02',
                role: 'VERIFIER',
                decision: 'APPROVE',
                assignedWeight: 0.25,
                focus: 'balanced'
            }));
            expect(data.result.checks.collectorQuorum).toBe(true);
            expect(data.result.checks.queryProofValid).toBe(true);
        });
    });

    test('rejects execute requests without a task object', async () => {
        const app = createAgentApp({
            agent: new VerifierAgent({ agentId: 'verifier-http-03' })
        });

        await withServer(app, async (baseUrl) => {
            const response = await fetch(`${baseUrl}/execute`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ context: { round: 1 } })
            });
            const data = await response.json();

            expect(response.status).toBe(400);
            expect(data.success).toBe(false);
            expect(data.error).toContain('task object is required');
        });
    });

    test('creates verifier agent from environment variables', () => {
        const agent = createAgentFromEnv({
            AGENT_ROLE: 'verifier',
            AGENT_ID: 'verifier-proof-remote-01',
            AGENT_FOCUS: 'proof',
            AGENT_ORGANIZATION: 'org-remote'
        });

        expect(agent.getDescriptor()).toEqual(expect.objectContaining({
            agentId: 'verifier-proof-remote-01',
            role: 'VERIFIER',
            organization: 'org-remote',
            strategyType: 'A_PROOF_VALIDATOR'
        }));
        expect(agent.strictProof).toBe(true);
    });
});
