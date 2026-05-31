const { buildQueryObject } = require('../../../demo/query/query_object');
const { buildQueryProof } = require('../../../demo/query/query_proof_builder');
const { buildQueryCommitment } = require('../../../demo/query/query_commitment');

describe('buildQueryProof', () => {
    const queryObject = buildQueryObject({ orchardBatchId: 'BATCH-APPLE-0001' });
    const resultValue = { found: true, record: { orchardBatchId: 'BATCH-APPLE-0001' } };
    const sourceHeader = { chainId: 'FABRIC_NET_01', blockNumber: 123, queryId: 'query_1' };

    test('output includes required fields', () => {
        const proof = buildQueryProof({
            queryObject,
            resultValue,
            sourceHeight: 123,
            sourceHeader,
            meta: { schema: 'orchard-record-v1' }
        });

        expect(proof).toMatchObject({
            version: 'query-proof-v1',
            queryObject,
            resultValue,
            sourceChain: 'FABRIC_NET_01',
            sourceHeight: 123,
            sourceHeader,
            sourceHeaderHash: expect.stringMatching(/^0x[0-9a-f]{64}$/),
            stateWitness: {
                type: 'record-snapshot',
                recordHash: expect.stringMatching(/^0x[0-9a-f]{64}$/),
                sourceFunction: 'GetOrchardRecord',
                note: 'prototype witness, not full merkle proof'
            },
            meta: expect.objectContaining({ schema: 'orchard-record-v1' }),
            commitment: expect.objectContaining({
                version: 'query-proof-v1',
                algorithm: 'sha256',
                value: expect.stringMatching(/^0x[0-9a-f]{64}$/)
            })
        });
    });

    test('commitment matches builder inputs', () => {
        const proof = buildQueryProof({
            queryObject,
            resultValue,
            sourceHeight: 123,
            sourceHeader,
            meta: { schema: 'orchard-record-v1' }
        });
        const expected = buildQueryCommitment({
            queryObject,
            sourceHeight: 123,
            sourceHeaderHash: proof.sourceHeaderHash,
            resultValue,
            meta: proof.meta
        });

        expect(proof.commitment.value).toBe(expected.value);
    });

    test('missing header throws clear error', () => {
        expect(() => buildQueryProof({
            queryObject,
            resultValue,
            sourceHeight: 123
        })).toThrow('sourceHeader is required to build query proof');
    });

    test('missing result throws clear error', () => {
        expect(() => buildQueryProof({
            queryObject,
            sourceHeight: 123,
            sourceHeader
        })).toThrow('resultValue is required to build query proof');
    });
});
