const { BaseAgent } = require('./base_agent');

class ArbitrationAgent extends BaseAgent {
    constructor({ agentId, organization = null }) {
        super({
            agentId,
            role: 'ARBITRATION',
            capabilities: ['tie_breaking', 'dispute_resolution'],
            organization,
            strategyType: 'ARBITRATOR'
        });
    }

    async execute(task, context = {}) {
        const disagreements = Array.isArray(context.disagreements) ? context.disagreements : [];
        const opinions = Array.isArray(context.opinions) ? context.opinions : [];
        const highSeverity = disagreements.filter((item) => item.severity === 'HIGH');
        const approveWeight = opinions
            .filter((item) => item.decision === 'APPROVE')
            .reduce((sum, item) => sum + ((Number(item.assignedWeight) || 0) * (Number(item.confidence) || 0)), 0);
        const rejectWeight = opinions
            .filter((item) => item.decision === 'REJECT')
            .reduce((sum, item) => sum + ((Number(item.assignedWeight) || 0) * (Number(item.confidence) || 0)), 0);
        const questionWeight = opinions
            .filter((item) => item.decision === 'QUESTION')
            .reduce((sum, item) => sum + ((Number(item.assignedWeight) || 0) * (Number(item.confidence) || 0)), 0);

        let finalDecision = 'OBSERVE';
        const reasons = [];
        if (highSeverity.length || rejectWeight > 0.2) {
            finalDecision = 'REJECT';
            reasons.push('high severity disagreement or rejecting weight detected');
        } else if (rejectWeight === 0 && approveWeight > 0) {
            finalDecision = 'COMMIT';
            reasons.push('arbitrator accepts proof-valid majority despite remaining questions');
        } else {
            reasons.push('arbitration keeps observation-only state');
        }

        return this.createEnvelope(task, {
            round: Number(context.round || context.currentRound || 1),
            status: 'ARBITRATED',
            finalDecision,
            reasons,
            disagreements,
            approveWeight: Number(approveWeight.toFixed(6)),
            rejectWeight: Number(rejectWeight.toFixed(6)),
            questionWeight: Number(questionWeight.toFixed(6))
        });
    }
}

module.exports = { ArbitrationAgent };
