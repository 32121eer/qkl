const { BaseAgent } = require('./base_agent');

class CoordinatorAgent extends BaseAgent {
    constructor({ agentId, organization = null }) {
        super({
            agentId,
            role: 'COORDINATOR',
            capabilities: ['opinion_aggregation', 'round_management'],
            organization,
            strategyType: 'COORDINATOR'
        });
    }

    identifyDisagreements(opinions = []) {
        const disagreements = [];

        if (opinions.some((item) => item.decision === 'REJECT')) {
            disagreements.push('PROOF_OR_EVIDENCE_REJECTED');
        }
        if (opinions.some((item) => item.decision === 'QUESTION')) {
            disagreements.push('MORE_EVIDENCE_REQUIRED');
        }

        return disagreements;
    }

    summarize(opinions = []) {
        const summary = {
            approve: 0,
            reject: 0,
            question: 0
        };

        for (const opinion of opinions) {
            if (opinion.decision === 'APPROVE') summary.approve += 1;
            else if (opinion.decision === 'REJECT') summary.reject += 1;
            else summary.question += 1;
        }

        return summary;
    }

    async execute(task, context = {}) {
        const opinions = Array.isArray(context.opinions) ? context.opinions : [];
        const round = Number(context.round || context.currentRound || 1);
        const summary = this.summarize(opinions);
        const disagreements = this.identifyDisagreements(opinions);

        let status = 'COLLECTING';
        if (summary.reject > 0) {
            status = 'DISAGREEMENT';
        } else if (summary.question > 0) {
            status = 'REVIEW';
        } else if (summary.approve > 0) {
            status = 'READY';
        }

        return this.createEnvelope(task, {
            round,
            status,
            summary,
            disagreements,
            reasons: disagreements.length
                ? disagreements
                : [round === 1 ? 'initial round collected' : `round ${round} collected`]
        });
    }
}

module.exports = { CoordinatorAgent };
