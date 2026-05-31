function clamp01(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) {
        return 0;
    }
    return Math.max(0, Math.min(1, n));
}

function round6(value) {
    return Number((Number(value) || 0).toFixed(6));
}

function readRatioEnv(name, fallback) {
    const value = Number(process.env[name]);
    if (!Number.isFinite(value) || value < 0) {
        return fallback;
    }
    return value;
}

/**
 * WBFT-style reputation store for MA3C.
 *
 * The implementation follows MultiLLMN's two-component weighted voting idea:
 * A_i^r = Q_i^r / sum_j Q_j^r, B_i^r = T_i^r / sum_j T_j^r,
 * w_i^r = alpha * A_i^r + beta * B_i^r.
 *
 * In MA3C, Q_i^r denotes cross-chain validation quality with latency penalty,
 * while T_i^r denotes long-term trust derived from historical correctness.
 */
class ReputationStore {
    constructor({
        epsilon = 0.01,
        alpha = readRatioEnv('DEMO_WBFT_ALPHA', 0.4),
        beta = readRatioEnv('DEMO_WBFT_BETA', 0.6),
        latencyScaleMs = readRatioEnv('DEMO_WBFT_LATENCY_SCALE_MS', 250),
        priorSuccess = 1,
        priorTotal = 2,
        qualitySmoothing = 0.4,
        latencySmoothing = 0.35
    } = {}) {
        this.epsilon = epsilon;
        this.alpha = alpha;
        this.beta = beta;
        this.latencyScaleMs = Math.max(1, latencyScaleMs);
        this.priorSuccess = priorSuccess;
        this.priorTotal = Math.max(priorTotal, priorSuccess + 1);
        this.qualitySmoothing = clamp01(qualitySmoothing);
        this.latencySmoothing = clamp01(latencySmoothing);
        this.items = new Map();
    }

    coefficients() {
        const total = this.alpha + this.beta;
        if (total <= 0) {
            return { alpha: 0.5, beta: 0.5 };
        }
        return {
            alpha: this.alpha / total,
            beta: this.beta / total
        };
    }

    createItem(agentId) {
        return {
            agentId,
            weight: 0,
            qualityScore: 0.5,
            trustScore: this.priorSuccess / this.priorTotal,
            latencyScore: 1,
            riskPenalty: 0,
            qualityWeight: 0,
            trustWeight: 0,
            combinedWeightRaw: 0,
            successCount: 0,
            totalCount: 0,
            avgLatencyMs: 0,
            faultCount: 0,
            alignmentScore: 0,
            overconfidentFaultCount: 0,
            lastUpdatedAt: new Date().toISOString(),
            formulaVersion: 'ma3c-wbft-v1'
        };
    }

    ensure(agentIds = []) {
        const normalizedIds = Array.from(new Set(agentIds.filter(Boolean)));
        if (!normalizedIds.length) {
            return [];
        }

        for (const agentId of normalizedIds) {
            if (!this.items.has(agentId)) {
                this.items.set(agentId, this.createItem(agentId));
            }
        }

        const equalWeight = 1 / normalizedIds.length;
        for (const agentId of normalizedIds) {
            const item = this.items.get(agentId);
            if (!item.weight || item.weight <= 0) {
                item.weight = equalWeight;
            }
        }
        this.normalize(normalizedIds);
        return normalizedIds.map((agentId) => ({ ...this.items.get(agentId) }));
    }

    get(agentId) {
        const item = this.items.get(agentId);
        return item ? { ...item } : null;
    }

    getWeight(agentId) {
        return this.items.get(agentId)?.weight || 0;
    }

    getWeightVector(agentIds = []) {
        return this.ensure(agentIds).map((item) => ({
            agentId: item.agentId,
            weight: item.weight,
            qualityWeight: item.qualityWeight,
            trustWeight: item.trustWeight,
            qualityScore: item.qualityScore,
            trustScore: item.trustScore,
            latencyScore: item.latencyScore,
            riskPenalty: item.riskPenalty,
            formulaVersion: item.formulaVersion
        }));
    }

    importSnapshots(snapshots = {}) {
        const entries = Array.isArray(snapshots)
            ? snapshots.map((item) => [item?.agentId, item])
            : Object.entries(snapshots || {});

        for (const [agentId, snapshot] of entries) {
            if (!agentId || !snapshot || typeof snapshot !== 'object') {
                continue;
            }
            const base = this.createItem(agentId);
            this.items.set(agentId, {
                ...base,
                ...snapshot,
                agentId,
                formulaVersion: snapshot.formulaVersion || base.formulaVersion,
                lastUpdatedAt: snapshot.lastUpdatedAt || base.lastUpdatedAt
            });
        }
    }

    exportSnapshots(agentIds = null) {
        const ids = Array.isArray(agentIds)
            ? agentIds.filter(Boolean)
            : Array.from(this.items.keys());
        return ids.reduce((acc, agentId) => {
            const item = this.items.get(agentId);
            if (item) {
                const { _qualityRaw, _trustRaw, ...snapshot } = item;
                acc[agentId] = { ...snapshot };
            }
            return acc;
        }, {});
    }

    latencyObservation(latencyMs) {
        const latency = Math.max(0, Number(latencyMs) || 0);
        return round6(1 / (1 + (latency / this.latencyScaleMs)));
    }

    updateMovingAverage(previous, observation, smoothing) {
        return round6((1 - smoothing) * clamp01(previous) + smoothing * clamp01(observation));
    }

    normalize(agentIds = []) {
        const ids = Array.from(new Set(agentIds.filter(Boolean)));
        if (!ids.length) {
            return;
        }

        let totalQuality = 0;
        let totalTrust = 0;
        for (const agentId of ids) {
            const item = this.items.get(agentId);
            if (!item) {
                continue;
            }
            const qualityRaw = Math.max(this.epsilon, clamp01(item.qualityScore) * clamp01(item.latencyScore));
            const trustRaw = Math.max(this.epsilon, clamp01(item.trustScore) * (1 - clamp01(item.riskPenalty)));
            item._qualityRaw = qualityRaw;
            item._trustRaw = trustRaw;
            totalQuality += qualityRaw;
            totalTrust += trustRaw;
        }

        if (totalQuality <= 0 || totalTrust <= 0) {
            const equalWeight = 1 / ids.length;
            for (const agentId of ids) {
                const item = this.items.get(agentId);
                if (item) {
                    item.qualityWeight = round6(equalWeight);
                    item.trustWeight = round6(equalWeight);
                    item.combinedWeightRaw = round6(equalWeight);
                    item.weight = round6(equalWeight);
                    delete item._qualityRaw;
                    delete item._trustRaw;
                }
            }
            return;
        }

        const { alpha, beta } = this.coefficients();
        let totalCombined = 0;
        for (const agentId of ids) {
            const item = this.items.get(agentId);
            if (item) {
                item.qualityWeight = round6(item._qualityRaw / totalQuality);
                item.trustWeight = round6(item._trustRaw / totalTrust);
                item.combinedWeightRaw = round6((alpha * item.qualityWeight) + (beta * item.trustWeight));
                totalCombined += item.combinedWeightRaw;
            }
        }

        for (const agentId of ids) {
            const item = this.items.get(agentId);
            if (item) {
                item.weight = totalCombined > 0
                    ? round6(item.combinedWeightRaw / totalCombined)
                    : round6(1 / ids.length);
                delete item._qualityRaw;
                delete item._trustRaw;
            }
        }
    }

    updateFromRound(opinions = [], finalProposal = null) {
        const agentIds = opinions.map((item) => item.agentId).filter(Boolean);
        this.ensure(agentIds);
        if (!agentIds.length) {
            return [];
        }

        for (const opinion of opinions) {
            const item = this.items.get(opinion.agentId);
            if (!item) {
                continue;
            }

            const decision = String(opinion.decision || 'QUESTION').toUpperCase();
            const finalDecision = String(finalProposal?.finalDecision || 'OBSERVE').toUpperCase();
            const matched = (
                (finalDecision === 'COMMIT' && decision === 'APPROVE') ||
                (finalDecision === 'REJECT' && decision === 'REJECT') ||
                (finalDecision === 'OBSERVE' && decision === 'QUESTION')
            );

            item.totalCount += 1;
            if (matched) {
                item.successCount += 1;
            } else {
                item.faultCount += 1;
            }

            const latencyMs = Number(opinion.latencyMs) || 0;
            item.avgLatencyMs = item.totalCount === 1
                ? latencyMs
                : Number((((item.avgLatencyMs * (item.totalCount - 1)) + latencyMs) / item.totalCount).toFixed(2));

            const confidence = clamp01(opinion.confidence ?? 0.5);
            let alignment = 0;
            if (matched && confidence > 0.7) {
                alignment = 1.0;
            } else if (matched) {
                alignment = 0.5;
            } else if (confidence > 0.7) {
                alignment = -1.5;
                item.overconfidentFaultCount += 1;
            } else {
                alignment = -0.3;
            }
            item.alignmentScore = round6((item.alignmentScore || 0) + alignment);

            const validationObservation = matched
                ? confidence
                : Math.max(0, 0.5 + (alignment / 3));
            const latencyObservation = this.latencyObservation(latencyMs);
            item.qualityScore = this.updateMovingAverage(
                item.qualityScore,
                validationObservation,
                this.qualitySmoothing
            );
            item.latencyScore = this.updateMovingAverage(
                item.latencyScore,
                latencyObservation,
                this.latencySmoothing
            );
            item.trustScore = round6((item.successCount + this.priorSuccess) / (item.totalCount + this.priorTotal));
            item.riskPenalty = round6(Math.min(
                0.9,
                (item.faultCount + item.overconfidentFaultCount) / (item.totalCount + this.priorTotal)
            ));
            item.lastUpdatedAt = new Date().toISOString();
        }

        this.normalize(agentIds);
        return agentIds.map((agentId) => ({ ...this.items.get(agentId) }));
    }
}

module.exports = { ReputationStore };
