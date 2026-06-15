const { buildCommitment } = require('./commit_reveal');

/**
 * Two-phase commit-reveal session for a single negotiation round.
 *
 * Protocol (论文 §IV-E):
 *   COMMIT  phase → each agent submits H(judgment ‖ confidence ‖ nonce)
 *   REVEAL  phase → each agent submits plaintext (judgment, confidence, nonce)
 *                   coordinator verifies hash match
 *   CLOSED  phase → final audit data available
 *
 * Penalty classification (for reputation_store):
 *   absentCommitters  — did not commit within T_commit (penalty: −α₃)
 *   silentRevealers   — committed but did not reveal (silence attack, penalty: −α₅)
 *   invalidRevealers  — reveal does not match commit hash (tampered)
 */
class CommitRevealSession {
    constructor({ agentIds = [], taskId = null, round = 1 } = {}) {
        this.taskId = taskId;
        this.round = round;
        this.phase = 'COMMIT';
        this._agentIds = new Set(agentIds.filter(Boolean));
        this._commits = new Map();
        this._reveals = new Map();
        this.absentCommitters = [];
        this.silentRevealers  = [];
        this.createdAt = new Date().toISOString();
        this.commitClosedAt = null;
        this.revealClosedAt = null;
    }

    // ── COMMIT PHASE ──────────────────────────────────────────────────────────

    submitCommit(agentId, commitHash) {
        if (this.phase !== 'COMMIT') {
            return { ok: false, reason: `cannot commit in phase ${this.phase}` };
        }
        if (!this._agentIds.has(agentId)) {
            return { ok: false, reason: 'agent not registered in this session' };
        }
        if (this._commits.has(agentId)) {
            return { ok: false, reason: 'duplicate commit' };
        }
        this._commits.set(agentId, { commitHash, submittedAt: new Date().toISOString() });
        return { ok: true };
    }

    // Advance to REVEAL phase; agents that did not commit are marked absent.
    closeCommitPhase() {
        if (this.phase !== 'COMMIT') return;
        this.absentCommitters = [];
        for (const agentId of this._agentIds) {
            if (!this._commits.has(agentId)) {
                this.absentCommitters.push(agentId);
            }
        }
        this.phase = 'REVEAL';
        this.commitClosedAt = new Date().toISOString();
    }

    // ── REVEAL PHASE ──────────────────────────────────────────────────────────

    submitReveal(agentId, { judgment, confidence, nonce, reasonHash = null }) {
        if (this.phase !== 'REVEAL') {
            return { ok: false, reason: `cannot reveal in phase ${this.phase}` };
        }
        const committed = this._commits.get(agentId);
        if (!committed) {
            return { ok: false, reason: 'no prior commit recorded' };
        }
        if (this._reveals.has(agentId)) {
            return { ok: false, reason: 'duplicate reveal' };
        }
        const expectedHash = buildCommitment({ judgment, confidence, nonce });
        const valid = expectedHash === committed.commitHash;
        this._reveals.set(agentId, {
            judgment,
            confidence: Number(confidence) || 0,
            nonce,
            reasonHash,
            valid,
            revealedAt: new Date().toISOString()
        });
        return { ok: true, valid };
    }

    // Advance to CLOSED phase; committed agents that did not reveal are marked silent.
    closeRevealPhase() {
        if (this.phase !== 'REVEAL') return;
        this.silentRevealers = [];
        for (const [agentId] of this._commits) {
            if (!this._reveals.has(agentId)) {
                this.silentRevealers.push(agentId);
            }
        }
        this.phase = 'CLOSED';
        this.revealClosedAt = new Date().toISOString();
    }

    // ── QUERIES ───────────────────────────────────────────────────────────────

    // Returns reveals whose hash matched the original commit.
    validReveals() {
        const result = [];
        for (const [agentId, reveal] of this._reveals) {
            if (reveal.valid) {
                result.push({ agentId, ...reveal });
            }
        }
        return result;
    }

    invalidRevealers() {
        const result = [];
        for (const [agentId, reveal] of this._reveals) {
            if (!reveal.valid) result.push(agentId);
        }
        return result;
    }

    // Audit summary stored in the negotiation history entry.
    summary() {
        return {
            taskId: this.taskId,
            round: this.round,
            phase: this.phase,
            totalExpected: this._agentIds.size,
            committedCount: this._commits.size,
            revealedCount: this._reveals.size,
            validRevealCount: this.validReveals().length,
            absentCommitters: this.absentCommitters.slice(),
            silentRevealers: this.silentRevealers.slice(),
            invalidRevealers: this.invalidRevealers(),
            createdAt: this.createdAt,
            commitClosedAt: this.commitClosedAt,
            revealClosedAt: this.revealClosedAt
        };
    }
}

module.exports = { CommitRevealSession };
