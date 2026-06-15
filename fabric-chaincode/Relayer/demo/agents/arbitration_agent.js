const { BaseAgent } = require('./base_agent');

/**
 * ArbitrationAgent (论文 §IV-F)
 *
 * An individual arbitrator that receives full context:
 *   fullContext.evidence          — complete evidenceBundle
 *   fullContext.verifierOpinions  — all Phase-3 sealed verifier verdicts
 *   fullContext.reasonHashes      — privacy-preserving hashes of verifier reasoning
 *   fullContext.conflictEvidence  — disagreement records that triggered arbitration
 *
 * Backward-compatible: also accepts the legacy { opinions, disagreements } shape
 * used by the single-agent arbitration path.
 */
class ArbitrationAgent extends BaseAgent {
    constructor({ agentId, organization = null, strategyType = 'A_PROOF_VALIDATOR' } = {}) {
        super({
            agentId,
            role: 'ARBITRATION',
            capabilities: ['tie_breaking', 'dispute_resolution', 'proof_validation', 'policy_check', 'semantic_reasoning'],
            organization,
            strategyType
        });
    }

    async execute(task, context = {}) {
        // Support both fullContext (new) and legacy (opinions/disagreements) shapes
        const verifierOpinions = Array.isArray(context.verifierOpinions)
            ? context.verifierOpinions
            : (Array.isArray(context.opinions) ? context.opinions : []);
        const disagreements = Array.isArray(context.disagreements)
            ? context.disagreements
            : (Array.isArray(context.conflictEvidence) ? context.conflictEvidence : []);
        const evidence = context.evidence || task?.evidenceBundle || {};
        const reasonHashes = Array.isArray(context.reasonHashes) ? context.reasonHashes : [];

        // ── Compute weighted vote tallies from verifier opinions ──────────────
        let approveWeight = 0;
        let rejectWeight = 0;
        let questionWeight = 0;
        for (const op of verifierOpinions) {
            const w = (Number(op.assignedWeight) || 0) * (Number(op.confidence) || 0);
            const decision = String(op.decision || op.judgment || '').toUpperCase();
            if (decision === 'APPROVE' || decision === 'ACCEPT') approveWeight += w;
            else if (decision === 'REJECT') rejectWeight += w;
            else questionWeight += w;
        }

        const highSeverity = disagreements.filter((d) => d.severity === 'HIGH');
        const collectorMismatch = evidence?.collectorComparison?.status === 'MISMATCH';
        const preVerifyFailed = evidence?.preVerification?.status && evidence.preVerification.status !== 'PASS';
        const hasReasonEvidence = reasonHashes.length > 0;

        // ── Decision logic ────────────────────────────────────────────────────
        const reasons = [];
        let finalDecision = 'OBSERVE';

        if (highSeverity.length > 0 || collectorMismatch || preVerifyFailed) {
            finalDecision = 'REJECT';
            if (highSeverity.length > 0) reasons.push(`${highSeverity.length} HIGH-severity disagreement(s)`);
            if (collectorMismatch) reasons.push('dual-collector evidence mismatch');
            if (preVerifyFailed) reasons.push(`cryptographic pre-check ${evidence.preVerification.status}`);
        } else if (rejectWeight > 0.2) {
            finalDecision = 'REJECT';
            reasons.push(`verifier reject weight ${rejectWeight.toFixed(4)} exceeds 0.2 threshold`);
            if (disagreements.length > 0) reasons.push(`${disagreements.length} active disagreement(s)`);
        } else if (rejectWeight === 0 && approveWeight > 0) {
            finalDecision = 'COMMIT';
            reasons.push('no verifier rejection; arbitrator accepts proof-valid majority');
            if (hasReasonEvidence) reasons.push(`${reasonHashes.length} verifier reason hash(es) consistent`);
        } else {
            reasons.push('insufficient evidence for definitive arbitration decision');
        }

        return this.createEnvelope(task, {
            round: Number(context.round || context.currentRound || 1),
            status: 'ARBITRATED',
            finalDecision,
            decision: finalDecision === 'COMMIT' ? 'APPROVE' : finalDecision === 'REJECT' ? 'REJECT' : 'QUESTION',
            confidence: finalDecision === 'OBSERVE' ? 0.3 : finalDecision === 'COMMIT' ? 0.8 : 0.85,
            reasons,
            contextSummary: {
                verifierCount: verifierOpinions.length,
                disagreementCount: disagreements.length,
                highSeverityCount: highSeverity.length,
                reasonHashCount: reasonHashes.length,
                collectorMismatch,
                preVerifyFailed
            },
            approveWeight: Number(approveWeight.toFixed(6)),
            rejectWeight: Number(rejectWeight.toFixed(6)),
            questionWeight: Number(questionWeight.toFixed(6))
        });
    }
}

module.exports = { ArbitrationAgent };
