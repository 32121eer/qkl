/**
 * LLM Client for Agent Semantic Verification
 * Supports multiple backends: OpenAI, Anthropic Claude, Ollama (local)
 *
 * Implements Prompt-level Confidence Probe (PCP) mechanism
 * Reference: Zheng et al., "Rethinking the Reliability of Multi-agent System"
 */

class LLMClient {
    constructor({
        backend = 'openai',
        apiKey = null,
        model = null,
        baseUrl = null,
        timeoutMs = 30000
    } = {}) {
        this.backend = backend;
        this.apiKey = apiKey;
        this.timeoutMs = timeoutMs;

        // Default models per backend
        this.model = model || this.getDefaultModel(backend);
        this.baseUrl = baseUrl || this.getDefaultBaseUrl(backend);
    }

    getDefaultModel(backend) {
        const models = {
            openai: 'gpt-4.1-mini',
            anthropic: 'claude-3-5-sonnet-20241022',
            ollama: 'llama3.1:8b',
            mock: 'mock'
        };
        return models[backend] || 'mock';
    }

    getDefaultBaseUrl(backend) {
        const urls = {
            openai: 'https://api.openai.com/v1',
            anthropic: 'https://api.anthropic.com/v1',
            ollama: 'http://localhost:11434',
            mock: null
        };
        return urls[backend] || null;
    }

    /**
     * Execute semantic verification via LLM
     *
     * @param {Object} task - The verification task
     * @param {Object} context - Verification context
     * @returns {Promise<Object>} { judgment, confidence, reasoning, tokensUsed }
     */
    async verify(task, context = {}) {
        if (this.backend === 'mock') {
            return this.mockVerify(task, context);
        }

        const prompt = this.buildVerificationPrompt(task, context);

        try {
            const response = await this.callLLM(prompt);
            return this.parseResponse(response);
        } catch (error) {
            return {
                judgment: 'QUESTION',
                confidence: 0.5,
                reasoning: `LLM call failed: ${error.message}`,
                tokensUsed: 0,
                error: error.message
            };
        }
    }

    /**
     * Build verification prompt for cross-chain query validation
     */
    buildVerificationPrompt(task, context) {
        const evidence = task?.evidenceBundle || {};
        const query = task?.query || {};

        return `You are a cross-chain verification agent evaluating the validity of a blockchain query result.

TASK DETAILS:
- Query ID: ${task?.queryId || 'unknown'}
- Source Chain: ${task?.sourceChain || 'unknown'}
- Target Chain: ${task?.targetChain || 'unknown'}
- Risk Level: ${task?.risk || 'NORMAL'}

EVIDENCE SUMMARY:
- Block Height: ${evidence.blockHeight || evidence.block?.number || 'unknown'}
- Transaction Hash: ${evidence.txHash || evidence.transactionHash || 'unknown'}
- Query Type: ${query.type || 'unknown'}
- Expected Result: ${JSON.stringify(query.expected || {})}
- Actual Result: ${JSON.stringify(evidence.payload || evidence.result || {})}

VERIFICATION CHECKS:
1. Does the evidence contain all expected fields?
2. Is the block height within the expected range?
3. Does the transaction hash match the query context?
4. Are there any anomalies in the data structure?
5. Is the result consistent with the query intent?

INSTRUCTIONS:
Provide your verification judgment in the following JSON format:
{
  "judgment": "ACCEPT" | "REJECT" | "QUESTION",
  "confidence": <number between 0 and 1>,
  "reasoning": "<detailed explanation of your decision>"
}

Guidelines:
- ACCEPT: Evidence is complete, consistent, and trustworthy
- REJECT: Evidence contains clear anomalies or contradictions
- QUESTION: Uncertain, need more information or manual review

Confidence should reflect your certainty (0.0 = completely uncertain, 1.0 = absolutely certain).

Respond ONLY with the JSON object, no additional text.`;
    }

    /**
     * Call LLM API based on backend type
     */
    async callLLM(prompt) {
        switch (this.backend) {
            case 'openai':
                return await this.callOpenAI(prompt);
            case 'anthropic':
                return await this.callAnthropic(prompt);
            case 'ollama':
                return await this.callOllama(prompt);
            default:
                throw new Error(`Unknown LLM backend: ${this.backend}`);
        }
    }

    async callOpenAI(prompt) {
        const response = await fetch(`${this.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`
            },
            body: JSON.stringify({
                model: this.model,
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.3,
                max_tokens: 1000
            })
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`OpenAI API error: ${error}`);
        }

        const data = await response.json();
        return {
            content: data.choices[0]?.message?.content || '{}',
            tokensUsed: data.usage?.total_tokens || 0
        };
    }

    async callAnthropic(prompt) {
        const response = await fetch(`${this.baseUrl}/messages`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': this.apiKey,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: this.model,
                max_tokens: 1000,
                temperature: 0.3,
                messages: [{ role: 'user', content: prompt }]
            })
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`Anthropic API error: ${error}`);
        }

        const data = await response.json();
        return {
            content: data.content?.[0]?.text || '{}',
            tokensUsed: data.usage?.input_tokens + data.usage?.output_tokens || 0
        };
    }

    async callOllama(prompt) {
        const response = await fetch(`${this.baseUrl}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: this.model,
                prompt: prompt,
                stream: false,
                format: 'json',
                options: { temperature: 0.3 }
            })
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`Ollama API error: ${error}`);
        }

        const data = await response.json();
        return {
            content: data.response || '{}',
            tokensUsed: data.eval_count || 0
        };
    }

    /**
     * Parse LLM response to extract judgment, confidence, reasoning
     */
    parseResponse(response) {
        try {
            let content = response.content.trim();

            // Remove markdown code block markers (```json ... ```)
            content = content.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim();
            content = content.replace(/^```\s*/i, '').replace(/\s*```$/, '').trim();

            const result = JSON.parse(content);

            // Validate and normalize
            const judgment = ['ACCEPT', 'REJECT', 'QUESTION'].includes(result.judgment)
                ? result.judgment
                : 'QUESTION';

            const confidence = Math.max(0, Math.min(1, parseFloat(result.confidence) || 0.5));

            return {
                judgment,
                confidence,
                reasoning: result.reasoning || 'No reasoning provided',
                tokensUsed: response.tokensUsed || 0
            };
        } catch (error) {
            return {
                judgment: 'QUESTION',
                confidence: 0.5,
                reasoning: `Failed to parse LLM response: ${error.message}. Raw: ${response.content?.substring(0, 200)}`,
                tokensUsed: response.tokensUsed || 0,
                error: error.message
            };
        }
    }

    /**
     * Mock verification for testing without API keys
     */
    mockVerify(task, context) {
        const evidence = task?.evidenceBundle || {};
        const preVerifPass = evidence.preVerification?.status === 'PASS'
            || context?.session?.queryVerifyStatus === 'PASS';
        const preVerifFail = evidence.preVerification?.status === 'FAIL'
            || context?.session?.queryVerifyStatus === 'FAIL'
            || context?.session?.queryVerifyStatus === 'FAILED';

        // Explicit REJECT on cryptographic pre-verification failure — this is what a
        // real semantic LLM would do, and the rule-based agents already enforce it.
        if (preVerifFail) {
            return {
                judgment: 'REJECT',
                confidence: 0.85,
                reasoning: 'Mock: cryptographic pre-verification failed',
                tokensUsed: 0,
                mock: true
            };
        }

        // Otherwise score completeness against the field aliases the cross-chain
        // pipeline actually produces (sourceTxHash, sourceHeader.number, etc.) AND
        // the LLM-prompt-style aliases (txHash, blockHeight). Including sourceHeader
        // keeps mock honest about missing-header evidence in round 1.
        const checks = {
            hasPayload: Boolean(evidence.payload || evidence.result || evidence.payload?.result),
            hasBlockHeight: Boolean(
                evidence.blockHeight
                || evidence.block?.number
                || evidence.sourceHeader?.number
                || evidence.request?.blockHeight
            ),
            hasTxHash: Boolean(
                evidence.txHash
                || evidence.transactionHash
                || evidence.sourceTxHash
                || evidence.request?.txHash
            ),
            hasPreVerifPass: preVerifPass,
            hasSourceHeader: Boolean(evidence.sourceHeader || evidence.sourceHeaderHash)
        };

        const passedChecks = Object.values(checks).filter(Boolean).length;
        const totalChecks = Object.keys(checks).length;
        const ratio = passedChecks / totalChecks;

        let judgment, confidence;
        if (ratio >= 0.8) {
            judgment = 'ACCEPT';
            confidence = 0.75 + Math.random() * 0.15;
        } else if (ratio >= 0.5) {
            judgment = 'QUESTION';
            confidence = 0.55 + Math.random() * 0.15;
        } else {
            judgment = 'REJECT';
            confidence = 0.6 + Math.random() * 0.2;
        }

        return {
            judgment,
            confidence: Math.round(confidence * 100) / 100,
            reasoning: `Mock verification: ${passedChecks}/${totalChecks} checks passed. ` +
                      `Has payload: ${checks.hasPayload}, ` +
                      `Has block: ${checks.hasBlockHeight}, ` +
                      `Has tx: ${checks.hasTxHash}`,
            tokensUsed: 0,
            mock: true
        };
    }
}

/**
 * Factory function to create LLM client from environment variables
 */
function createLLMClientFromEnv(env = process.env) {
    const backend = env.AGENT_LLM_BACKEND || 'mock';
    const apiKey = env.OPENAI_API_KEY || env.ANTHROPIC_API_KEY || null;
    const model = env.AGENT_LLM_MODEL || null;
    const baseUrl = env.AGENT_LLM_BASE_URL || null;
    const timeoutMs = parseInt(env.AGENT_LLM_TIMEOUT_MS || '30000', 10);

    return new LLMClient({
        backend,
        apiKey,
        model,
        baseUrl,
        timeoutMs
    });
}

module.exports = {
    LLMClient,
    createLLMClientFromEnv
};
