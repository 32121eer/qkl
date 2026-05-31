const { stableStringify, sha256Hex } = require('../query/query_commitment');
const { verifyNegotiationProof } = require('./negotiation_proof');

function buildNegotiatedResponsePayload({
    payloadVersion = '1.0',
    queryId,
    orchardBatchId,
    found,
    result
} = {}) {
    return {
        payloadVersion,
        messageType: 'ORCHARD_QUERY_RESPONSE',
        queryId: queryId || null,
        orchardBatchId: orchardBatchId || null,
        found: Boolean(found),
        result: found ? (result ?? null) : null
    };
}

function buildNegotiatedResponseEnvelope({
    payloadVersion = '1.0',
    queryId,
    orchardBatchId,
    found,
    result,
    responseTs,
    negotiationProof = null,
    settlementResult = null
} = {}) {
    return {
        ...buildNegotiatedResponsePayload({
            payloadVersion,
            queryId,
            orchardBatchId,
            found,
            result
        }),
        responseTs: responseTs || new Date().toISOString(),
        negotiationProof,
        settlementResult
    };
}

function normalizePayloadObject(payload) {
    if (!payload) {
        return null;
    }
    if (Buffer.isBuffer(payload)) {
        return normalizePayloadObject(payload.toString('utf8'));
    }
    if (typeof payload === 'string') {
        try {
            return JSON.parse(payload);
        } catch (_error) {
            return null;
        }
    }
    return typeof payload === 'object' ? payload : null;
}

function verifyNegotiatedResponseEnvelope(payload, { requireSettlement = true } = {}) {
    const envelope = normalizePayloadObject(payload);
    if (!envelope || envelope.messageType !== 'ORCHARD_QUERY_RESPONSE') {
        return {
            ok: true,
            skipped: true,
            envelope: null,
            checks: {
                messageTypeMatched: false
            }
        };
    }

    const canonicalPayload = buildNegotiatedResponsePayload(envelope);
    const expectedResponsePayloadHash = sha256Hex(stableStringify(canonicalPayload));
    const negotiationProof = envelope.negotiationProof || null;
    const settlementResult = envelope.settlementResult || null;

    if (!negotiationProof) {
        return {
            ok: false,
            skipped: false,
            envelope,
            expectedResponsePayloadHash,
            checks: {
                messageTypeMatched: true,
                negotiationProofPresent: false,
                settlementPresent: Boolean(settlementResult),
                settlementDecisionMatched: settlementResult
                    ? String(settlementResult.finalDecision || '').toUpperCase() === 'COMMIT'
                    : !requireSettlement
            }
        };
    }

    const proofVerifyResult = verifyNegotiationProof(negotiationProof, {
        queryId: envelope.queryId || null,
        orchardBatchId: envelope.orchardBatchId || null,
        finalDecision: 'COMMIT',
        responsePayloadHash: expectedResponsePayloadHash
    });
    const settlementPresent = Boolean(settlementResult);
    const settlementDecisionMatched = !settlementResult || (
        String(settlementResult.finalDecision || '').toUpperCase() ===
        String(negotiationProof.finalDecision || '').toUpperCase()
    );
    const settlementSatisfied = requireSettlement ? settlementPresent : true;

    return {
        ok: proofVerifyResult.ok && settlementDecisionMatched && settlementSatisfied,
        skipped: false,
        envelope,
        expectedResponsePayloadHash,
        canonicalPayload,
        checks: {
            messageTypeMatched: true,
            negotiationProofPresent: true,
            settlementPresent,
            settlementDecisionMatched,
            settlementSatisfied,
            ...proofVerifyResult.checks
        }
    };
}

module.exports = {
    buildNegotiatedResponsePayload,
    buildNegotiatedResponseEnvelope,
    normalizePayloadObject,
    verifyNegotiatedResponseEnvelope
};
