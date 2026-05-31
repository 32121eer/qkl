function createEvidenceBundle(overrides = {}) {
    return {
        sourceChain: null,
        targetChain: null,
        sourceBlockNumber: null,
        sourceHeader: null,
        sourceHeaderHash: null,
        sourceTxHash: null,
        payload: null,
        payloadHash: null,
        queryObject: null,
        queryProof: null,
        proofBundle: null,
        relayReceipts: [],
        collectorAttestations: [],
        artifacts: [],
        pendingRequests: [],
        appliedRequests: [],
        request: null,
        response: null,
        ...overrides
    };
}

function createNegotiationState(overrides = {}) {
    return {
        status: 'PENDING',
        round: 0,
        proposalId: null,
        continuation: null,
        latestDisagreements: [],
        requestedEvidence: [],
        selectedCommittee: [],
        excludedAgents: [],
        behaviorSummary: null,
        arbitration: null,
        finalProposal: null,
        negotiationProof: null,
        settlementResult: null,
        agentOpinions: [],
        history: [],
        ...overrides
    };
}

function createCrossChainTask({
    taskId,
    queryId,
    orchardBatchId,
    sourceChain,
    targetChain,
    risk = 'NORMAL',
    taskType = 'QUERY_RESPONSE_RELAY'
}) {
    return {
        taskId,
        queryId,
        orchardBatchId,
        taskType,
        status: 'PENDING',
        risk,
        sourceChain: sourceChain || null,
        targetChain: targetChain || null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        evidenceVersion: 0,
        evidenceBundle: createEvidenceBundle({
            sourceChain: sourceChain || null,
            targetChain: targetChain || null
        }),
        negotiation: createNegotiationState()
    };
}

function mergeEvidenceBundle(current = {}, patch = {}) {
    const nextReceipts = [];
    if (Array.isArray(current.relayReceipts)) {
        nextReceipts.push(...current.relayReceipts);
    }
    if (Array.isArray(patch.relayReceipts)) {
        nextReceipts.push(...patch.relayReceipts);
    }

    const nextArtifacts = [];
    if (Array.isArray(current.artifacts)) {
        nextArtifacts.push(...current.artifacts);
    }
    if (Array.isArray(patch.artifacts)) {
        nextArtifacts.push(...patch.artifacts);
    }

    const nextCollectorAttestations = [];
    if (Array.isArray(current.collectorAttestations)) {
        nextCollectorAttestations.push(...current.collectorAttestations);
    }
    if (Array.isArray(patch.collectorAttestations)) {
        nextCollectorAttestations.push(...patch.collectorAttestations);
    }

    const nextPendingRequests = Array.isArray(patch.pendingRequests)
        ? patch.pendingRequests.slice()
        : Array.isArray(current.pendingRequests)
            ? current.pendingRequests.slice()
            : [];

    const nextAppliedRequests = [];
    if (Array.isArray(current.appliedRequests)) {
        nextAppliedRequests.push(...current.appliedRequests);
    }
    if (Array.isArray(patch.appliedRequests)) {
        nextAppliedRequests.push(...patch.appliedRequests);
    }

    return createEvidenceBundle({
        ...current,
        ...patch,
        relayReceipts: nextReceipts,
        collectorAttestations: nextCollectorAttestations,
        artifacts: nextArtifacts,
        pendingRequests: nextPendingRequests,
        appliedRequests: nextAppliedRequests
    });
}

function mergeNegotiationState(current = {}, patch = {}) {
    const nextOpinions = [];
    if (Array.isArray(current.agentOpinions)) {
        nextOpinions.push(...current.agentOpinions);
    }
    if (Array.isArray(patch.agentOpinions)) {
        nextOpinions.push(...patch.agentOpinions);
    }

    const nextHistory = [];
    if (Array.isArray(current.history)) {
        nextHistory.push(...current.history);
    }
    if (Array.isArray(patch.history)) {
        nextHistory.push(...patch.history);
    }

    return createNegotiationState({
        ...current,
        ...patch,
        continuation: patch.continuation === undefined ? current.continuation || null : patch.continuation,
        latestDisagreements: Array.isArray(patch.latestDisagreements)
            ? patch.latestDisagreements.slice()
            : Array.isArray(current.latestDisagreements)
                ? current.latestDisagreements.slice()
                : [],
        requestedEvidence: Array.isArray(patch.requestedEvidence)
            ? patch.requestedEvidence.slice()
            : Array.isArray(current.requestedEvidence)
                ? current.requestedEvidence.slice()
                : [],
        selectedCommittee: Array.isArray(patch.selectedCommittee)
            ? patch.selectedCommittee.slice()
            : Array.isArray(current.selectedCommittee)
                ? current.selectedCommittee.slice()
                : [],
        excludedAgents: Array.isArray(patch.excludedAgents)
            ? patch.excludedAgents.slice()
            : Array.isArray(current.excludedAgents)
                ? current.excludedAgents.slice()
                : [],
        behaviorSummary: patch.behaviorSummary === undefined ? current.behaviorSummary || null : patch.behaviorSummary,
        arbitration: patch.arbitration === undefined ? current.arbitration || null : patch.arbitration,
        negotiationProof: patch.negotiationProof === undefined ? current.negotiationProof || null : patch.negotiationProof,
        settlementResult: patch.settlementResult === undefined ? current.settlementResult || null : patch.settlementResult,
        agentOpinions: nextOpinions,
        history: nextHistory
    });
}

function mergeCrossChainTask(current, patch = {}) {
    const base = current
        ? { ...current }
        : createCrossChainTask({
            taskId: patch.taskId,
            queryId: patch.queryId,
            orchardBatchId: patch.orchardBatchId,
            sourceChain: patch.sourceChain,
            targetChain: patch.targetChain,
            taskType: patch.taskType
        });

    const next = {
        ...base,
        ...patch,
        updatedAt: new Date().toISOString()
    };

    next.evidenceBundle = mergeEvidenceBundle(base.evidenceBundle, patch.evidenceBundle);
    next.negotiation = mergeNegotiationState(base.negotiation, patch.negotiation);

    const touchedEvidence = patch.evidenceBundle && Object.keys(patch.evidenceBundle).length > 0;
    next.evidenceVersion = touchedEvidence
        ? (Number(base.evidenceVersion) || 0) + 1
        : (Number(base.evidenceVersion) || 0);

    return next;
}

function buildSessionTaskPatch(task) {
    const negotiation = task?.negotiation || {};
    return {
        crossChainTask: task || null,
        negotiationStatus: negotiation.status || 'PENDING',
        negotiationRound: negotiation.round || 0,
        negotiationProposalId: negotiation.proposalId || null,
        negotiationContinuation: negotiation.continuation || null,
        negotiationDisagreements: Array.isArray(negotiation.latestDisagreements)
            ? negotiation.latestDisagreements
            : [],
        selectedCommittee: Array.isArray(negotiation.selectedCommittee) ? negotiation.selectedCommittee : [],
        excludedAgents: Array.isArray(negotiation.excludedAgents) ? negotiation.excludedAgents : [],
        behaviorSummary: negotiation.behaviorSummary || null,
        arbitrationDecision: negotiation.arbitration || null,
        negotiationProof: negotiation.negotiationProof || null,
        settlementResult: negotiation.settlementResult || null,
        agentOpinions: Array.isArray(negotiation.agentOpinions) ? negotiation.agentOpinions : [],
        finalProposal: negotiation.finalProposal || null,
        evidenceVersion: task?.evidenceVersion || 0
    };
}

module.exports = {
    buildSessionTaskPatch,
    createCrossChainTask,
    createEvidenceBundle,
    mergeCrossChainTask
};
