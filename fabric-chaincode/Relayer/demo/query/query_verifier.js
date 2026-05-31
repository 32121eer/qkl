const { RECORD_SNAPSHOT_WITNESS_TYPE } = require('./query_types');
const { stableStringify, sha256Hex, buildQueryCommitment } = require('./query_commitment');

function VerifyQuery({
    proof,
    queryObject,
    resultValue,
    sourceHeaderHash
} = {}) {
    if (!proof || typeof proof !== 'object') {
        throw new Error('proof is required for query verification');
    }

    const expectedQueryObject = queryObject || proof.queryObject;
    const expectedResultValue = resultValue !== undefined ? resultValue : proof.resultValue;
    const computedHeaderHash = sha256Hex(stableStringify(proof.sourceHeader || null));
    const expectedHeaderHash = sourceHeaderHash || computedHeaderHash;
    const actualRecordHash = sha256Hex(stableStringify(proof.resultValue));
    const expectedRecordHash = sha256Hex(stableStringify(expectedResultValue));

    const queryObjectMatched = stableStringify(proof.queryObject) === stableStringify(expectedQueryObject);
    const headerMatched =
        proof.sourceHeaderHash === computedHeaderHash &&
        proof.sourceHeaderHash === expectedHeaderHash;
    const stateWitnessMatched =
        proof.stateWitness?.type === RECORD_SNAPSHOT_WITNESS_TYPE &&
        proof.stateWitness?.recordHash === actualRecordHash &&
        proof.stateWitness?.recordHash === expectedRecordHash;

    let expectedCommitment = null;
    let actualProofCommitment = null;
    let commitmentMatched = false;
    try {
        expectedCommitment = buildQueryCommitment({
            queryObject: expectedQueryObject,
            sourceHeight: proof.sourceHeight,
            sourceHeaderHash: expectedHeaderHash,
            resultValue: expectedResultValue,
            meta: proof.meta || {}
        });
        actualProofCommitment = buildQueryCommitment({
            queryObject: proof.queryObject,
            sourceHeight: proof.sourceHeight,
            sourceHeaderHash: proof.sourceHeaderHash,
            resultValue: proof.resultValue,
            meta: proof.meta || {}
        });
        commitmentMatched =
            proof.commitment?.value === expectedCommitment.value &&
            proof.commitment?.value === actualProofCommitment.value;
    } catch (_error) {
        commitmentMatched = false;
    }

    const ok = queryObjectMatched && headerMatched && stateWitnessMatched && commitmentMatched;

    return {
        ok,
        checks: {
            queryObjectMatched,
            headerMatched,
            stateWitnessMatched,
            commitmentMatched
        },
        commitment: proof.commitment?.value || expectedCommitment?.value || null,
        verifiedAt: new Date().toISOString()
    };
}

function buildSessionResultValue(session = {}) {
    if (session.queryProof?.resultValue !== undefined) {
        return session.queryProof.resultValue;
    }
    if (session.resultFound === null || session.resultFound === undefined) {
        return undefined;
    }
    return {
        found: Boolean(session.resultFound),
        record: session.resultPayload ?? null
    };
}

function verifyQuerySession(session = {}) {
    const proof = session.proofBundle || session.queryProof;
    if (!proof) {
        return null;
    }

    return VerifyQuery({
        proof,
        queryObject: session.queryObject || proof.queryObject,
        resultValue: buildSessionResultValue(session),
        sourceHeaderHash: proof.sourceHeaderHash
    });
}

module.exports = {
    VerifyQuery,
    verifyQueryProof: VerifyQuery,
    verifyQuerySession
};
