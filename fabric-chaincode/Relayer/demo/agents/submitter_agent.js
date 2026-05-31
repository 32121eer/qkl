const { BaseAgent } = require('./base_agent');

class SubmitterAgent extends BaseAgent {
    constructor({ agentId, organization = null }) {
        super({
            agentId,
            role: 'SUBMITTER',
            capabilities: ['submission_planning'],
            organization,
            strategyType: 'SUBMITTER'
        });
    }

    async execute(task, context = {}) {
        const coordination = context.coordination || {};
        const opinions = Array.isArray(context.opinions) ? context.opinions : [];
        const round = Number(context.round || context.currentRound || 1);
        const ready = coordination.status === 'READY';
        const hasReject = opinions.some((item) => item.decision === 'REJECT');
        const hasQuestion = opinions.some((item) => item.decision === 'QUESTION');
        const planId = `submitter_plan_${task?.queryId || task?.taskId || Date.now()}_r${round}`;

        return this.createEnvelope(task, {
            round,
            status: ready ? 'STANDBY' : (hasReject ? 'BLOCKED' : 'PLANNED'),
            readyForSubmission: ready,
            planId,
            recommendedRoute: 'FABRIC_TO_FISCO',
            clarification: hasQuestion && !hasReject
                ? 'response relay plan prepared for next negotiation round'
                : null,
            reasons: ready
                ? ['submission can proceed after proposal finalization']
                : hasReject
                    ? ['submission blocked by rejecting verifier']
                    : ['submission plan prepared while waiting for final consensus']
        });
    }
}

module.exports = { SubmitterAgent };
