const { buildProtocolParams } = require('./protocol_config');

function round6(value) {
    return Number((Number(value) || 0).toFixed(6));
}

function confidenceWeight(opinion) {
    const weight = Number(opinion.assignedWeight) || 0;
    const confidence = Math.max(0, Math.min(1, Number(opinion.confidence) || 0));
    return weight * confidence;
}

function summarizeQuorum(opinions = [], { risk = 'NORMAL', protocolParams = null } = {}) {
    const params = protocolParams || buildProtocolParams(risk);
    const approve = opinions.filter((item) => item.decision === 'APPROVE').length;
    const reject = opinions.filter((item) => item.decision === 'REJECT').length;
    const question = opinions.filter((item) => item.decision === 'QUESTION').length;
    const total = opinions.length;
    const required = total > 0 ? Math.min(total, params.minimumRevealCount || (Math.ceil(total / 2) + 1)) : 0;
    const totalWeight = opinions.reduce((sum, item) => sum + (Number(item.assignedWeight) || 0), 0);
    const approvedWeight = opinions
        .filter((item) => item.decision === 'APPROVE')
        .reduce((sum, item) => sum + (Number(item.assignedWeight) || 0), 0);
    const rejectedWeight = opinions
        .filter((item) => item.decision === 'REJECT')
        .reduce((sum, item) => sum + (Number(item.assignedWeight) || 0), 0);
    const questionedWeight = opinions
        .filter((item) => item.decision === 'QUESTION')
        .reduce((sum, item) => sum + (Number(item.assignedWeight) || 0), 0);
    const approvedEffectiveWeight = opinions
        .filter((item) => item.decision === 'APPROVE')
        .reduce((sum, item) => sum + confidenceWeight(item), 0);
    const rejectedEffectiveWeight = opinions
        .filter((item) => item.decision === 'REJECT')
        .reduce((sum, item) => sum + confidenceWeight(item), 0);
    const questionedEffectiveWeight = opinions
        .filter((item) => item.decision === 'QUESTION')
        .reduce((sum, item) => sum + confidenceWeight(item), 0);
    const validRevealCount = approve + reject;
    const thresholdRatio = params.threshold;
    const thresholdWeight = totalWeight > 0 ? totalWeight * thresholdRatio : 0;
    const decisiveEffectiveWeight = approvedEffectiveWeight + rejectedEffectiveWeight;
    const acceptRatio = decisiveEffectiveWeight > 0 ? approvedEffectiveWeight / decisiveEffectiveWeight : 0;
    const rejectRatio = decisiveEffectiveWeight > 0 ? rejectedEffectiveWeight / decisiveEffectiveWeight : 0;
    const normalizedTotalWeight = round6(totalWeight);
    const normalizedApprovedWeight = round6(approvedWeight);
    const normalizedRejectedWeight = round6(rejectedWeight);
    const normalizedQuestionedWeight = round6(questionedWeight);
    const normalizedApprovedEffectiveWeight = round6(approvedEffectiveWeight);
    const normalizedRejectedEffectiveWeight = round6(rejectedEffectiveWeight);
    const normalizedQuestionedEffectiveWeight = round6(questionedEffectiveWeight);
    const normalizedThresholdWeight = round6(thresholdWeight);
    const enoughReveals = validRevealCount >= required;
    const wbftSatisfied = enoughReveals && decisiveEffectiveWeight > 0 && acceptRatio >= thresholdRatio;
    const rejectSatisfied = enoughReveals && decisiveEffectiveWeight > 0 && rejectRatio >= thresholdRatio;

    return {
        total,
        required,
        validRevealCount,
        enoughReveals,
        approved: approve,
        rejected: reject,
        questioned: question,
        totalWeight: normalizedTotalWeight,
        approvedWeight: normalizedApprovedWeight,
        rejectedWeight: normalizedRejectedWeight,
        questionedWeight: normalizedQuestionedWeight,
        approvedEffectiveWeight: normalizedApprovedEffectiveWeight,
        rejectedEffectiveWeight: normalizedRejectedEffectiveWeight,
        questionedEffectiveWeight: normalizedQuestionedEffectiveWeight,
        thresholdWeight: normalizedThresholdWeight,
        thresholdRatio: round6(thresholdRatio),
        acceptRatio: round6(acceptRatio),
        rejectRatio: round6(rejectRatio),
        wbftSatisfied,
        rejectSatisfied
    };
}

function determineFinalDecision({ quorum, disagreements = [] }) {
    if (quorum.rejectSatisfied) {
        return 'REJECT';
    }
    const quorumReached = quorum.totalWeight > 0
        ? quorum.wbftSatisfied
        : quorum.approved >= quorum.required;
    if (quorumReached && disagreements.filter((item) => item.severity === 'HIGH').length === 0) {
        return 'COMMIT';
    }
    return 'OBSERVE';
}

function buildFinalProposal({
    task,
    opinions = [],
    disagreements = [],
    coordination = null,
    submitterPlan = null,
    round = null
}) {
    const protocolParams = buildProtocolParams(task?.risk);
    const quorum = summarizeQuorum(opinions, { risk: task?.risk, protocolParams });
    const finalDecision = determineFinalDecision({ quorum, disagreements });
    const effectiveRound = round || coordination?.round || 1;
    const proposalId = `proposal_${task?.queryId || task?.taskId || Date.now()}_${task?.evidenceVersion || 0}_r${effectiveRound}`;
    const evidence = task?.evidenceBundle || {};

    return {
        proposalId,
        taskId: task?.taskId || null,
        queryId: task?.queryId || null,
        finalDecision,
        protocolVersion: protocolParams.protocolVersion,
        risk: protocolParams.risk,
        rounds: effectiveRound,
        quorum,
        consensusRule: {
            groupSize: protocolParams.groupSize,
            threshold: protocolParams.threshold,
            minimumRevealCount: protocolParams.minimumRevealCount,
            weightFormula: 'w_i = rep_i * confidence_i',
            decisionRule: 'CONFIRMED if acceptRatio >= theta; REJECTED if rejectRatio >= theta; otherwise ARBITRATING/OBSERVE'
        },
        evidenceVersion: task?.evidenceVersion || 0,
        evidenceRef: {
            sourceHeaderHash: evidence.sourceHeaderHash || null,
            payloadHash: evidence.payloadHash || null,
            queryCommitment: evidence.queryProof?.commitment?.value || evidence.proofBundle?.commitment?.value || null,
            sourceTxHash: evidence.sourceTxHash || evidence.request?.txHash || null
        },
        evidenceAudit: {
            artifactCount: Array.isArray(evidence.artifacts) ? evidence.artifacts.length : 0,
            appliedRequestCount: Array.isArray(evidence.appliedRequests) ? evidence.appliedRequests.length : 0,
            pendingRequestCount: Array.isArray(evidence.pendingRequests) ? evidence.pendingRequests.length : 0
        },
        supportingAgents: opinions
            .filter((item) => item.decision === 'APPROVE')
            .map((item) => ({
                agentId: item.agentId,
                weight: Number(item.assignedWeight || 0),
                confidence: Number(item.confidence || 0),
                effectiveWeight: round6(confidenceWeight(item))
            })),
        questioningAgents: opinions
            .filter((item) => item.decision === 'QUESTION')
            .map((item) => ({
                agentId: item.agentId,
                weight: Number(item.assignedWeight || 0),
                confidence: Number(item.confidence || 0),
                effectiveWeight: round6(confidenceWeight(item))
            })),
        rejectingAgents: opinions
            .filter((item) => item.decision === 'REJECT')
            .map((item) => ({
                agentId: item.agentId,
                weight: Number(item.assignedWeight || 0),
                confidence: Number(item.confidence || 0),
                effectiveWeight: round6(confidenceWeight(item))
            })),
        weightVector: opinions.map((item) => ({
            agentId: item.agentId,
            weight: Number(item.assignedWeight || 0),
            confidence: Number(item.confidence || 0),
            effectiveWeight: round6((Number(item.assignedWeight || 0) * Number(item.confidence || 0))),
            latencyMs: Number(item.latencyMs || 0),
            qualityWeight: Number(item.wbft?.qualityWeight || 0),
            trustWeight: Number(item.wbft?.trustWeight || 0),
            qualityScore: Number(item.wbft?.qualityScore || 0),
            trustScore: Number(item.wbft?.trustScore || 0),
            latencyScore: Number(item.wbft?.latencyScore || 0),
            riskPenalty: Number(item.wbft?.riskPenalty || 0),
            formulaVersion: item.wbft?.formulaVersion || 'ma3c-wbft-v1',
            judgment: item.judgment || null,
            commitHash: item.commitReveal?.commitHash || null,
            reasonHash: item.reasonHash || item.commitReveal?.reveal?.reasonHash || null,
            commitRevealValid: item.commitReveal?.valid ?? null
        })),
        wbftModel: {
            formulaVersion: protocolParams.protocolVersion,
            selectionFormula: 'VRF(task_id, evidence_version) with reputation-proportional weighted sampling',
            reputationFormula: 'rep_i = alpha * A_i + beta * B_i',
            weightFormula: 'voteWeight_i = rep_i * confidence_i',
            qualityFormula: 'A_i = Q_i / sum_j Q_j',
            trustFormula: 'B_i = T_i / sum_j T_j',
            threshold: `acceptRatio >= ${protocolParams.threshold}`
        },
        disagreements,
        coordinatorSummary: coordination,
        submitterPlan
    };
}

module.exports = {
    buildFinalProposal,
    summarizeQuorum
};
