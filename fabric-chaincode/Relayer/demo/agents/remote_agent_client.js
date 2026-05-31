const http = require('node:http');
const https = require('node:https');
const crypto = require('crypto');

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_VERIFIER_CAPABILITIES = [
    'evidence_validation',
    'query_proof_check',
    'semantic_validation'
];

function trimTrailingSlash(value) {
    return String(value || '').replace(/\/+$/, '');
}

function parseTimeout(value, fallback = DEFAULT_TIMEOUT_MS) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function requestJson({ method = 'GET', url, body = null, timeoutMs = DEFAULT_TIMEOUT_MS, extraHeaders = {} } = {}) {
    return new Promise((resolve, reject) => {
        let parsed;
        try {
            parsed = new URL(url);
        } catch (error) {
            reject(new Error(`Invalid remote agent URL '${url}': ${error.message}`));
            return;
        }

        const payload = body === null ? null : JSON.stringify(body);
        const transport = parsed.protocol === 'https:' ? https : http;
        const headers = payload
            ? {
                'content-type': 'application/json',
                'content-length': Buffer.byteLength(payload),
                ...extraHeaders
            }
            : { ...extraHeaders };
        const request = transport.request({
            method,
            hostname: parsed.hostname,
            port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
            path: `${parsed.pathname}${parsed.search}`,
            headers
        }, (response) => {
            const chunks = [];
            response.on('data', (chunk) => chunks.push(chunk));
            response.on('end', () => {
                const text = Buffer.concat(chunks).toString('utf8');
                let data = null;
                try {
                    data = text ? JSON.parse(text) : null;
                } catch (error) {
                    reject(new Error(`Remote agent returned invalid JSON from ${url}: ${error.message}`));
                    return;
                }
                resolve({
                    statusCode: response.statusCode || 0,
                    data,
                    text
                });
            });
        });

        request.setTimeout(timeoutMs, () => {
            request.destroy(new Error(`Remote agent request timed out after ${timeoutMs}ms: ${url}`));
        });
        request.on('error', reject);
        if (payload) {
            request.write(payload);
        }
        request.end();
    });
}

class RemoteAgentClient {
    constructor({
        baseUrl,
        agentId = null,
        role = 'VERIFIER',
        capabilities = DEFAULT_VERIFIER_CAPABILITIES,
        organization = null,
        strategyType = null,
        llmBackend = null,
        focus = null,
        enabled = true,
        timeoutMs = DEFAULT_TIMEOUT_MS,
        sharedSecret = null,
        tlsConfig = null
    } = {}) {
        if (!baseUrl) {
            throw new Error('baseUrl is required for RemoteAgentClient');
        }
        this.baseUrl = trimTrailingSlash(baseUrl);
        this.agentId = agentId || `remote-${Buffer.from(this.baseUrl).toString('hex').slice(0, 12)}`;
        this.role = String(role || 'VERIFIER').toUpperCase();
        this.capabilities = Array.isArray(capabilities) && capabilities.length
            ? capabilities.slice()
            : DEFAULT_VERIFIER_CAPABILITIES.slice();
        this.organization = organization;
        this.strategyType = strategyType;
        this.llmBackend = llmBackend;
        this.focus = focus;
        this.enabled = enabled !== false;
        this.available = true;
        this.timeoutMs = parseTimeout(timeoutMs);
        this.remote = true;
        this.lastError = null;
        this.lastDescriptorAt = null;
        this.sharedSecret = sharedSecret || null;
        this.tlsConfig = tlsConfig || null;
    }

    _signBody(body) {
        if (!this.sharedSecret) {
            return {};
        }
        const timestamp = Math.floor(Date.now() / 1000);
        const payload = JSON.stringify(body);
        const msg = `${timestamp}:${payload}`;
        const sig = crypto.createHmac('sha256', this.sharedSecret).update(msg).digest('hex');
        return {
            'x-agent-timestamp': String(timestamp),
            'x-agent-signature': sig
        };
    }

    endpoint(path) {
        return `${this.baseUrl}${path}`;
    }

    applyDescriptor(descriptor = {}) {
        if (!descriptor || typeof descriptor !== 'object') {
            return;
        }
        this.agentId = descriptor.agentId || this.agentId;
        this.role = String(descriptor.role || this.role).toUpperCase();
        if (Array.isArray(descriptor.capabilities) && descriptor.capabilities.length) {
            this.capabilities = descriptor.capabilities.slice();
        }
        this.organization = descriptor.organization || this.organization;
        this.strategyType = descriptor.strategyType || this.strategyType;
        this.llmBackend = descriptor.llmBackend || this.llmBackend;
        this.focus = descriptor.focus || this.focus;
        this.strictProof = descriptor.strictProof === undefined ? this.strictProof : Boolean(descriptor.strictProof);
    }

    markUnavailable(error) {
        this.available = false;
        this.lastError = error?.message || String(error || 'remote agent unavailable');
    }

    getDescriptor() {
        return {
            agentId: this.agentId,
            role: this.role,
            capabilities: this.capabilities.slice(),
            organization: this.organization,
            strategyType: this.strategyType,
            llmBackend: this.llmBackend,
            focus: this.focus,
            strictProof: this.strictProof,
            enabled: this.enabled,
            kind: 'remote',
            remote: true,
            endpoint: this.baseUrl,
            available: this.available,
            lastDescriptorAt: this.lastDescriptorAt,
            lastError: this.lastError
        };
    }

    supports(_task) {
        return this.enabled && this.available;
    }

    async getJson(path) {
        const result = await requestJson({
            method: 'GET',
            url: this.endpoint(path),
            timeoutMs: this.timeoutMs
        });
        if (result.statusCode < 200 || result.statusCode >= 300) {
            throw new Error(`Remote agent GET ${path} failed with HTTP ${result.statusCode}`);
        }
        return result.data;
    }

    async postJson(path, body) {
        const extraHeaders = this._signBody(body);
        const result = await requestJson({
            method: 'POST',
            url: this.endpoint(path),
            body,
            timeoutMs: this.timeoutMs,
            extraHeaders
        });
        if (result.statusCode < 200 || result.statusCode >= 300) {
            const message = result.data?.error || `HTTP ${result.statusCode}`;
            throw new Error(`Remote agent POST ${path} failed: ${message}`);
        }
        return result.data;
    }

    async refreshDescriptor() {
        const data = await this.getJson('/descriptor');
        const descriptor = data?.descriptor || data;
        this.applyDescriptor(descriptor);
        this.available = true;
        this.lastError = null;
        this.lastDescriptorAt = new Date().toISOString();
        return this.getDescriptor();
    }

    async health() {
        return this.getJson('/health');
    }

    async execute(task, context = {}) {
        const data = await this.postJson('/execute', { task, context });
        if (!data?.success) {
            throw new Error(data?.error || 'Remote agent execution failed');
        }
        if (!data.result || typeof data.result !== 'object') {
            throw new Error('Remote agent execution response missing result object');
        }
        if (data.result.agentId) {
            this.agentId = data.result.agentId;
        }
        return {
            ...data.result,
            remote: true,
            remoteEndpoint: this.baseUrl
        };
    }
}

module.exports = {
    DEFAULT_TIMEOUT_MS,
    RemoteAgentClient,
    requestJson
};
