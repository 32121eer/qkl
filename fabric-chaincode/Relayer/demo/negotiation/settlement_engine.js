class SettlementEngine {
    constructor({
        baseFee = 12,
        slashPenalty = 5
    } = {}) {
        this.baseFee = baseFee;
        this.slashPenalty = slashPenalty;
    }

    settle({ finalProposal, queryId }) {
        if (!finalProposal) {
            return null;
        }

        const participants = [
            ...(finalProposal.supportingAgents || []).map((item) => ({ ...item, bucket: 'support' })),
            ...(finalProposal.questioningAgents || []).map((item) => ({ ...item, bucket: 'question' })),
            ...(finalProposal.rejectingAgents || []).map((item) => ({ ...item, bucket: 'reject' }))
        ];

        const supportWeight = participants
            .filter((item) => item.bucket === 'support')
            .reduce((sum, item) => sum + (Number(item.effectiveWeight ?? item.weight) || 0), 0);

        const allocations = participants.map((item) => {
            const weight = Number(item.weight) || 0;
            const effectiveWeight = Number(item.effectiveWeight ?? item.weight) || 0;
            const confidence = Number(item.confidence) || 0;
            let reward = 0;
            let slash = 0;
            if (item.bucket === 'support' && finalProposal.finalDecision === 'COMMIT') {
                reward = supportWeight > 0 ? Number(((this.baseFee * effectiveWeight) / supportWeight).toFixed(4)) : 0;
            } else if (item.bucket === 'reject' && finalProposal.finalDecision === 'REJECT') {
                reward = Number((this.baseFee * 0.5 * Math.max(effectiveWeight, 0.01)).toFixed(4));
            } else if (item.bucket === 'reject' && finalProposal.finalDecision === 'COMMIT') {
                slash = confidence > 0.7 ? this.slashPenalty * 1.5 : this.slashPenalty;
            }
            return {
                agentId: item.agentId,
                bucket: item.bucket,
                weight,
                confidence,
                effectiveWeight,
                reward,
                slash
            };
        });

        return {
            settlementId: `settlement_${queryId || finalProposal.queryId || Date.now()}`,
            feePool: this.baseFee,
            slashPenalty: this.slashPenalty,
            finalDecision: finalProposal.finalDecision,
            allocations
        };
    }
}

module.exports = { SettlementEngine };
