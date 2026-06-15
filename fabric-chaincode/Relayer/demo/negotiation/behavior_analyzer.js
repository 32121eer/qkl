class BehaviorAnalyzer {
    analyzeCandidates({ agents = [], history = [], reputationStore = null }) {
        const reports = {};
        const voteMatrix = {};

        for (const agent of agents) {
            const snapshot = reputationStore?.get(agent.agentId) || null;
            reports[agent.agentId] = {
                agentId: agent.agentId,
                role: agent.role,
                focus: agent.focus || null,
                organization: agent.organization || null,
                strategyType: agent.strategyType || null,
                successRate: snapshot?.totalCount ? snapshot.successCount / snapshot.totalCount : 0,
                avgLatencyMs: snapshot?.avgLatencyMs || 0,
                faultCount: snapshot?.faultCount || 0,
                collusionScore: 0,
                eclipseScore: 0,
                riskScore: 0,
                excluded: false,
                reasons: []
            };
            voteMatrix[agent.agentId] = [];
        }

        // Sliding window: only consider the most recent COLLUSION_WINDOW disputed
        // entries. Full-history traversal skews collusion scores when early sparse
        // data produces artificially high vote similarity between agents (§IV-G).
        const COLLUSION_WINDOW = 50;
        const recentDisputed = history.filter((e) => e.wasDisputed).slice(-COLLUSION_WINDOW);
        for (const entry of recentDisputed) {
            const opinions = Array.isArray(entry?.coordination?.opinions)
                ? entry.coordination.opinions
                : Array.isArray(entry?.opinions)
                    ? entry.opinions
                    : Array.isArray(entry?.agentOpinions)
                        ? entry.agentOpinions
                        : [];
            for (const opinion of opinions) {
                if (!voteMatrix[opinion.agentId]) {
                    voteMatrix[opinion.agentId] = [];
                }
                voteMatrix[opinion.agentId].push(String(opinion.decision || 'QUESTION').toUpperCase());
            }
        }

        const ids = agents.map((agent) => agent.agentId);
        for (let i = 0; i < ids.length; i += 1) {
            for (let j = i + 1; j < ids.length; j += 1) {
                const left = voteMatrix[ids[i]] || [];
                const right = voteMatrix[ids[j]] || [];
                const overlap = Math.min(left.length, right.length);
                if (overlap < 20) {
                    continue;
                }
                let sameCount = 0;
                for (let index = 0; index < overlap; index += 1) {
                    if (left[index] === right[index]) {
                        sameCount += 1;
                    }
                }
                const similarity = sameCount / overlap;
                if (similarity >= 0.9) {
                    reports[ids[i]].collusionScore = Math.max(reports[ids[i]].collusionScore, similarity);
                    reports[ids[j]].collusionScore = Math.max(reports[ids[j]].collusionScore, similarity);
                }
            }
        }

        for (const agentId of ids) {
            const report = reports[agentId];
            if (report.avgLatencyMs > 250) {
                report.eclipseScore += 0.25;
                report.reasons.push('high latency pattern');
            }
            if (report.faultCount >= 2) {
                report.eclipseScore += 0.2;
                report.reasons.push('repeated non-final or faulty decisions');
            }
            if (report.faultCount >= 4) {
                report.eclipseScore += 0.35;
                report.reasons.push('persistent faulty history');
            }
            if (report.collusionScore >= 0.9) {
                report.reasons.push('vote similarity suggests hidden collusion');
            }

            report.riskScore = Number(Math.min(
                1,
                0.45 * report.collusionScore + 0.35 * report.eclipseScore + 0.2 * (1 - report.successRate)
            ).toFixed(4));
            report.excluded = report.riskScore >= 0.65 || report.faultCount >= 4;
            if (report.faultCount >= 4 && !report.reasons.includes('persistent faulty history')) {
                report.reasons.push('persistent faulty history');
            }
        }

        return {
            reports,
            hiddenCollusionAgents: Object.values(reports).filter((item) => item.collusionScore >= 0.9).map((item) => item.agentId),
            eclipseRiskAgents: Object.values(reports).filter((item) => item.eclipseScore >= 0.35).map((item) => item.agentId)
        };
    }
}

module.exports = { BehaviorAnalyzer };
