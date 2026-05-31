const {
    QUERY_PROOF_VERSION,
    RECORD_SNAPSHOT_WITNESS_TYPE,
    DEFAULT_QUERY_CHAIN_ID,
    DEFAULT_SOURCE_FUNCTION,
    PROTOTYPE_WITNESS_NOTE
} = require('./query_types');
const { stableStringify, sha256Hex, buildQueryCommitment } = require('./query_commitment');

function buildQueryProof({
    queryObject,
    resultValue,
    sourceChain = DEFAULT_QUERY_CHAIN_ID,
    sourceHeight,
    sourceHeader,
    sourceHeaderHash,
    meta = {},
    sourceFunction = DEFAULT_SOURCE_FUNCTION
} = {}) {
    if (!queryObject || typeof queryObject !== 'object') {
        throw new Error('queryObject is required to build query proof');
    }
    if (!sourceHeader || typeof sourceHeader !== 'object') {
        throw new Error('sourceHeader is required to build query proof');
    }
    if (resultValue === undefined) {
        throw new Error('resultValue is required to build query proof');
    }

    const normalizedSourceHeaderHash = sourceHeaderHash || sha256Hex(stableStringify(sourceHeader));
    const recordHash = sha256Hex(stableStringify(resultValue));
    const normalizedMeta = {
        generatedAt: meta.generatedAt || new Date().toISOString(),
        ...meta
    };
    const commitment = buildQueryCommitment({
        queryObject,
        sourceHeight,
        sourceHeaderHash: normalizedSourceHeaderHash,
        resultValue,
        meta: normalizedMeta
    });

    return {
        version: QUERY_PROOF_VERSION,
        queryObject,
        resultValue,
        sourceChain,
        sourceHeight: sourceHeight ?? null,
        sourceHeader,
        sourceHeaderHash: normalizedSourceHeaderHash,
        stateWitness: {
            type: RECORD_SNAPSHOT_WITNESS_TYPE,
            recordHash,
            sourceFunction,
            note: PROTOTYPE_WITNESS_NOTE
        },
        meta: normalizedMeta,
        commitment
    };
}

module.exports = {
    buildQueryProof
};
