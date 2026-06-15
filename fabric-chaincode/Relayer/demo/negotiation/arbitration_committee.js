const { CommitteeSelector } = require('./committee_selector');
const { CommitRevealSession } = require('./commit_reveal_session');
const { sealOpinion } = require('./commit_reveal');
const { buildProtocolParams } = require('./protocol_config');

function round6(value) {
    return Number((Number(value) || 0).toFixed(6));
}

/**
 * Arbitration Committee (论文 §IV-F)
 *
 * Triggered when Phase-3 verifier consensus reaches OBSERVE (no supermajority).
 * Selects k=5 independent arbitrators via VRF with org-diversity constraint
 * (≤⌊k/3⌋ per org), runs the same commit-reveal protocol as Phase 3, and
 * produces a terminal COMMIT or REJECT decision (θ_arb = 0.75).
 *
 * Eligible arbitrators: role === 'ARBITRATION' && rep(a) >= θ_arb_rep
 * Full context passed to each arbitrator:
 *   evidence          — complete evidenceBundle from the cross-chain task
 *   verifierOpinions  — all Phase-3 verifier sealed opinions
 *   reasonHashes      — privacy-preserving hashes of verifier reasoning
 *   conflictEvidence  — disagreement records from Phase-3
 */
class ArbitrationCommittee {
    constructor({ agentPool = [], reputationStore = null, committeeSelector = null } = {}) {
        this.agentPool = agentPool;
        this.reputationStore = reputationStore;
        this.committeeSelector = committeeSelector || new CommitteeSelector({ reputationStore });
    }

    // ── SELECTION ─────────────────────────────────────────────────────────────

    select(task, protocolParams) {
        const repThreshold = Number(protocolParams?.arbitrationRepThreshold ?? 0);
        const k = Math.max(1, Number(protocolParams?.arbitrationGroupSize) || 5);
        const orgLimit = Math.max(1, Math.floor(k / 3));

        const arbitrators = this.agentPool.filter((a) => a.role === 'ARBITRATION');
        const eligible = arbitrators.filter((a) =>
            (this.reputationStore?.get(a.agentId)?.reputation ?? 0) >= repThreshold
        );

        // Fall back to all ARBITRATION agents when the pool is small and few
        // have crossed the threshold (bootstrap scenario with zero history).
        const pool = eligible.length >= k ? eligible : arbitrators;

        return this.committeeSelector.select({
            agents: pool,
            committeeSize: k,
            task,
            protocolParams: {
                ...protocolParams,
                reputationMin: repThreshold,
                organizationLimit: orgLimit
            }
        });
    }

    // ── COMMIT-REVEAL + WEIGHTED CONSENSUS ────────────────────────────────────

    async run(task, fullContext = {}, { protocolParams, eventEmit } = {}) {
        const params = protocolParams || buildProtocolParams(task?.risk);
        const round = Number(fullContext?.round || 1);
        const threshold = Number(params.arbitrationThreshold) || 0.75;

        const selection = this.select(task, params);
        const selected = selection.selected;

        const crSession = new CommitRevealSession({
            agentIds: selected.map((a) => a.agentId),
            taskId: task?.taskId,
            round
        });

        // COMMIT PHASE — each arbitrator receives the full evidence + verifier context
        const sealedByAgent = new Map();
        for (const arbitrator of selected) {
            const startedAt = Date.now();
            try {
                const verdict = await arbitrator.execute(task, {
                    ...fullContext,
                    assignedWeight: round6(1 / Math.max(1, selected.length)),
                    round,
                    currentRound: round
                });
                const sealed = sealOpinion({
                    ...verdict,
                    assignedWeight: round6(1 / Math.max(1, selected.length)),
                    latencyMs: Date.now() - startedAt
                }, { task, round });
                crSession.submitCommit(arbitrator.agentId, sealed.commitReveal.commitHash);
                sealedByAgent.set(arbitrator.agentId, sealed);
                _emit(eventEmit, {
                    phase: 'ARB_COMMITTED',
                    agentId: arbitrator.agentId,
                    commitHash: sealed.commitReveal.commitHash,
                    round
                });
            } catch (err) {
                // Agent absent from commit phase — recorded by crSession automatically
                _emit(eventEmit, {
                    phase: 'ARB_COMMIT_ABSENT',
                    agentId: arbitrator.agentId,
                    error: err.message || String(err),
                    round
                });
            }
        }

        crSession.closeCommitPhase();

        // REVEAL PHASE
        for (const [agentId, sealed] of sealedByAgent) {
            const rev = sealed.commitReveal.reveal;
            crSession.submitReveal(agentId, {
                judgment: rev.judgment,
                confidence: rev.confidence,
                nonce: rev.nonce,
                reasonHash: rev.reasonHash
            });
        }
        crSession.closeRevealPhase();

        // WEIGHTED CONSENSUS (same formula as Phase-3, threshold θ_arb)
        const validRevealIds = new Set(crSession.validReveals().map((r) => r.agentId));
        const weightVector = this.reputationStore
            ? this.reputationStore.getWeightVector(selected.map((a) => a.agentId))
            : selected.map((a) => ({ agentId: a.agentId, weight: round6(1 / selected.length) }));
        const weightMap = new Map(weightVector.map((w) => [w.agentId, w]));

        const arbitratorOpinions = [];
        let acceptWeight = 0;
        let rejectWeight = 0;
        let abstainWeight = 0;

        for (const [agentId, sealed] of sealedByAgent) {
            if (!validRevealIds.has(agentId)) continue;
            const w = (weightMap.get(agentId)?.weight || round6(1 / selected.length));
            const confidence = Number(sealed.confidence ?? sealed.commitReveal?.reveal?.confidence ?? 0.5);
            const effectiveW = w * confidence;
            const judgment = sealed.judgment || sealed.commitReveal?.reveal?.judgment || 'ABSTAIN';
            if (judgment === 'ACCEPT') acceptWeight += effectiveW;
            else if (judgment === 'REJECT') rejectWeight += effectiveW;
            else abstainWeight += effectiveW;
            arbitratorOpinions.push(sealed);
        }

        const totalEffective = acceptWeight + rejectWeight + abstainWeight || 1;
        const acceptRatio = round6(acceptWeight / totalEffective);
        const rejectRatio = round6(rejectWeight / totalEffective);

        // Terminal decision — no further escalation possible
        let finalDecision;
        let decisionReason;
        if (rejectRatio >= threshold) {
            finalDecision = 'REJECT';
            decisionReason = `arbitration committee reject supermajority (${(rejectRatio * 100).toFixed(1)}% ≥ ${threshold * 100}%)`;
        } else if (acceptRatio >= threshold) {
            finalDecision = 'COMMIT';
            decisionReason = `arbitration committee accept supermajority (${(acceptRatio * 100).toFixed(1)}% ≥ ${threshold * 100}%)`;
        } else {
            // No supermajority: use plurality; ties default to REJECT (conservative)
            finalDecision = acceptWeight > rejectWeight ? 'COMMIT' : 'REJECT';
            decisionReason = `arbitration plurality (accept=${acceptRatio.toFixed(3)}, reject=${rejectRatio.toFixed(3)}, no supermajority)`;
        }

        _emit(eventEmit, { phase: 'ARB_DECIDED', finalDecision, acceptRatio, rejectRatio, round });

        return {
            finalDecision,
            decisionReason,
            isTerminal: true,
            phase: 'ARBITRATION_COMMITTEE',
            round,
            selected: selected.map((a) => a.agentId),
            selectionSeed: selection.selectionSeed,
            constraints: selection.constraints,
            commitRevealSummary: crSession.summary(),
            weightedVotes: {
                acceptWeight: round6(acceptWeight),
                rejectWeight: round6(rejectWeight),
                abstainWeight: round6(abstainWeight),
                acceptRatio,
                rejectRatio,
                threshold
            },
            arbitratorOpinions
        };
    }
}

function _emit(fn, data) {
    if (typeof fn === 'function') fn(data);
}

module.exports = { ArbitrationCommittee };
