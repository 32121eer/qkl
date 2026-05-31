const { BaseAgent } = require('./base_agent');

const { sha256Hex, stableStringify } = require('../negotiation/commit_reveal');

class EvidenceAgent extends BaseAgent {
    constructor({ agentId, organization = null }) {
        super({
            agentId,
            role: 'EVIDENCE',
            capabilities: ['evidence_collection', 'evidence_recovery'],
            organization,
            strategyType: 'COLLECTOR'
        });
    }

    getProofSource(task, session = {}) {
        return (
            task?.evidenceBundle?.proofBundle ||
            task?.evidenceBundle?.queryProof ||
            session?.proofBundle ||
            session?.queryProof ||
            null
        );
    }

    collectSourceHeader(task, session) {
        const proof = this.getProofSource(task, session);
        if (!proof?.sourceHeader) {
            return null;
        }

        return {
            requestType: 'SOURCE_HEADER',
            fulfilled: true,
            artifact: {
                artifactType: 'SOURCE_HEADER',
                recoveredFrom: proof === task?.evidenceBundle?.proofBundle || proof === task?.evidenceBundle?.queryProof
                    ? 'task-proof-bundle'
                    : 'session-proof-bundle',
                collectedAt: new Date().toISOString()
            },
            patch: {
                sourceBlockNumber: proof.sourceHeight ?? null,
                sourceHeader: proof.sourceHeader,
                sourceHeaderHash: proof.sourceHeaderHash || null
            }
        };
    }

    collectQueryObject(task, session) {
        const proof = this.getProofSource(task, session);
        const queryObject = task?.evidenceBundle?.queryObject || proof?.queryObject || session?.queryObject || null;
        if (!queryObject) {
            return null;
        }

        return {
            requestType: 'QUERY_OBJECT',
            fulfilled: true,
            artifact: {
                artifactType: 'QUERY_OBJECT',
                recoveredFrom: task?.evidenceBundle?.queryObject ? 'task-evidence' : 'proof-bundle',
                collectedAt: new Date().toISOString()
            },
            patch: {
                queryObject
            }
        };
    }

    collectRequestReceipt(task) {
        const receipt = Array.isArray(task?.evidenceBundle?.relayReceipts)
            ? task.evidenceBundle.relayReceipts.find((item) => item.direction === 'FISCO_TO_FABRIC')
            : null;
        if (!receipt) {
            return null;
        }

        return {
            requestType: 'REQUEST_RECEIPT',
            fulfilled: true,
            artifact: {
                artifactType: 'REQUEST_RECEIPT',
                recoveredFrom: 'relay-receipts',
                collectedAt: new Date().toISOString()
            },
            patch: {}
        };
    }

    collectEvidencePackage(task, session) {
        const proof = this.getProofSource(task, session);
        const payload = task?.evidenceBundle?.payload || session?.resultPayload || null;
        if (!proof && !payload) {
            return null;
        }

        const stateData = {
            payload,
            queryObject: task?.evidenceBundle?.queryObject || proof?.queryObject || session?.queryObject || null,
            commitment: proof?.commitment?.value || session?.queryCommitment?.value || null
        };
        const evidenceHash = sha256Hex(stableStringify({
            sourceHeight: proof?.sourceHeight ?? task?.evidenceBundle?.sourceBlockNumber ?? null,
            sourceHeaderHash: proof?.sourceHeaderHash || task?.evidenceBundle?.sourceHeaderHash || null,
            stateData
        }));

        return {
            requestType: 'EVIDENCE_PACKAGE',
            fulfilled: true,
            artifact: {
                artifactType: 'EVIDENCE_PACKAGE',
                evidenceHash,
                sourceHeaderHash: proof?.sourceHeaderHash || null,
                stateDataHash: sha256Hex(stableStringify(stateData)),
                collectedBy: this.agentId,
                organization: this.organization,
                collectedAt: new Date().toISOString()
            },
            patch: {
                collectorAttestations: [{
                    agentId: this.agentId,
                    organization: this.organization,
                    evidenceHash,
                    sourceHeaderHash: proof?.sourceHeaderHash || null,
                    sourceHeight: proof?.sourceHeight ?? null,
                    stateDataHash: sha256Hex(stableStringify(stateData)),
                    collectedAt: new Date().toISOString()
                }]
            }
        };
    }

    resolveRequest(request, task, session) {
        const type = String(request?.type || '').toUpperCase();
        if (type === 'EVIDENCE_PACKAGE') {
            return this.collectEvidencePackage(task, session);
        }
        if (type === 'SOURCE_HEADER') {
            return this.collectSourceHeader(task, session);
        }
        if (type === 'QUERY_OBJECT') {
            return this.collectQueryObject(task, session);
        }
        if (type === 'REQUEST_RECEIPT') {
            return this.collectRequestReceipt(task, session);
        }
        return null;
    }

    async execute(task, context = {}) {
        const requestedEvidence = Array.isArray(context.evidenceRequests) ? context.evidenceRequests : [];
        const session = context.session || {};
        const evidencePatch = {
            artifacts: [],
            appliedRequests: [],
            pendingRequests: []
        };
        const fulfilledRequests = [];
        const missingRequests = [];

        for (const request of requestedEvidence) {
            const resolution = this.resolveRequest(request, task, session);
            if (resolution?.fulfilled) {
                evidencePatch.artifacts.push(resolution.artifact);
                evidencePatch.appliedRequests.push({
                    ...request,
                    fulfilledBy: this.agentId,
                    fulfilledAt: new Date().toISOString()
                });
                Object.assign(evidencePatch, resolution.patch || {});
                fulfilledRequests.push(request.type);
            } else {
                evidencePatch.pendingRequests.push(request);
                missingRequests.push(request.type);
            }
        }

        return this.createEnvelope(task, {
            round: Number(context.round || context.currentRound || 1),
            status: missingRequests.length ? 'PARTIAL' : 'FULFILLED',
            requestedEvidence,
            fulfilledRequests,
            missingRequests,
            evidencePatch,
            reasons: fulfilledRequests.length
                ? [`fulfilled: ${fulfilledRequests.join(', ')}`]
                : ['no requested evidence could be recovered']
        });
    }
}

module.exports = { EvidenceAgent };
