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

    canContinue(disagreements = [], submitterPlan = null, committeeIds = null) {
        if (!disagreements.length) {
            return false;
        }
        if (disagreements.some((item) => item.severity === 'HIGH')) {
            return false;
        }
        if (!submitterPlan?.planId && !submitterPlan?.recommendedRoute) {
            return false;
        }
        return disagreements.every((item) => {
            if (this.recoverableCodes.has(item.code)) {
                return true;
            }
            // An ECLIPSE_RISK raised only against agents outside the active
            // committee (already-excluded candidates) must not block continuation:
            // those agents cannot influence this round's consensus, so letting
            // their stale reputation hard-fail the negotiation is incorrect.
            if (item.code === 'ECLIPSE_RISK' && this.concernsOnlyNonCommittee(item, committeeIds)) {
                return true;
            }
            return false;
        });
    }

    concernsOnlyNonCommittee(disagreement, committeeIds) {
        if (!committeeIds || typeof committeeIds.has !== 'function') {
            return false;
        }
        const agents = Array.isArray(disagreement.agents) ? disagreement.agents : [];
        if (!agents.length) {
            return false;
        }
        return agents.every((agentId) => !committeeIds.has(agentId));
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

    // Phase 2 gate (论文 §IV-D): a single A-type agent's deterministic crypto
    // check must pass before the semantic consensus can begin. If the evidence
    // bundle carries a preVerification record that is not PASS, the task is
    // immediately REJECTED — no LLM calls, no consensus round needed.
    _runCryptographicGate(task) {
        const pre = task?.evidenceBundle?.preVerification;
        if (!pre) {
            return { blocked: false };
        }
        if (pre.status === 'PASS') {
            return { blocked: false };
        }
        return {
            blocked: true,
            status: pre.status || 'FAILED',
            reason: `cryptographic pre-validation ${pre.status || 'FAILED'}`,
            checks: pre.checks || {}
        };
    }

    async run({ task, opinions = [], coordination = null, submitterPlan = null, round = null, maxRounds = 1, behaviorAnalysis = null, committee = null, arbitration = null }) {
        // Phase 2 gate: hard-reject before any consensus if crypto check failed.
        const cryptoGate = this._runCryptographicGate(task);
        if (cryptoGate.blocked) {
            const queryId = task?.queryId || null;
            // Synthetic quorum: crypto failure is equivalent to unanimous rejection.
            // rejectRatio=1 / acceptRatio=0 satisfies existing test assertions and
            // accurately represents that the evidence did not pass the deterministic gate.
            const gateQuorum = {
                total: 0, required: 0, validRevealCount: 0, enoughReveals: false,
                approved: 0, rejected: 0, questioned: 0,
                totalWeight: 0, approvedWeight: 0, rejectedWeight: 0, questionedWeight: 0,
                approvedEffectiveWeight: 0, rejectedEffectiveWeight: 0, questionedEffectiveWeight: 0,
                thresholdWeight: 0, thresholdRatio: 0.7,
                acceptRatio: 0, rejectRatio: 1,
                questionRatio: 0, wbftSatisfied: false, rejectSatisfied: true,
                rejectionSource: 'CRYPTO_GATE'
            };
            const gateProposal = {
                proposalId: `proposal_${queryId || task?.taskId || Date.now()}_gate`,
                taskId: task?.taskId || null,
                queryId,
                finalDecision: 'REJECT',
                rejectionStage: 'CRYPTO_GATE',
                reason: cryptoGate.reason,
                checks: cryptoGate.checks,
                quorum: gateQuorum
            };
            this.emitEvent({
                type: 'negotiation',
                direction: 'FISCO_TO_FABRIC',
                relayState: 'REJECTED',
                correlationId: queryId,
                message: `Phase 2 crypto gate blocked: ${cryptoGate.reason}`,
                data: gateProposal
            });
            return {
                status: 'REJECTED',
                round: round || 0,
                disagreements: [{
                    code: 'CRYPTO_PRECHECK_FAILED',
                    agents: [],
                    message: cryptoGate.reason,
                    severity: 'HIGH'
                }],
                finalProposal: gateProposal,
                shouldContinue: false,
                continuation: null
            };
        }

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
        const committeeIds = Array.isArray(committee?.selected)
            ? new Set(committee.selected.map((member) => member.agentId).filter(Boolean))
            : null;
        const shouldContinue = finalProposal.finalDecision === 'OBSERVE'
            && effectiveRound < maxRounds
            && this.canContinue(disagreements, submitterPlan, committeeIds);
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
