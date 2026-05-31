const { buildQueryObject } = require('../../../demo/query/query_object');
const { buildQueryProof } = require('../../../demo/query/query_proof_builder');
const { verifyQueryProof } = require('../../../demo/query/query_verifier');

describe('verifyQueryProof', () => {
    const queryObject = buildQueryObject({ orchardBatchId: 'BATCH-APPLE-0001' });
    const resultValue = { found: true, record: { orchardBatchId: 'BATCH-APPLE-0001' } };
    const sourceHeader = { chainId: 'FABRIC_NET_01', blockNumber: 123, queryId: 'query_1' };

    function createProof() {
        return buildQueryProof({
            queryObject,
            resultValue,
            sourceHeight: 123,
            sourceHeader,
            meta: { schema: 'orchard-record-v1' }
        });
    }

    test('valid proof returns ok true', () => {
        const proof = createProof();
        const verified = verifyQueryProof({
            proof,
            queryObject,
            resultValue,
            sourceHeaderHash: proof.sourceHeaderHash
        });

        expect(verified.ok).toBe(true);
        expect(verified.checks).toEqual({
            queryObjectMatched: true,
            headerMatched: true,
            stateWitnessMatched: true,
            commitmentMatched: true
        });
    });

    test('query object tampered marks queryObjectMatched false', () => {
        const proof = createProof();
        proof.queryObject = buildQueryObject({ orchardBatchId: 'BATCH-APPLE-0002' });

        const verified = verifyQueryProof({
            proof,
            queryObject,
            resultValue,
            sourceHeaderHash: proof.sourceHeaderHash
        });

        expect(verified.checks.queryObjectMatched).toBe(false);
    });

    test('header hash tampered marks headerMatched false', () => {
        const proof = createProof();
        proof.sourceHeaderHash = '0xdeadbeef';

        const verified = verifyQueryProof({
            proof,
            queryObject,
            resultValue
        });

        expect(verified.checks.headerMatched).toBe(false);
    });

    test('result hash tampered marks stateWitnessMatched false', () => {
        const proof = createProof();
        proof.stateWitness.recordHash = '0xdeadbeef';

        const verified = verifyQueryProof({
            proof,
            queryObject,
            resultValue,
            sourceHeaderHash: proof.sourceHeaderHash
        });

        expect(verified.checks.stateWitnessMatched).toBe(false);
    });

    test('commitment tampered marks commitmentMatched false', () => {
        const proof = createProof();
        proof.commitment.value = '0xdeadbeef';

        const verified = verifyQueryProof({
            proof,
            queryObject,
            resultValue,
            sourceHeaderHash: proof.sourceHeaderHash
        });

        expect(verified.checks.commitmentMatched).toBe(false);
    });

    test('result value tampered marks commitmentMatched false', () => {
        const proof = createProof();
        proof.resultValue = { found: false, record: null };

        const verified = verifyQueryProof({
            proof,
            queryObject,
            resultValue,
            sourceHeaderHash: proof.sourceHeaderHash
        });

        expect(verified.checks.stateWitnessMatched).toBe(false);
        expect(verified.checks.commitmentMatched).toBe(false);
    });
});
