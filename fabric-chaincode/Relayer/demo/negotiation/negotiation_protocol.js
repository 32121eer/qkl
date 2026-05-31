const { analyzeDisagreements } = require('./disagreement_analyzer');
const { buildFinalProposal } = require('./proposal_builder');

class NegotiationProtocol {
    constructor({ eventStore } = {}) {
        this.eventStore = eventStore;
        this.recoverableCodes = new Set([
            'HEADER_GAP',
            'QUERY_OBJECT_MISSING',
            'PAYLOAD_SCHEMA_INVALID',
            'SUBMISSION_PLAN_PENDING',
            'TIMEOUT_BUT_LATE_SUCCESS_POSSIBLE'
        ]);
    }

    emitEvent(event) {
        if (!this.eventStore || typeof this.eventStore.addEvent !== 'function') {
            return;
        }
        this.eventStore.addEvent(event);
    }

    canContinue(disagreements = [], submitterPlan = null) {
        if (!disagreements.length) {
            return false;
        }
        if (disagreements.some((item) => item.severity === 'HIGH')) {
            return false;
        }
        if (!submitterPlan?.planId && !submitterPlan?.recommendedRoute) {
            return false;
        }
        return disagreements.every((item) => this.recoverableCodes.has(item.code));
    }

    buildEvidenceRequests(disagreements = []) {
        const requests = [];
        for (const item of disagreements) {
            if (item.code === 'HEADER_GAP') {
                requests.push({
                    type: 'SOURCE_HEADER',
                    reason: item.code,
                    priority: 'HIGH'
                });
            } else if (item.code === 'QUERY_OBJECT_MISSING') {
                requests.push({
                    type: 'QUERY_OBJECT',
                    reason: item.code,
                    priority: 'MEDIUM'
                });
            } else if (item.code === 'TIMEOUT_BUT_LATE_SUCCESS_POSSIBLE') {
                requests.push({
                    type: 'REQUEST_RECEIPT',
                    reason: item.code,
                    priority: 'LOW'
                });
            }
        }
        return requests;
    }

    buildContinuation({ round, disagreements = [], submitterPlan = null, coordination = null, behaviorAnalysis = null }) {
        const requestedEvidence = this.buildEvidenceRequests(disagreements);
        return {
            nextRound: round + 1,
            trigger: 'COORDINATOR_ESCALATION',
            disagreementCodes: disagreements.map((item) => item.code),
            requestedEvidence,
            hiddenCollusionAgents: behaviorAnalysis?.hiddenCollusionAgents || [],
            eclipseRiskAgents: behaviorAnalysis?.eclipseRiskAgents || [],
            submitterPlan: submitterPlan
                ? {
                    planId: submitterPlan.planId || null,
                    recommendedRoute: submitterPlan.recommendedRoute || null,
                    clarification: submitterPlan.clarification || null
                }
                : null,
            coordinatorStatus: coordination?.status || null
        };
    }

    async run({ task, opinions = [], coordination = null, submitterPlan = null, round = null, maxRounds = 1, behaviorAnalysis = null, committee = null, arbitration = null }) {
        const disagreements = analyzeDisagreements({ opinions, task, behaviorAnalysis });
        const finalProposal = buildFinalProposal({
            task,
            opinions,
            disagreements,
            coordination,
            submitterPlan,
            round
        });
        const effectiveRound = round || coordination?.round || 1;
        const shouldContinue = finalProposal.finalDecision === 'OBSERVE'
            && effectiveRound < maxRounds
            && this.canContinue(disagreements, submitterPlan);
        const continuation = shouldContinue
            ? this.buildContinuation({
                round: effectiveRound,
                disagreements,
                submitterPlan,
                coordination,
                behaviorAnalysis
            })
            : null;

        const arbitrationDecision = !shouldContinue
            && finalProposal.finalDecision === 'OBSERVE'
            && arbitration?.finalDecision
            && arbitration.finalDecision !== 'OBSERVE'
            ? arbitration.finalDecision
            : null;
        if (arbitrationDecision) {
            finalProposal.finalDecision = arbitrationDecision;
            finalProposal.arbitration = arbitration;
        }
        if (committee) {
            finalProposal.committee = committee;
        }
        if (behaviorAnalysis) {
            finalProposal.behaviorAnalysis = behaviorAnalysis;
        }

        const status = shouldContinue
            ? 'REVIEW'
            : finalProposal.finalDecision === 'COMMIT'
            ? 'READY'
            : finalProposal.finalDecision === 'REJECT'
                ? 'REJECTED'
                : 'REVIEW';

        this.emitEvent({
            type: 'negotiation',
            direction: 'FISCO_TO_FABRIC',
            relayState: status,
            correlationId: task?.queryId || null,
            message: shouldContinue
                ? `Round ${effectiveRound} requires another negotiation round`
                : `Final proposal ${finalProposal.proposalId} produced with decision ${finalProposal.finalDecision}`,
            data: shouldContinue
                ? {
                    finalProposal,
                    continuation,
                    requestedEvidence: continuation?.requestedEvidence || []
                }
                : finalProposal
        });

        return {
            status,
            round: effectiveRound,
            disagreements,
            finalProposal,
            shouldContinue,
            continuation
        };
    }
}

module.exports = { NegotiationProtocol };
