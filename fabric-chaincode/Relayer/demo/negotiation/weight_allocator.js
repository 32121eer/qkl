const { DEFAULT_NORMAL_THRESHOLD } = require('./protocol_config');

const DEFAULT_WBFT_THRESHOLD = DEFAULT_NORMAL_THRESHOLD;

function round6(value) {
    return Number((Number(value) || 0).toFixed(6));
}

class WeightAllocator {
    constructor({ reputationStore, thresholdRatio = DEFAULT_WBFT_THRESHOLD }) {
        this.reputationStore = reputationStore;
        this.thresholdRatio = thresholdRatio;
    }

    assign(agentIds = []) {
        const snapshots = this.reputationStore.ensure(agentIds);
        return snapshots.reduce((acc, item) => {
            acc[item.agentId] = item.weight;
            return acc;
        }, {});
    }

    summarize(opinions = []) {
        const summary = {
            totalWeight: 0,
            approvedWeight: 0,
            rejectedWeight: 0,
            questionedWeight: 0,
            approvedEffectiveWeight: 0,
            rejectedEffectiveWeight: 0,
            questionedEffectiveWeight: 0,
            thresholdWeight: 0,
            thresholdRatio: round6(this.thresholdRatio),
            acceptRatio: 0,
            wbftSatisfied: false
        };

        for (const opinion of opinions) {
            const weight = Number(opinion.assignedWeight) || 0;
            const confidence = Math.max(0, Math.min(1, Number(opinion.confidence) || 0));
            const effectiveWeight = weight * confidence;
            summary.totalWeight += weight;
            if (opinion.decision === 'APPROVE') {
                summary.approvedWeight += weight;
                summary.approvedEffectiveWeight += effectiveWeight;
            } else if (opinion.decision === 'REJECT') {
                summary.rejectedWeight += weight;
                summary.rejectedEffectiveWeight += effectiveWeight;
            } else {
                summary.questionedWeight += weight;
                summary.questionedEffectiveWeight += effectiveWeight;
            }
        }

        summary.totalWeight = round6(summary.totalWeight);
        summary.approvedWeight = round6(summary.approvedWeight);
        summary.rejectedWeight = round6(summary.rejectedWeight);
        summary.questionedWeight = round6(summary.questionedWeight);
        summary.approvedEffectiveWeight = round6(summary.approvedEffectiveWeight);
        summary.rejectedEffectiveWeight = round6(summary.rejectedEffectiveWeight);
        summary.questionedEffectiveWeight = round6(summary.questionedEffectiveWeight);
        summary.thresholdWeight = round6(summary.totalWeight * this.thresholdRatio);
        const decisiveWeight = summary.approvedEffectiveWeight + summary.rejectedEffectiveWeight;
        summary.acceptRatio = decisiveWeight > 0
            ? round6(summary.approvedEffectiveWeight / decisiveWeight)
            : 0;
        summary.wbftSatisfied = decisiveWeight > 0 && summary.acceptRatio >= this.thresholdRatio;
        return summary;
    }
}

module.exports = {
    DEFAULT_WBFT_THRESHOLD,
    WeightAllocator
};
