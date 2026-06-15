const crypto = require('node:crypto');
const { buildProtocolParams } = require('./protocol_config');

function round6(value) {
    return Number((Number(value) || 0).toFixed(6));
}

function sha256(value) {
    return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function deterministicUnit(seed, key) {
    const hex = sha256(`${seed}:${key}`).slice(0, 12);
    return Math.max(1e-12, parseInt(hex, 16) / 0xffffffffffff);
}

class CommitteeSelector {
    constructor({ reputationStore, targetCommitteeSize = 3 } = {}) {
        this.reputationStore = reputationStore;
        this.targetCommitteeSize = targetCommitteeSize;
    }

    buildScore(agent, behaviorReport) {
        const snapshot = this.reputationStore?.get(agent.agentId) || null;
        const reputation = snapshot?.reputation || 0;
        const rawWeight = snapshot?.weight || 0;
        const qualityWeight = snapshot?.qualityWeight || 0;
        const trustWeight = snapshot?.trustWeight || 0;
        const trustScore = snapshot?.trustScore ?? 0.5;
        const latencyScore = snapshot?.latencyScore || 0;
        const risk = behaviorReport?.riskScore || 0;
        const inObservation = snapshot?.inObservationPeriod || false;
        const weight = inObservation ? round6(rawWeight * 0.5) : rawWeight;
        const score = (0.55 * weight) + (0.2 * qualityWeight) + (0.15 * trustWeight) + (0.1 * latencyScore) - risk;
        return {
            agent,
            score: Number(score.toFixed(6)),
            reputation,
            weight,
            qualityWeight,
            trustWeight,
            trustScore,
            latencyScore,
            risk,
            focus: agent.focus || 'balanced',
            organization: agent.organization || 'unknown-org',
            strategyType: agent.strategyType || agent.focus || 'balanced',
            excluded: Boolean(behaviorReport?.excluded)
        };
    }

    buildSelectionSeed({ task = null, protocolParams = null } = {}) {
        const seedInput = {
            taskId: task?.taskId || null,
            queryId: task?.queryId || null,
            evidenceVersion: task?.evidenceVersion || 0,
            risk: protocolParams?.risk || task?.risk || 'NORMAL',
            sourceChain: task?.sourceChain || null,
            targetChain: task?.targetChain || null,
            sourceHeaderHash: task?.evidenceBundle?.sourceHeaderHash || task?.evidenceBundle?.queryProof?.sourceHeaderHash || null,
            payloadHash: task?.evidenceBundle?.payloadHash || null
        };
        return `vrf_${sha256(JSON.stringify(seedInput)).slice(0, 24)}`;
    }

    rankEligible(eligible = [], seed) {
        return eligible
            .map((item) => {
                const weightedRandom = deterministicUnit(seed, item.agent.agentId);
                const effectiveWeight = Math.max(0.000001, Number(item.weight) || 0.000001);
                const randomKey = Math.pow(weightedRandom, 1 / effectiveWeight);
                return {
                    ...item,
                    randomKey: round6(randomKey)
                };
            })
            .sort((a, b) => b.randomKey - a.randomKey || b.score - a.score || a.agent.agentId.localeCompare(b.agent.agentId));
    }

    wouldViolateOrganization(selected = [], candidate, limit) {
        const organization = candidate.organization || 'unknown-org';
        const count = selected.filter((item) => (item.organization || 'unknown-org') === organization).length;
        return count >= limit;
    }

    pushCandidate(selected, item, { finalSize, organizationLimit }) {
        if (selected.length >= finalSize) {
            return false;
        }
        if (selected.find((existing) => existing.agent.agentId === item.agent.agentId)) {
            return false;
        }
        if (this.wouldViolateOrganization(selected, item, organizationLimit)) {
            return false;
        }
        selected.push(item);
        return true;
    }

    select({ agents = [], behaviorAnalysis = null, committeeSize = null, task = null, protocolParams = null }) {
        const params = protocolParams || buildProtocolParams(task?.risk);
        const finalSize = Math.max(1, Number(committeeSize) || params.groupSize || this.targetCommitteeSize);
        const organizationLimit = Math.max(1, Number(params.organizationLimit) || Math.floor(finalSize / 3) || 1);
        this.reputationStore?.ensure(agents.map((agent) => agent.agentId));
        const scored = agents.map((agent) => this.buildScore(
            agent,
            behaviorAnalysis?.reports?.[agent.agentId] || null
        ));

        const selectionSeed = this.buildSelectionSeed({ task, protocolParams: params });
        const eligible = this.rankEligible(scored
            .filter((item) => !item.excluded)
            .filter((item) => item.reputation >= params.reputationMin || scored.length <= finalSize), selectionSeed);

        const selected = [];
        const availableStrategies = Array.from(new Set(eligible.map((item) => item.strategyType).filter(Boolean)));
        const requiredStrategies = availableStrategies.slice(0, Math.min(3, availableStrategies.length));

        for (const strategyType of requiredStrategies) {
            const strategyCandidates = eligible
                .filter((item) => item.strategyType === strategyType)
                .sort((a, b) => b.score - a.score || b.weight - a.weight || a.agent.agentId.localeCompare(b.agent.agentId));
            for (const item of strategyCandidates) {
                if (this.pushCandidate(selected, item, { finalSize, organizationLimit })) {
                    break;
                }
            }
        }

        for (const item of eligible) {
            this.pushCandidate(selected, item, { finalSize, organizationLimit });
            if (selected.length >= finalSize) {
                break;
            }
        }

        // If the pool cannot satisfy the paper diversity bound, keep progress
        // visible by relaxing the org cap only after all constrained candidates
        // have been tried.
        if (selected.length < finalSize) {
            for (const item of eligible) {
                if (selected.length >= finalSize) {
                    break;
                }
                if (!selected.find((existing) => existing.agent.agentId === item.agent.agentId)) {
                    selected.push(item);
                }
            }
        }

        return {
            selected: selected.map((item) => item.agent),
            selectionSeed,
            constraints: {
                organizationLimit,
                requiredStrategies,
                selectedOrganizations: selected.map((item) => item.organization),
                selectedStrategies: selected.map((item) => item.strategyType),
                strategyHeterogeneous: new Set(selected.map((item) => item.strategyType)).size >= Math.min(2, requiredStrategies.length),
                organizationDiverse: selected.every((item) => {
                    const count = selected.filter((candidate) => candidate.organization === item.organization).length;
                    return count <= organizationLimit;
                })
            },
            excluded: scored.filter((item) => !selected.find((selectedItem) => selectedItem.agent.agentId === item.agent.agentId)).map((item) => ({
                agentId: item.agent.agentId,
                availabilityStatus: item.agent.availabilityStatus || 'available',
                score: item.score,
                reputation: item.reputation,
                weight: item.weight,
                qualityWeight: item.qualityWeight,
                trustWeight: item.trustWeight,
                trustScore: item.trustScore,
                latencyScore: item.latencyScore,
                risk: item.risk,
                organization: item.organization,
                strategyType: item.strategyType,
                excluded: item.excluded
            }))
        };
    }
}

module.exports = { CommitteeSelector };
