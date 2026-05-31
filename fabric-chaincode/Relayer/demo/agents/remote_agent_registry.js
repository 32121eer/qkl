const { RemoteAgentClient } = require('./remote_agent_client');

/**
 * Known Agent metadata keyed by agentId.
 *
 * Used as a fallback when the off-chain directory config does not carry
 * organization / strategyType / focus.  Keep in sync with the services
 * defined in docker-compose.agents.yml.
 */
const DEFAULT_AGENT_META = Object.freeze(Object.assign(Object.create(null), {
    'verifier-proof-01': { organization: 'org-b', strategyType: 'A_PROOF_VALIDATOR', focus: 'proof' },
    'verifier-proof-02': { organization: 'org-d', strategyType: 'A_PROOF_VALIDATOR', focus: 'proof' },
    'verifier-policy-01': { organization: 'org-c', strategyType: 'B_POLICY_CHECKER', focus: 'balanced' },
    'verifier-semantic-01': { organization: 'org-f', strategyType: 'C_SEMANTIC_REASONER', focus: 'semantic' },
    'verifier-semantic-02': { organization: 'org-g', strategyType: 'C_SEMANTIC_REASONER', focus: 'semantic' }
}));

function splitCsv(value) {
    return String(value || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
}

function parseJsonSpecs(value) {
    if (!value) {
        return [];
    }
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
        return parsed;
    }
    if (Array.isArray(parsed.agents)) {
        return parsed.agents;
    }
    return [parsed];
}

function normalizeRemoteAgentSpec(spec, index = 0) {
    const baseUrl = spec.baseUrl || spec.url || spec.endpoint;
    if (!baseUrl) {
        throw new Error(`Remote agent spec at index ${index} is missing baseUrl/url/endpoint`);
    }
    return {
        baseUrl,
        agentId: spec.agentId || spec.id || `remote-verifier-${String(index + 1).padStart(2, '0')}`,
        role: spec.role || 'VERIFIER',
        capabilities: spec.capabilities,
        organization: spec.organization || null,
        strategyType: spec.strategyType || null,
        llmBackend: spec.llmBackend || null,
        focus: spec.focus || null,
        enabled: spec.enabled !== false,
        timeoutMs: spec.timeoutMs,
        sharedSecret: spec.sharedSecret || null,
        tlsConfig: spec.tlsConfig || null
    };
}

function readRemoteAgentSpecs(env = process.env) {
    const specs = [];
    const jsonValue = env.DEMO_REMOTE_AGENTS_JSON || env.REMOTE_AGENTS_JSON;
    if (jsonValue) {
        specs.push(...parseJsonSpecs(jsonValue));
    }

    const verifierUrls = splitCsv(
        env.DEMO_REMOTE_VERIFIER_URLS
        || env.DEMO_REMOTE_AGENT_URLS
        || env.REMOTE_VERIFIER_URLS
    );
    verifierUrls.forEach((baseUrl, index) => {
        specs.push({
            baseUrl,
            agentId: `remote-verifier-${String(index + 1).padStart(2, '0')}`,
            role: 'VERIFIER',
            organization: `remote-org-${index + 1}`,
            strategyType: 'B_POLICY_CHECKER',
            focus: 'balanced'
        });
    });

    return specs.map((item, index) => normalizeRemoteAgentSpec(item, index));
}

function createRemoteAgents(specs = []) {
    return specs.map((spec, index) => new RemoteAgentClient(normalizeRemoteAgentSpec(spec, index)));
}

/**
 * Build remote-agent specs from the off-chain directory (`.demo/agents/directory/`).
 *
 * Each directory entry is a JSON file named `<agentId>.json` that carries at least
 * `endpoint` and `sharedSecret`.  Optional fields `organization` and `strategyType`
 * take precedence over the built-in DEFAULT_AGENT_META.
 *
 * When the directory is empty or unreadable this returns `[]` so callers can safely
 * fall back to local-only mode.
 *
 * @param {object} [options]
 * @param {string} [options.dirPath]   Override AGENT_DIRECTORY_PATH.
 * @param {number} [options.timeoutMs] Per-agent HTTP timeout (default 30 000).
 * @returns {Array<object>}  Normalised specs suitable for AgentRuntime or createRemoteAgents.
 */
function buildRemoteAgentSpecsFromDirectory(options = {}) {
    let AgentDirectory;
    let path;
    try {
        const mod = require('./agent_directory');
        AgentDirectory = mod.AgentDirectory;
        path = require('path');
    } catch (_err) {
        return [];
    }

    // Default to repo-root .demo/agents/directory (same as demo-negotiation-containers.js
    // and docker-compose.agents.yml volume mount), not AgentDirectory's own default
    // which resolves inside Relayer/.demo/.
    const defaultDirPath = path.resolve(__dirname, '../../../../.demo/agents/directory');
    const dirPath = options.dirPath || process.env.AGENT_DIRECTORY_PATH || defaultDirPath;
    const directory = new AgentDirectory({ dirPath });
    let ids;
    try {
        ids = directory.list();
    } catch (_err) {
        return [];
    }
    if (!ids.length) {
        return [];
    }

    const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
        ? options.timeoutMs
        : (Number(process.env.AGENT_DEMO_TIMEOUT_MS) || 30000);

    return ids.map((agentId) => {
        let cfg;
        try {
            cfg = directory.load(agentId);
        } catch (_err) {
            return null;
        }
        if (!cfg || !cfg.endpoint) {
            return null;
        }
        const meta = DEFAULT_AGENT_META[agentId] || {};
        return normalizeRemoteAgentSpec({
            baseUrl: cfg.endpoint,
            agentId,
            role: 'VERIFIER',
            organization: cfg.organization || meta.organization || null,
            strategyType: cfg.strategyType || meta.strategyType || null,
            focus: meta.focus || null,
            sharedSecret: cfg.sharedSecret || null,
            timeoutMs,
            enabled: true
        });
    }).filter(Boolean);
}

module.exports = {
    buildRemoteAgentSpecsFromDirectory,
    createRemoteAgents,
    normalizeRemoteAgentSpec,
    readRemoteAgentSpecs
};
