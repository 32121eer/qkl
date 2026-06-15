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

const REP_DECAY = 0.98;
const REP_MIN = -10;
const REP_MAX = 10;
const SIGMA2_MAX = 0.5;

function computeVariance(arr) {
    if (!arr || arr.length < 2) return 0;
    const mean = arr.reduce((sum, x) => sum + x, 0) / arr.length;
    return arr.reduce((sum, x) => sum + (x - mean) ** 2, 0) / arr.length;
}

/**
 * WBFT-style reputation store for MA3C.
 *
 * Paper formula (MultiLLMN two-component weighted voting):
 *   Q_i = qualityScore_i * latencyScore_i
 *   T_i = trustScore_i * (1 - riskPenalty_i)
 *   A_i = Q_i / sum_j Q_j,  B_i = T_i / sum_j T_j
 *   rep_i = alpha * A_i + beta * B_i        ← exposed as `reputation`
 *   voteWeight_i = rep_i * confidence_i
 *
 * Because sum(A_i) = sum(B_i) = 1 and alpha + beta = 1, sum(rep_i) = 1.
 * `weight` is rep_i re-normalised to exactly 1.0 (floating-point correction).
 * WBFT voting uses `weight`; paper-facing surfaces use `reputation`.
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
        latencySmoothing = 0.35,
        consecutiveQuestionLimit = (() => {
            const v = parseInt(process.env['DEMO_WBFT_CONSECUTIVE_QUESTION_LIMIT'], 10);
            return v > 0 ? v : 3;
        })(),
        questionPenaltyStep = readRatioEnv('DEMO_WBFT_QUESTION_PENALTY_STEP', 0.15)
    } = {}) {
        this.epsilon = epsilon;
        this.alpha = alpha;
        this.beta = beta;
        this.latencyScaleMs = Math.max(1, latencyScaleMs);
        this.priorSuccess = priorSuccess;
        this.priorTotal = Math.max(priorTotal, priorSuccess + 1);
        this.qualitySmoothing = clamp01(qualitySmoothing);
        this.latencySmoothing = clamp01(latencySmoothing);
        this.consecutiveQuestionLimit = Math.max(1, consecutiveQuestionLimit);
        this.questionPenaltyStep = clamp01(questionPenaltyStep);
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
            reputation: 0.5,
            alignmentWindow: [],
            alignmentVariance: 0,
            inObservationPeriod: false,
            questionTotalCount: 0,
            consecutiveQuestionCount: 0,
            questionPenalty: 0,
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
            reputation: item.reputation,
            weight: item.weight,
            qualityWeight: item.qualityWeight,
            trustWeight: item.trustWeight,
            qualityScore: item.qualityScore,
            trustScore: item.trustScore,
            latencyScore: item.latencyScore,
            riskPenalty: item.riskPenalty,
            questionPenalty: item.questionPenalty,
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
                    item.reputation = round6(equalWeight);
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

    updateFromRound(opinions = [], finalProposal = null, {
        absentCommitters = [],
        silentRevealers = [],
        taskRisk = 'NORMAL'
    } = {}) {
        const opinionIds = opinions.map((item) => item.agentId).filter(Boolean);
        const absentIds = (Array.isArray(absentCommitters) ? absentCommitters : []).filter(Boolean);
        const silentIds = (Array.isArray(silentRevealers) ? silentRevealers : []).filter(Boolean);
        const allIds = Array.from(new Set([...opinionIds, ...absentIds, ...silentIds]));

        this.ensure(allIds);
        if (!allIds.length) {
            return [];
        }

        const lambdaR = taskRisk === 'CRITICAL' ? 1.5 : 1.0;
        const ALPHA = { a1: 1.0, a2: 0.5, a3: 0.3, a4: 1.5, a5: 2.0 };

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
            if (decision === 'QUESTION' && finalDecision !== 'OBSERVE') {
                // QUESTION signals insufficient evidence, not a wrong judgment.
                // When a definitive result exists, apply a small penalty rather than
                // the full misalignment penalty (which would incorrectly treat
                // abstention as an overconfident error).
                alignment = -0.1;
            } else if (matched && confidence > 0.7) {
                alignment = ALPHA.a1;
            } else if (matched) {
                alignment = ALPHA.a2;
            } else if (!matched && confidence > 0.7) {
                alignment = -ALPHA.a4;
                item.overconfidentFaultCount += 1;
            } else {
                alignment = -ALPHA.a3;
            }
            item.alignmentScore = round6((item.alignmentScore || 0) + alignment);
            item.reputation = round6(Math.max(REP_MIN, Math.min(REP_MAX,
                REP_DECAY * (item.reputation || 0) + lambdaR * alignment)));
            item.alignmentWindow = [...(item.alignmentWindow || []).slice(-9), alignment];
            item.alignmentVariance = round6(computeVariance(item.alignmentWindow));
            item.inObservationPeriod = item.alignmentVariance > SIGMA2_MAX;

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

            if (decision === 'QUESTION') {
                item.questionTotalCount = (item.questionTotalCount || 0) + 1;
                item.consecutiveQuestionCount = (item.consecutiveQuestionCount || 0) + 1;
            } else {
                item.consecutiveQuestionCount = 0;
            }
            const consecutiveExcess = Math.max(0, (item.consecutiveQuestionCount || 0) - this.consecutiveQuestionLimit);
            item.questionPenalty = round6(Math.min(0.5, consecutiveExcess * this.questionPenaltyStep));

            const faultPenalty = (item.faultCount + item.overconfidentFaultCount) / (item.totalCount + this.priorTotal);
            item.riskPenalty = round6(Math.min(0.9, faultPenalty + item.questionPenalty));
            item.lastUpdatedAt = new Date().toISOString();
        }

        // Absent committers: missed the commit window (paper: −α₃ = −0.3)
        for (const agentId of absentIds) {
            const item = this.items.get(agentId);
            if (!item) continue;
            item.totalCount += 1;
            item.faultCount += 1;
            item.alignmentScore = round6((item.alignmentScore || 0) - ALPHA.a3);
            item.reputation = round6(Math.max(REP_MIN, Math.min(REP_MAX,
                REP_DECAY * (item.reputation || 0) + lambdaR * (-ALPHA.a3))));
            item.alignmentWindow = [...(item.alignmentWindow || []).slice(-9), -ALPHA.a3];
            item.alignmentVariance = round6(computeVariance(item.alignmentWindow));
            item.inObservationPeriod = item.alignmentVariance > SIGMA2_MAX;
            item.trustScore = round6((item.successCount + this.priorSuccess) / (item.totalCount + this.priorTotal));
            const faultPenalty = (item.faultCount + item.overconfidentFaultCount) / (item.totalCount + this.priorTotal);
            item.riskPenalty = round6(Math.min(0.9, faultPenalty + (item.questionPenalty || 0)));
            item.lastUpdatedAt = new Date().toISOString();
        }

        // Silent revealers: committed but withheld reveal — silence attack (paper: −α₅ = −2.0)
        for (const agentId of silentIds) {
            const item = this.items.get(agentId);
            if (!item) continue;
            item.totalCount += 1;
            item.faultCount += 1;
            item.overconfidentFaultCount += 1;
            item.alignmentScore = round6((item.alignmentScore || 0) - ALPHA.a5);
            item.reputation = round6(Math.max(REP_MIN, Math.min(REP_MAX,
                REP_DECAY * (item.reputation || 0) + lambdaR * (-ALPHA.a5))));
            item.alignmentWindow = [...(item.alignmentWindow || []).slice(-9), -ALPHA.a5];
            item.alignmentVariance = round6(computeVariance(item.alignmentWindow));
            item.inObservationPeriod = item.alignmentVariance > SIGMA2_MAX;
            item.trustScore = round6((item.successCount + this.priorSuccess) / (item.totalCount + this.priorTotal));
            const faultPenalty = (item.faultCount + item.overconfidentFaultCount) / (item.totalCount + this.priorTotal);
            item.riskPenalty = round6(Math.min(0.9, faultPenalty + (item.questionPenalty || 0)));
            item.lastUpdatedAt = new Date().toISOString();
        }

        this.normalize(allIds);
        return allIds.map((agentId) => ({ ...this.items.get(agentId) })).filter(Boolean);
    }
}

module.exports = { ReputationStore };
