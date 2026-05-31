const { BaseAgent } = require('./base_agent');
const { createLLMClientFromEnv } = require('./llm_client');

class VerifierAgent extends BaseAgent {
    constructor({
        agentId,
        focus = 'balanced',
        strictProof = false,
        organization = null,
        strategyType = null,
        llmBackend = null,
        useLLM = false,
        behavior = 'honest'
    }) {
        super({
            agentId,
            role: 'VERIFIER',
            capabilities: ['evidence_validation', 'query_proof_check', 'semantic_validation'],
            organization,
            strategyType: strategyType || (
                focus === 'proof' || focus === 'structural'
                    ? 'A_PROOF_VALIDATOR'
                    : focus === 'semantic'
                        ? 'C_SEMANTIC_REASONER'
                        : 'B_POLICY_CHECKER'
            ),
            llmBackend
        });
        this.focus = focus;
        this.strictProof = strictProof;
        this.useLLM = useLLM || Boolean(llmBackend);
        this.llmClient = null;
        // Adversarial behavior for Byzantine-robustness testing. 'honest' = normal.
        this.behavior = VerifierAgent.normalizeBehavior(behavior);
    }

    static normalizeBehavior(value) {
        const allowed = ['honest', 'always_approve', 'always_reject', 'always_question', 'random', 'silent'];
        const normalized = String(value || 'honest').trim().toLowerCase();
        return allowed.includes(normalized) ? normalized : 'honest';
    }

    initLLMClient(env = process.env) {
        if (this.useLLM && !this.llmClient) {
            this.llmClient = createLLMClientFromEnv(env);
        }
    }

    getDescriptor() {
        return {
            ...super.getDescriptor(),
            focus: this.focus,
            strictProof: this.strictProof,
            behavior: this.behavior
        };
    }

    evaluateChecks(task, context = {}) {
        const evidence = task?.evidenceBundle || {};
        const session = context.session || {};
        const proofStatus = String(session.queryVerifyStatus || '').toUpperCase();
        const round = Number(context.round || context.currentRound || 1);
        const submitterPlan = context.submitterPlan || null;
        const collectorAttestations = Array.isArray(evidence.collectorAttestations)
            ? evidence.collectorAttestations
            : [];
        const collectorOrganizations = new Set(collectorAttestations.map((item) => item.organization).filter(Boolean));
        const collectorHashes = new Set(collectorAttestations.map((item) => item.evidenceHash).filter(Boolean));
        const cryptographicPrecheck = evidence.preVerification || null;
        const resultPayload = evidence.payload?.result || evidence.payload?.record || session.resultPayload || null;

        const checks = {
            requestObserved: Boolean(evidence.request?.txHash || evidence.sourceTxHash),
            payloadPresent: Boolean(evidence.payload),
            targetChainPresent: Boolean(task?.targetChain),
            collectorQuorum: collectorAttestations.length >= 2 && collectorOrganizations.size >= 2 && collectorHashes.size === 1,
            cryptographicPrecheckPassed: cryptographicPrecheck
                ? cryptographicPrecheck.status === 'PASS'
                : proofStatus === 'PASS',
            sourceHeaderPresent: Boolean(evidence.sourceHeader || evidence.sourceHeaderHash),
            queryProofPresent: Boolean(evidence.queryProof || evidence.proofBundle),
            queryProofValid: proofStatus === 'PASS',
            queryObjectPresent: Boolean(evidence.queryObject || evidence.queryProof?.queryObject || evidence.proofBundle?.queryObject),
            semanticPayloadConsistent: this.focus === 'semantic'
                ? Boolean(resultPayload || evidence.payload?.found === false)
                : true,
            submissionPlanReady: round > 1
                ? Boolean(submitterPlan?.planId || submitterPlan?.recommendedRoute || submitterPlan?.readyForSubmission)
                : false
        };

        return checks;
    }

    buildReasons(checks, context = {}) {
        const round = Number(context.round || context.currentRound || 1);
        const reasons = [];
        if (checks.requestObserved) reasons.push('request evidence observed');
        if (checks.payloadPresent) reasons.push('payload bundle available');
        if (checks.targetChainPresent) reasons.push('target chain resolved');
        if (checks.collectorQuorum) reasons.push('two independent collectors agree on evidence hash');
        if (checks.cryptographicPrecheckPassed) reasons.push('cryptographic pre-verification passed');
        if (!checks.cryptographicPrecheckPassed) reasons.push('cryptographic pre-verification failed');
        if (checks.sourceHeaderPresent) reasons.push('source header evidence available');
        if (checks.queryProofPresent && checks.queryProofValid) reasons.push('query proof verified');
        if (checks.queryProofPresent && !checks.queryProofValid) reasons.push('query proof verification failed');
        if (checks.queryObjectPresent) reasons.push('query object available for replay checks');
        if (this.focus === 'semantic' && checks.semanticPayloadConsistent) reasons.push('semantic payload is consistent with orchard query context');
        if (this.focus === 'semantic' && !checks.semanticPayloadConsistent) reasons.push('semantic payload is missing or inconsistent');
        if (!checks.queryProofPresent) reasons.push('query proof not ready yet');
        if (this.focus === 'balanced' && round === 1 && !checks.submissionPlanReady) reasons.push('submission plan confirmation requested');
        if (this.focus === 'balanced' && round > 1 && checks.submissionPlanReady) reasons.push('submission plan confirmed');
        return reasons;
    }

    decide(checks, context = {}) {
        const round = Number(context.round || context.currentRound || 1);
        if (!checks.requestObserved || !checks.payloadPresent || !checks.targetChainPresent || !checks.collectorQuorum) {
            return 'QUESTION';
        }

        if (!checks.cryptographicPrecheckPassed || (checks.queryProofPresent && !checks.queryProofValid)) {
            return 'REJECT';
        }

        if (this.strictProof && !checks.queryProofValid) {
            return 'QUESTION';
        }

        if (this.focus === 'structural' && !checks.sourceHeaderPresent) {
            return 'QUESTION';
        }

        if (this.focus === 'balanced' && round === 1 && !checks.submissionPlanReady) {
            return 'QUESTION';
        }

        if (this.focus === 'semantic' && !checks.semanticPayloadConsistent) {
            return 'REJECT';
        }

        return 'APPROVE';
    }

    calculateConfidence(checks, decision) {
        const values = Object.values(checks);
        const passed = values.filter(Boolean).length;
        const ratio = values.length ? passed / values.length : 0;

        if (decision === 'REJECT') {
            return Number(Math.max(0.55, ratio).toFixed(2));
        }
        if (decision === 'QUESTION') {
            return Number(Math.max(0.5, ratio * 0.9).toFixed(2));
        }
        return Number(Math.max(0.7, ratio).toFixed(2));
    }

    /**
     * Adversarial behavior override (Byzantine-robustness testing). Returns an
     * envelope with the forced decision, or throws for 'silent' to simulate a
     * non-responding agent. Skipped when behavior === 'honest'.
     */
    applyBehavior(task, context, checks, round) {
        if (this.behavior === 'silent') {
            const err = new Error(`Agent ${this.agentId} is silent (withheld response)`);
            err.code = 'AGENT_SILENT';
            throw err;
        }
        let decision;
        if (this.behavior === 'always_approve') {
            decision = 'APPROVE';
        } else if (this.behavior === 'always_reject') {
            decision = 'REJECT';
        } else if (this.behavior === 'always_question') {
            decision = 'QUESTION';
        } else if (this.behavior === 'random') {
            const options = ['APPROVE', 'REJECT', 'QUESTION'];
            decision = options[Math.floor(Math.random() * options.length)];
        } else {
            decision = 'QUESTION';
        }
        const confidence = decision === 'QUESTION' ? 0.6 : 0.9;
        return this.createEnvelope(task, {
            round,
            decision,
            confidence,
            assignedWeight: Number(context.assignedWeight || 0),
            focus: this.focus,
            checks,
            reasons: [`adversarial behavior: ${this.behavior}`],
            behavior: this.behavior,
            adversarial: true
        });
    }

    async execute(task, context = {}) {
        const checks = this.evaluateChecks(task, context);
        const round = Number(context.round || context.currentRound || 1);

        // Short-circuit for adversarial behavior so a malicious agent never even
        // touches the LLM / honest decision pipeline.
        if (this.behavior !== 'honest') {
            return this.applyBehavior(task, context, checks, round);
        }

        // Initialize LLM client if needed
        this.initLLMClient();

        // For semantic and balanced verifiers with LLM enabled, call LLM for judgment
        let decision, confidence, reasons, llmResult = null;

        if (this.useLLM && this.llmClient &&
            (this.focus === 'semantic' || this.focus === 'balanced' || this.strategyType === 'C_SEMANTIC_REASONER')) {
            try {
                llmResult = await this.llmClient.verify(task, {
                    ...context,
                    agentId: this.agentId,
                    focus: this.focus,
                    strategyType: this.strategyType
                });

                // Convert LLM judgment to our decision format
                decision = this.convertLLMJudgment(llmResult.judgment);
                confidence = llmResult.confidence;

                // Build reasons combining rule-based and LLM reasoning
                const ruleReasons = this.buildReasons(checks, context);
                reasons = [...ruleReasons];
                if (llmResult.reasoning) {
                    reasons.push(`LLM: ${llmResult.reasoning.substring(0, 200)}${llmResult.reasoning.length > 200 ? '...' : ''}`);
                }
                if (llmResult.mock) {
                    reasons.push('(LLM mock mode)');
                }
            } catch (error) {
                // Fall back to rule-based if LLM fails
                decision = this.decide(checks, context);
                confidence = this.calculateConfidence(checks, decision);
                reasons = this.buildReasons(checks, context);
                reasons.push(`LLM error: ${error.message}`);
            }
        } else {
            // Rule-based verification (A_PROOF_VALIDATOR or LLM disabled)
            decision = this.decide(checks, context);
            confidence = this.calculateConfidence(checks, decision);
            reasons = this.buildReasons(checks, context);
        }

        const envelope = this.createEnvelope(task, {
            round,
            decision,
            confidence,
            assignedWeight: Number(context.assignedWeight || 0),
            focus: this.focus,
            checks,
            reasons
        });

        // Add LLM metadata if present
        if (llmResult) {
            envelope.llmMetadata = {
                backend: this.llmClient?.backend || 'unknown',
                tokensUsed: llmResult.tokensUsed,
                mock: llmResult.mock || false
            };
        }

        return envelope;
    }

    convertLLMJudgment(llmJudgment) {
        const mapping = {
            'ACCEPT': 'APPROVE',
            'REJECT': 'REJECT',
            'QUESTION': 'QUESTION'
        };
        return mapping[llmJudgment] || 'QUESTION';
    }
}

module.exports = { VerifierAgent };
