function buildDisagreement(code, agents, message, severity = 'MEDIUM') {
    return {
        code,
        agents: Array.from(new Set(agents || [])),
        message,
        severity
    };
}

function analyzeDisagreements({ opinions = [], task, behaviorAnalysis = null }) {
    const disagreements = [];
    const evidence = task?.evidenceBundle || {};

    const rejected = opinions.filter((item) => item.decision === 'REJECT');
    const questioned = opinions.filter((item) => item.decision === 'QUESTION');

    const queryProofRejected = rejected.filter((item) => item.checks?.queryProofPresent && item.checks?.queryProofValid === false);
    if (queryProofRejected.length) {
        disagreements.push(buildDisagreement(
            'QUERY_PROOF_FAILED',
            queryProofRejected.map((item) => item.agentId),
            'At least one verifier rejected the query proof',
            'HIGH'
        ));
    }

    const headerQuestioned = questioned.filter((item) => item.checks?.sourceHeaderPresent === false);
    if (headerQuestioned.length) {
        disagreements.push(buildDisagreement(
            'HEADER_GAP',
            headerQuestioned.map((item) => item.agentId),
            'Some verifiers require additional header evidence before commit'
        ));
    }

    const queryObjectQuestioned = questioned.filter((item) => item.checks?.queryObjectPresent === false);
    if (queryObjectQuestioned.length) {
        disagreements.push(buildDisagreement(
            'QUERY_OBJECT_MISSING',
            queryObjectQuestioned.map((item) => item.agentId),
            'The normalized query object is missing from the evidence bundle'
        ));
    }

    const payloadQuestioned = questioned.filter((item) => item.checks?.payloadPresent === false);
    if (payloadQuestioned.length) {
        disagreements.push(buildDisagreement(
            'PAYLOAD_SCHEMA_INVALID',
            payloadQuestioned.map((item) => item.agentId),
            'Payload bundle is incomplete for negotiation'
        ));
    }

    const targetUnavailable = questioned.filter((item) => item.checks?.targetChainPresent === false);
    if (targetUnavailable.length) {
        disagreements.push(buildDisagreement(
            'TARGET_CHAIN_UNAVAILABLE',
            targetUnavailable.map((item) => item.agentId),
            'Target chain metadata is missing'
        ));
    }

    const submissionPlanPending = questioned.filter((item) => item.checks?.submissionPlanReady === false);
    if (submissionPlanPending.length) {
        disagreements.push(buildDisagreement(
            'SUBMISSION_PLAN_PENDING',
            submissionPlanPending.map((item) => item.agentId),
            'A submission route clarification is required before commit',
            'LOW'
        ));
    }

    const taskTimedOut = task?.status === 'TIMEOUT' || task?.timedOut === true;
    if (taskTimedOut && (!Array.isArray(evidence.relayReceipts) || evidence.relayReceipts.length === 0)) {
        disagreements.push(buildDisagreement(
            'TIMEOUT_BUT_LATE_SUCCESS_POSSIBLE',
            [],
            'Task timed out with no relay receipts; late evidence may still arrive',
            'LOW'
        ));
    }

    if (Array.isArray(behaviorAnalysis?.hiddenCollusionAgents) && behaviorAnalysis.hiddenCollusionAgents.length) {
        disagreements.push(buildDisagreement(
            'HIDDEN_COLLUSION_RISK',
            behaviorAnalysis.hiddenCollusionAgents,
            'Behavior analysis detected high vote similarity among verifier agents',
            'HIGH'
        ));
    }

    if (Array.isArray(behaviorAnalysis?.eclipseRiskAgents) && behaviorAnalysis.eclipseRiskAgents.length) {
        disagreements.push(buildDisagreement(
            'ECLIPSE_RISK',
            behaviorAnalysis.eclipseRiskAgents,
            'Behavior analysis detected persistent latency or withholding risk',
            'MEDIUM'
        ));
    }

    return disagreements;
}

module.exports = { analyzeDisagreements };
