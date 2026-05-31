const { stableStringify, sha256Hex } = require('../query/query_commitment');

function normalizeAgentVector(items = []) {
    return items.map((item) => ({
        agentId: item.agentId || item,
        weight: Number(item.weight || 0)
    })).sort((left, right) => String(left.agentId).localeCompare(String(right.agentId)));
}

function buildNegotiationProof({
    queryId,
    orchardBatchId,
    finalProposal,
    queryCommitment,
    evidenceVersion,
    responsePayload
}) {
    if (!finalProposal?.proposalId) {
        throw new Error('finalProposal is required to build negotiation proof');
    }
    if (!queryCommitment?.value) {
        throw new Error('queryCommitment is required to build negotiation proof');
    }

    const inputs = {
        queryId: queryId || finalProposal.queryId || null,
        orchardBatchId: orchardBatchId || null,
        proposalId: finalProposal.proposalId,
        finalDecision: finalProposal.finalDecision,
        quorum: finalProposal.quorum || null,
        evidenceRef: finalProposal.evidenceRef || null,
        evidenceVersion: Number(evidenceVersion || finalProposal.evidenceVersion || 0),
        queryCommitment: queryCommitment.value,
        supportingAgents: normalizeAgentVector(finalProposal.supportingAgents || []),
        questioningAgents: normalizeAgentVector(finalProposal.questioningAgents || []),
        rejectingAgents: normalizeAgentVector(finalProposal.rejectingAgents || []),
        arbitration: finalProposal.arbitration
            ? {
                agentId: finalProposal.arbitration.agentId || null,
                finalDecision: finalProposal.arbitration.finalDecision || null
            }
            : null,
        responsePayloadHash: responsePayload ? sha256Hex(stableStringify(responsePayload)) : null
    };
    const serialized = stableStringify(inputs);

    return {
        version: 'negotiation-proof-v1',
        algorithm: 'sha256',
        proposalId: finalProposal.proposalId,
        queryId: inputs.queryId,
        finalDecision: finalProposal.finalDecision,
        digest: sha256Hex(serialized),
        inputs,
        serialized
    };
}

function verifyNegotiationProof(proof, expected = {}) {
    if (!proof || typeof proof !== 'object') {
        throw new Error('negotiation proof is required');
    }
    const recalculated = sha256Hex(stableStringify(proof.inputs || {}));
    const digestMatched = proof.digest === recalculated;
    const proposalMatched = !expected.proposalId || expected.proposalId === proof.proposalId;
    const decisionMatched = !expected.finalDecision || expected.finalDecision === proof.finalDecision;
    const commitmentMatched = !expected.queryCommitment || expected.queryCommitment === proof.inputs?.queryCommitment;
    const responsePayloadHashMatched = !expected.responsePayloadHash
        || expected.responsePayloadHash === proof.inputs?.responsePayloadHash;
    const queryIdMatched = !expected.queryId
        || expected.queryId === proof.queryId
        || expected.queryId === proof.inputs?.queryId;
    const orchardBatchIdMatched = !expected.orchardBatchId
        || expected.orchardBatchId === proof.inputs?.orchardBatchId;

    return {
        ok: digestMatched
            && proposalMatched
            && decisionMatched
            && commitmentMatched
            && responsePayloadHashMatched
            && queryIdMatched
            && orchardBatchIdMatched,
        checks: {
            digestMatched,
            proposalMatched,
            decisionMatched,
            commitmentMatched,
            responsePayloadHashMatched,
            queryIdMatched,
            orchardBatchIdMatched
        },
        verifiedAt: new Date().toISOString(),
        digest: proof.digest
    };
}

module.exports = {
    buildNegotiationProof,
    verifyNegotiationProof
};
