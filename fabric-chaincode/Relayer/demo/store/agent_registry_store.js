const fs = require('node:fs');
const path = require('node:path');

const AGENT_REGISTRY_SCHEMA_VERSION = 'agent-registry-json-v1';

function ensureDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
}

function defaultAgentRegistryPath() {
    return path.join(process.cwd(), '.demo', 'agents', 'agent-registry.json');
}

function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
}

function normalizeRole(value) {
    return String(value || '').trim().toUpperCase();
}

function normalizeAgentRecord(record = {}) {
    const agentId = record.agentId || record.id;
    if (!agentId) {
        return null;
    }

    const role = normalizeRole(record.role || 'VERIFIER');
    return {
        agentId,
        role,
        kind: record.kind || (record.remote || record.endpoint || record.baseUrl ? 'remote' : 'local'),
        remote: record.remote === undefined
            ? Boolean(record.kind === 'remote' || record.endpoint || record.baseUrl)
            : Boolean(record.remote),
        capabilities: Array.isArray(record.capabilities) ? record.capabilities.slice() : [],
        organization: record.organization || null,
        strategyType: record.strategyType || null,
        llmBackend: record.llmBackend || null,
        focus: record.focus || null,
        strictProof: record.strictProof === undefined ? undefined : Boolean(record.strictProof),
        endpoint: record.endpoint || record.baseUrl || record.url || null,
        timeoutMs: record.timeoutMs,
        enabled: record.enabled !== false,
        source: record.source || null,
        available: record.available === undefined ? undefined : Boolean(record.available),
        availabilityStatus: (() => {
            const s = record.availabilityStatus;
            // Normalize 'in_use' → 'available' on load (task may have been interrupted)
            if (s === 'unavailable') return 'unavailable';
            return 'available';
        })(),
        firstSeenAt: record.firstSeenAt || null,
        lastSeenAt: record.lastSeenAt || null,
        lastDescriptorAt: record.lastDescriptorAt || null,
        lastUpdatedAt: record.lastUpdatedAt || null,
        lastError: record.lastError || null,
        notes: record.notes || null
    };
}

function normalizeReputationMap(value = {}) {
    if (Array.isArray(value)) {
        return value.reduce((acc, item) => {
            if (item?.agentId) {
                acc[item.agentId] = { ...item };
            }
            return acc;
        }, {});
    }
    return Object.entries(value || {}).reduce((acc, [agentId, item]) => {
        if (agentId && item && typeof item === 'object') {
            acc[agentId] = {
                ...item,
                agentId: item.agentId || agentId
            };
        }
        return acc;
    }, {});
}

function createEmptyRegistry(now = new Date().toISOString()) {
    return {
        schemaVersion: AGENT_REGISTRY_SCHEMA_VERSION,
        generatedAt: now,
        updatedAt: now,
        agents: [],
        reputationByAgentId: {},
        recentRounds: []
    };
}

class AgentRegistryJsonStore {
    constructor({ filePath = null, maxRecentRounds = 50 } = {}) {
        this.filePath = filePath || process.env.DEMO_AGENT_REGISTRY_PATH || defaultAgentRegistryPath();
        this.maxRecentRounds = Math.max(0, Number(maxRecentRounds) || 50);
    }

    load() {
        if (!fs.existsSync(this.filePath)) {
            return createEmptyRegistry();
        }

        const text = fs.readFileSync(this.filePath, 'utf8');
        const parsed = text.trim() ? JSON.parse(text) : {};
        const now = new Date().toISOString();
        const agents = Array.isArray(parsed.agents)
            ? parsed.agents.map(normalizeAgentRecord).filter(Boolean)
            : [];

        return {
            ...createEmptyRegistry(now),
            ...parsed,
            schemaVersion: parsed.schemaVersion || AGENT_REGISTRY_SCHEMA_VERSION,
            generatedAt: parsed.generatedAt || now,
            updatedAt: parsed.updatedAt || now,
            agents,
            reputationByAgentId: normalizeReputationMap(parsed.reputationByAgentId),
            recentRounds: Array.isArray(parsed.recentRounds) ? parsed.recentRounds.slice(0, this.maxRecentRounds) : []
        };
    }

    save(registry) {
        const now = new Date().toISOString();
        const normalized = {
            ...createEmptyRegistry(now),
            ...registry,
            schemaVersion: registry?.schemaVersion || AGENT_REGISTRY_SCHEMA_VERSION,
            updatedAt: now,
            agents: Array.isArray(registry?.agents)
                ? registry.agents.map(normalizeAgentRecord).filter(Boolean)
                : [],
            reputationByAgentId: normalizeReputationMap(registry?.reputationByAgentId),
            recentRounds: Array.isArray(registry?.recentRounds)
                ? registry.recentRounds.slice(0, this.maxRecentRounds)
                : []
        };

        ensureDir(path.dirname(this.filePath));
        fs.writeFileSync(this.filePath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
        return cloneJson(normalized);
    }

    saveSnapshot({ agents = [], reputationByAgentId = {}, recentRound = null } = {}) {
        const current = this.load();
        const now = new Date().toISOString();
        const mergedAgents = new Map();

        for (const record of current.agents) {
            const normalized = normalizeAgentRecord(record);
            if (normalized) {
                mergedAgents.set(normalized.agentId, normalized);
            }
        }

        for (const record of agents) {
            const normalized = normalizeAgentRecord(record);
            if (!normalized) {
                continue;
            }
            const previous = mergedAgents.get(normalized.agentId) || {};
            mergedAgents.set(normalized.agentId, {
                ...previous,
                ...normalized,
                firstSeenAt: previous.firstSeenAt || previous.lastSeenAt || now,
                lastSeenAt: now,
                lastUpdatedAt: now
            });
        }

        const nextReputation = {
            ...normalizeReputationMap(current.reputationByAgentId),
            ...normalizeReputationMap(reputationByAgentId)
        };

        const recentRounds = Array.isArray(current.recentRounds) ? current.recentRounds.slice() : [];
        if (recentRound) {
            recentRounds.unshift({
                ...recentRound,
                recordedAt: recentRound.recordedAt || now
            });
        }

        return this.save({
            ...current,
            agents: Array.from(mergedAgents.values()),
            reputationByAgentId: nextReputation,
            recentRounds
        });
    }
}

module.exports = {
    AGENT_REGISTRY_SCHEMA_VERSION,
    AgentRegistryJsonStore,
    createEmptyRegistry,
    defaultAgentRegistryPath,
    normalizeAgentRecord,
    normalizeReputationMap
};
