const crypto = require('node:crypto');
const { QUERY_PROOF_VERSION } = require('./query_types');

function stableStringify(value) {
    if (value === null) {
        return 'null';
    }

    if (Array.isArray(value)) {
        return `[${value.map((item) => stableStringify(item === undefined ? null : item)).join(',')}]`;
    }

    if (typeof value === 'object') {
        const keys = Object.keys(value).filter((key) => value[key] !== undefined).sort();
        return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
    }

    return JSON.stringify(value);
}

function sha256Hex(value) {
    return `0x${crypto.createHash('sha256').update(String(value), 'utf8').digest('hex')}`;
}

function buildQueryCommitment({
    queryObject,
    sourceHeight,
    sourceHeaderHash,
    resultValue,
    meta = {}
} = {}) {
    if (!queryObject || typeof queryObject !== 'object') {
        throw new Error('queryObject is required to build query commitment');
    }
    if (sourceHeaderHash === undefined || sourceHeaderHash === null || sourceHeaderHash === '') {
        throw new Error('sourceHeaderHash is required to build query commitment');
    }
    if (resultValue === undefined) {
        throw new Error('resultValue is required to build query commitment');
    }

    const inputs = {
        version: QUERY_PROOF_VERSION,
        queryObject,
        sourceHeight: sourceHeight ?? null,
        sourceHeaderHash,
        resultValue,
        meta: meta || {}
    };
    const serialized = stableStringify(inputs);

    return {
        version: QUERY_PROOF_VERSION,
        algorithm: 'sha256',
        value: sha256Hex(serialized),
        inputs,
        serialized
    };
}

module.exports = {
    stableStringify,
    sha256Hex,
    buildQueryCommitment
};
