const crypto = require('node:crypto');

function stableStringify(value) {
    if (value === null || typeof value !== 'object') {
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        return `[${value.map((item) => stableStringify(item)).join(',')}]`;
    }
    return `{${Object.keys(value)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
        .join(',')}}`;
}

function sha256Hex(value) {
    return `0x${crypto.createHash('sha256').update(String(value)).digest('hex')}`;
}

function buildReasonHash(reasons = []) {
    return sha256Hex(stableStringify(Array.isArray(reasons) ? reasons : [reasons]));
}

function buildCommitment({ judgment, confidence, nonce }) {
    return sha256Hex(stableStringify({
        judgment: String(judgment || '').toUpperCase(),
        confidence: Number(confidence || 0),
        nonce
    }));
}

function generateNonce() {
    return crypto.randomBytes(16).toString('hex');
}

function sealOpinion(opinion, { task, round } = {}) {
    const judgment = opinion.decision === 'APPROVE'
        ? 'ACCEPT'
        : opinion.decision === 'REJECT'
            ? 'REJECT'
            : 'ABSTAIN';
    const nonce = generateNonce();
    const reasonHash = buildReasonHash(opinion.reasons || []);
    const commitHash = buildCommitment({
        judgment,
        confidence: opinion.confidence,
        nonce
    });

    return {
        ...opinion,
        judgment,
        reasonHash,
        commitReveal: {
            phase: 'REVEALED',
            commitHash,
            committedAt: opinion.generatedAt || new Date().toISOString(),
            revealedAt: new Date().toISOString(),
            reveal: {
                judgment,
                confidence: Number(opinion.confidence || 0),
                nonce,
                reasonHash
            },
            valid: buildCommitment({
                judgment,
                confidence: opinion.confidence,
                nonce
            }) === commitHash
        }
    };
}

module.exports = {
    buildCommitment,
    buildReasonHash,
    sealOpinion,
    sha256Hex,
    stableStringify
};
