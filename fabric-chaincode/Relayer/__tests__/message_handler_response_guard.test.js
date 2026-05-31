const { MessageHandler } = require('../handlers/message_handler');
const { buildNegotiationProof } = require('../demo/negotiation/negotiation_proof');
const {
    buildNegotiatedResponsePayload,
    buildNegotiatedResponseEnvelope
} = require('../demo/negotiation/response_envelope');

function createHandler() {
    return new MessageHandler({
        chains: [],
        relayer: {},
        getChainConfig(chainId) {
            if (chainId === 'FISCO_NET_01') {
                return {
                    chainId,
                    type: 'FISCO_BCOS',
                    receiveMethod: 'receiveLite',
                    contracts: {
                        gateway: '0xgateway'
                    }
                };
            }
            return null;
        }
    });
}

function createEnvelope({ eventType = 'harvest', settlement = true } = {}) {
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
            eventType
        },
        negotiationProof,
        settlementResult: settlement
            ? {
                settlementId: 'settlement_query_1',
                feePool: 12,
                slashPenalty: 5,
                finalDecision: 'COMMIT',
                allocations: []
            }
            : null
    });
}

describe('MessageHandler response guard', () => {
    test('blocks relay when negotiation proof does not match payload', async () => {
        const handler = createHandler();
        handler.verifySourceBlock = jest.fn(async () => true);
        handler.relayToFiscoBcos = jest.fn(async () => ({ success: true, receiptStatus: 'SUCCESS' }));

        await expect(handler.relayMessage({
            sourceChainId: 'FABRIC_NET_01',
            targetChainId: 'FISCO_NET_01',
            sourceTxHash: '0xtx',
            sourceBlockNumber: 12,
            payload: createEnvelope({ eventType: 'tampered' })
        })).rejects.toMatchObject({
            code: 'ERR_APPLICATION_PROOF_INVALID'
        });

        expect(handler.relayToFiscoBcos).not.toHaveBeenCalled();
    });

    test('allows relay when committed response envelope verifies', async () => {
        const handler = createHandler();
        handler.verifySourceBlock = jest.fn(async () => true);
        handler.relayToFiscoBcos = jest.fn(async () => ({
            success: true,
            receiptStatus: 'SUCCESS',
            targetTxHash: '0xtarget'
        }));

        const result = await handler.relayMessage({
            sourceChainId: 'FABRIC_NET_01',
            targetChainId: 'FISCO_NET_01',
            sourceTxHash: '0xtx',
            sourceBlockNumber: 12,
            payload: createEnvelope()
        });

        expect(result.success).toBe(true);
        expect(result.applicationVerifyResult.ok).toBe(true);
        expect(handler.relayToFiscoBcos).toHaveBeenCalledTimes(1);
    });
});
