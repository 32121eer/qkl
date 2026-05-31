const { MessageHandler } = require('../handlers/message_handler');
const { buildNegotiationProof } = require('../demo/negotiation/negotiation_proof');
const {
    buildNegotiatedResponsePayload,
    buildNegotiatedResponseEnvelope,
    verifyNegotiatedResponseEnvelope
} = require('../demo/negotiation/response_envelope');

function createHandler() {
    return new MessageHandler({
        chains: [],
        relayer: {},
        getChainConfig() {
            return null;
        }
    });
}

function createEnvelope() {
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
        finalProposal: {
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
        },
        queryCommitment: {
            value: '0xcommitment'
        },
        evidenceVersion: 1,
        responsePayload
    });

    return buildNegotiatedResponseEnvelope({
        queryId: 'query_1',
        orchardBatchId: 'BATCH-APPLE-0001',
        found: true,
        result: {
            orchardBatchId: 'BATCH-APPLE-0001',
            eventType: 'harvest'
        },
        negotiationProof,
        settlementResult: {
            settlementId: 'settlement_query_1',
            feePool: 12,
            slashPenalty: 5,
            finalDecision: 'COMMIT',
            allocations: []
        }
    });
}

describe('MessageHandler FISCO receiveLite args', () => {
    test('receiveLite args include payload hash and negotiation proof digest anchors', () => {
        const handler = createHandler();
        const payload = createEnvelope();
        const verifyResult = verifyNegotiatedResponseEnvelope(payload);
        const targetChain = {
            chainId: 'FISCO_NET_01',
            type: 'FISCO_BCOS',
            receiveMethod: 'receiveLite',
            contracts: {
                gateway: '0xgateway'
            }
        };
        const message = {
            sourceChainId: 'FABRIC_NET_01',
            sourceTxHash: '0xtx',
            sourceBlockNumber: 88,
            payload,
            blockHeader: {
                number: 88
            }
        };

        const built = handler.buildFiscoReceiveConsoleArgs(targetChain, message, verifyResult);

        expect(built.receiveMethod).toBe('receiveLite');
        expect(built.anchors.payloadHash).toBe(verifyResult.expectedResponsePayloadHash);
        expect(built.anchors.negotiationProofDigest).toBe(payload.negotiationProof.digest);
        expect(built.consoleArgs.slice(-2)).toEqual([
            verifyResult.expectedResponsePayloadHash,
            payload.negotiationProof.digest
        ]);
    });
});
