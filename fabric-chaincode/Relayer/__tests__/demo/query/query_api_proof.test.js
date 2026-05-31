const express = require('express');
const http = require('node:http');
const { attachQueryRoutes } = require('../../../demo/api/routes_query');
const { attachProofCardRoutes } = require('../../../demo/api/routes_proof_cards');
const { DemoApiServer } = require('../../../demo/api_server');

function createSession() {
    return {
        queryId: 'query_1',
        orchardBatchId: 'BATCH-APPLE-0001',
        status: 'COMPLETED',
        verifyStatus: 'PASS',
        queryObject: {
            chainId: 'FABRIC_NET_01',
            namespace: 'orchard',
            key: 'batch:BATCH-APPLE-0001',
            queryType: 'single-key-read',
            codec: 'json',
            context: {
                channel: 'mychannel',
                chaincode: 'gateway_cc',
                schema: 'orchard-record-v1'
            }
        },
        queryCommitment: {
            version: 'query-proof-v1',
            algorithm: 'sha256',
            value: '0xcommitment',
            inputs: {
                sourceHeight: 123,
                sourceHeaderHash: '0xheader'
            }
        },
        queryVerifyStatus: 'PASS',
        queryVerifyChecks: {
            queryObjectMatched: true,
            headerMatched: true,
            stateWitnessMatched: true,
            commitmentMatched: true
        },
        queryProofVersion: 'query-proof-v1',
        queryProof: {
            version: 'query-proof-v1',
            sourceChain: 'FABRIC_NET_01',
            sourceHeight: 123,
            sourceHeaderHash: '0xheader',
            stateWitness: {
                type: 'record-snapshot',
                recordHash: '0xrecord',
                sourceFunction: 'GetOrchardRecord',
                note: 'prototype witness, not full merkle proof'
            },
            commitment: {
                value: '0xcommitment'
            }
        }
    };
}

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

describe('query proof api', () => {
    test('query detail response contains proof summary fields', async () => {
        const session = createSession();
        const app = express();
        const demo = {
            parseQuerySessionLimit: () => ({ value: 20, error: null }),
            querySessionService: {
                list: async () => [session],
                get: async () => session
            },
            presentQuerySession: (item) => ({
                ...item,
                queryCommitment: {
                    version: item.queryCommitment.version,
                    algorithm: item.queryCommitment.algorithm,
                    value: item.queryCommitment.value,
                    sourceHeight: item.queryCommitment.inputs.sourceHeight,
                    sourceHeaderHash: item.queryCommitment.inputs.sourceHeaderHash
                },
                resultCommitment: {
                    version: item.queryCommitment.version,
                    algorithm: item.queryCommitment.algorithm,
                    value: item.queryCommitment.value,
                    sourceHeight: item.queryCommitment.inputs.sourceHeight,
                    sourceHeaderHash: item.queryCommitment.inputs.sourceHeaderHash
                },
                queryProofSummary: {
                    version: item.queryProof.version,
                    sourceHeight: item.queryProof.sourceHeight,
                    sourceHeaderHash: item.queryProof.sourceHeaderHash,
                    witnessType: item.queryProof.stateWitness.type
                },
                queryVerifyResult: {
                    ok: true,
                    checks: item.queryVerifyChecks,
                    commitment: item.queryCommitment.value,
                    verifiedAt: '2026-03-31T00:00:00.000Z'
                }
            })
        };
        attachQueryRoutes(app, demo);

        await withServer(app, async (baseUrl) => {
            const response = await fetch(`${baseUrl}/demo/app/query/sessions/query_1`);
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.item.queryObject).toBeTruthy();
            expect(data.item.queryCommitment).toEqual(expect.objectContaining({
                value: '0xcommitment'
            }));
            expect(data.item.queryVerifyStatus).toBe('PASS');
            expect(data.item.queryVerifyChecks.commitmentMatched).toBe(true);
            expect(data.item.resultCommitment.value).toBe('0xcommitment');
            expect(data.item.queryVerifyResult.ok).toBe(true);
        });
    });

    test('session verify endpoint executes VerifyQuery in API layer', async () => {
        const session = createSession();
        const app = express();
        const demo = {
            parseQuerySessionLimit: () => ({ value: 20, error: null }),
            querySessionService: {
                list: async () => [session],
                get: async () => session
            },
            executeVerifyQuery: () => ({
                ok: false,
                checks: {
                    queryObjectMatched: true,
                    headerMatched: true,
                    stateWitnessMatched: true,
                    commitmentMatched: false
                },
                commitment: '0xcommitment',
                verifiedAt: '2026-03-31T00:00:00.000Z'
            }),
            presentQuerySession: (item) => ({
                ...item,
                queryVerifyStatus: 'FAILED',
                queryVerifyChecks: {
                    queryObjectMatched: true,
                    headerMatched: true,
                    stateWitnessMatched: true,
                    commitmentMatched: false
                }
            })
        };
        attachQueryRoutes(app, demo);

        await withServer(app, async (baseUrl) => {
            const response = await fetch(`${baseUrl}/demo/app/query/sessions/query_1/verify`);
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.success).toBe(true);
            expect(data.verified.ok).toBe(false);
            expect(data.verified.checks.commitmentMatched).toBe(false);
            expect(data.session.queryVerifyStatus).toBe('FAILED');
        });
    });

    test('session verify endpoint returns explicit missing proof error', async () => {
        const session = {
            queryId: 'query_1',
            orchardBatchId: 'BATCH-APPLE-0001',
            status: 'COMPLETED',
            queryVerifyStatus: 'PENDING',
            queryProof: null,
            proofBundle: null
        };
        const app = express();
        const demo = {
            parseQuerySessionLimit: () => ({ value: 20, error: null }),
            querySessionService: {
                list: async () => [session],
                get: async () => session
            },
            executeVerifyQuery: () => null,
            presentQuerySession: (item) => item
        };
        attachQueryRoutes(app, demo);

        await withServer(app, async (baseUrl) => {
            const response = await fetch(`${baseUrl}/demo/app/query/sessions/query_1/verify`);
            const data = await response.json();

            expect(response.status).toBe(409);
            expect(data.success).toBe(false);
            expect(data.error).toContain('not available');
        });
    });

    test('proof-card endpoint includes query-proof summary', async () => {
        const app = express();
        const demo = {
            PROOF_MAX_LIMIT: 100,
            parseProofCardLimit: () => ({ value: 20, error: null }),
            buildProofCards: async () => [{
                cardId: 'query_1',
                kind: 'query-proof',
                queryProofVersion: 'query-proof-v1',
                queryProof: {
                    status: 'PASS',
                    summary: {
                        sourceHeight: 123,
                        sourceHeaderHash: '0xheader',
                        witnessType: 'record-snapshot'
                    }
                }
            }]
        };
        attachProofCardRoutes(app, demo);

        await withServer(app, async (baseUrl) => {
            const response = await fetch(`${baseUrl}/demo/app/proof-cards?limit=20`);
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.items[0]).toEqual(expect.objectContaining({
                kind: 'query-proof',
                queryProofVersion: 'query-proof-v1'
            }));
            expect(data.items[0].queryProof.summary.witnessType).toBe('record-snapshot');
        });
    });

    test('final session without proof is marked as MISSING', async () => {
        const server = new DemoApiServer({}, { chains: [] });

        const presented = server.presentQuerySession({
            queryId: 'query_1',
            orchardBatchId: 'BATCH-APPLE-0001',
            status: 'COMPLETED',
            queryVerifyStatus: 'PENDING',
            queryProof: null,
            proofBundle: null,
            requestTs: '2026-03-31T00:00:00.000Z'
        });

        expect(presented.queryVerifyStatus).toBe('MISSING');
        expect(presented.queryVerifyResult).toBe(null);
    });

    test('proof-card builder keeps missing proof explicit instead of PASS', async () => {
        const server = new DemoApiServer({}, { chains: [] });
        server.querySessionService.list = async () => [{
            queryId: 'query_1',
            orchardBatchId: 'BATCH-APPLE-0001',
            status: 'COMPLETED',
            queryVerifyStatus: 'PENDING',
            queryProof: null,
            proofBundle: null,
            requestTs: '2026-03-31T00:00:00.000Z'
        }];

        const cards = await server.buildProofCards(20);

        expect(cards).toHaveLength(1);
        expect(cards[0].queryProof.status).toBe('MISSING');
        expect(cards[0].status).toBe('MISSING');
    });
});
