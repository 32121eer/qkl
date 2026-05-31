const { buildNegotiationProof } = require('../../../demo/negotiation/negotiation_proof');
const {
    buildNegotiatedResponsePayload,
    buildNegotiatedResponseEnvelope,
    verifyNegotiatedResponseEnvelope
} = require('../../../demo/negotiation/response_envelope');

function createFinalProposal() {
    return {
        proposalId: 'proposal_query_1_1',
        queryId: 'query_1',
        finalDecision: 'COMMIT',
        quorum: {
            total: 3,
            required: 3,
            approved: 3,
            rejected: 0,
            questioned: 0,
            totalWeight: 1,
            approvedWeight: 0.91,
            rejectedWeight: 0,
            questionedWeight: 0.09,
            thresholdWeight: 0.666667
        },
        evidenceRef: {
            sourceHeaderHash: '0xheader',
            queryCommitment: '0xcommitment'
        },
        supportingAgents: [
            { agentId: 'verifier-1', weight: 0.42 },
            { agentId: 'verifier-2', weight: 0.31 },
            { agentId: 'verifier-3', weight: 0.18 }
        ],
        questioningAgents: [],
        rejectingAgents: []
    };
}

function createNegotiationArtifacts() {
    const responsePayload = buildNegotiatedResponsePayload({
        queryId: 'query_1',
        orchardBatchId: 'BATCH-APPLE-0001',
        found: true,
        result: {
            orchardBatchId: 'BATCH-APPLE-0001',
            eventType: 'harvest'
        }
    });
    const negotiationProof = buildNegotiationProof({
        queryId: 'query_1',
        orchardBatchId: 'BATCH-APPLE-0001',
        finalProposal: createFinalProposal(),
        queryCommitment: {
            value: '0xcommitment'
        },
        evidenceVersion: 2,
        responsePayload
    });

    return {
        responsePayload,
        negotiationProof,
        settlementResult: {
            settlementId: 'settlement_query_1',
            feePool: 12,
            slashPenalty: 5,
            finalDecision: 'COMMIT',
            allocations: [
                { agentId: 'verifier-1', bucket: 'support', weight: 0.42, reward: 5.54, slash: 0 }
            ]
        }
    };
}

describe('negotiated response envelope', () => {
    test('verifies a valid response envelope', () => {
        const artifacts = createNegotiationArtifacts();
        const envelope = buildNegotiatedResponseEnvelope({
            queryId: 'query_1',
            orchardBatchId: 'BATCH-APPLE-0001',
            found: true,
            result: {
                orchardBatchId: 'BATCH-APPLE-0001',
                eventType: 'harvest'
            },
            negotiationProof: artifacts.negotiationProof,
            settlementResult: artifacts.settlementResult
        });

        const result = verifyNegotiatedResponseEnvelope(envelope);
        expect(result.ok).toBe(true);
        expect(result.skipped).toBe(false);
        expect(result.checks.responsePayloadHashMatched).toBe(true);
        expect(result.checks.settlementDecisionMatched).toBe(true);
    });

    test('fails when the response payload is tampered after proof generation', () => {
        const artifacts = createNegotiationArtifacts();
        const envelope = buildNegotiatedResponseEnvelope({
            queryId: 'query_1',
            orchardBatchId: 'BATCH-APPLE-0001',
            found: true,
            result: {
                orchardBatchId: 'BATCH-APPLE-0001',
                eventType: 'tampered'
            },
            negotiationProof: artifacts.negotiationProof,
            settlementResult: artifacts.settlementResult
        });

        const result = verifyNegotiatedResponseEnvelope(envelope);
        expect(result.ok).toBe(false);
        expect(result.checks.responsePayloadHashMatched).toBe(false);
    });

    test('fails when settlement is missing for committed response', () => {
        const artifacts = createNegotiationArtifacts();
        const envelope = buildNegotiatedResponseEnvelope({
            queryId: 'query_1',
            orchardBatchId: 'BATCH-APPLE-0001',
            found: true,
            result: {
                orchardBatchId: 'BATCH-APPLE-0001',
                eventType: 'harvest'
            },
            negotiationProof: artifacts.negotiationProof,
            settlementResult: null
        });

        const result = verifyNegotiatedResponseEnvelope(envelope);
        expect(result.ok).toBe(false);
        expect(result.checks.settlementSatisfied).toBe(false);
    });
});
