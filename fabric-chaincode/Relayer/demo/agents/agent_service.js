const express = require('express');
const crypto = require('crypto');
const { VerifierAgent } = require('./verifier_agent');

const AGENT_PROTOCOL_VERSION = 'agent-http-v1';
const DEFAULT_AGENT_PORT = 19111;
const DEFAULT_PAYLOAD_LIMIT = '2mb';

function parseBoolean(value, defaultValue = false) {
    if (value === undefined || value === null || value === '') {
        return defaultValue;
    }
    const normalized = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return defaultValue;
}

function parsePort(value, defaultValue = DEFAULT_AGENT_PORT) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isInteger(parsed) && parsed > 0 && parsed < 65536) {
        return parsed;
    }
    return defaultValue;
}

function normalizeRole(value) {
    return String(value || 'VERIFIER').trim().toUpperCase();
}

function loadSharedSecret(env = process.env) {
    const dirPath = env.AGENT_DIRECTORY_PATH;
    const agentId = env.AGENT_ID;
    if (dirPath && agentId) {
        try {
            const fs = require('fs');
            const path = require('path');
            const filePath = path.join(dirPath, `${agentId}.json`);
            if (fs.existsSync(filePath)) {
                const raw = fs.readFileSync(filePath, 'utf8');
                const config = JSON.parse(raw);
                if (config.sharedSecret) return config.sharedSecret;
            }
        } catch {
            // fallback to env
        }
    }
    return env.AGENT_SHARED_SECRET || null;
}

function verifyAgentAuth(req, res, next) {
    const env = process.env;
    const authDisabled = parseBoolean(env.AGENT_AUTH_DISABLED, false);
    if (authDisabled) {
        return next();
    }

    const sharedSecret = loadSharedSecret(env);
    if (!sharedSecret) {
        // 没有配置密钥时允许通过（兼容旧部署）
        return next();
    }

    const timestamp = req.headers['x-agent-timestamp'];
    const signature = req.headers['x-agent-signature'];

    if (!timestamp || !signature) {
        return res.status(401).json({
            success: false,
            error: 'Unauthorized: missing authentication headers'
        });
    }

    const now = Math.floor(Date.now() / 1000);
    const ts = Number(timestamp);
    if (!Number.isFinite(ts) || Math.abs(now - ts) > 300) {
        return res.status(401).json({
            success: false,
            error: 'Unauthorized: timestamp expired or invalid'
        });
    }

    const payload = JSON.stringify(req.body);
    const msg = `${timestamp}:${payload}`;
    const expected = crypto.createHmac('sha256', sharedSecret).update(msg).digest('hex');

    if (signature !== expected) {
        return res.status(401).json({
            success: false,
            error: 'Unauthorized: invalid signature'
        });
    }

    next();
}

function createVerifierAgentFromEnv(env = process.env) {
    const focus = String(env.AGENT_FOCUS || 'balanced').trim().toLowerCase();
    const useLLM = parseBoolean(env.AGENT_USE_LLM, false);
    return new VerifierAgent({
        agentId: env.AGENT_ID || 'verifier-standalone-01',
        focus,
        strictProof: parseBoolean(env.AGENT_STRICT_PROOF, focus === 'proof'),
        organization: env.AGENT_ORGANIZATION || null,
        strategyType: env.AGENT_STRATEGY_TYPE || null,
        llmBackend: env.AGENT_LLM_BACKEND || null,
        useLLM,
        // Adversarial behavior hook for Byzantine-robustness testing. Default 'honest'.
        // Allowed: honest | always_approve | always_reject | always_question | random | silent
        behavior: env.AGENT_BEHAVIOR || 'honest'
    });
}

function createAgentFromEnv(env = process.env) {
    const role = normalizeRole(env.AGENT_ROLE);
    if (role !== 'VERIFIER') {
        throw new Error(`Unsupported AGENT_ROLE '${role}'. This service currently supports VERIFIER only.`);
    }
    return createVerifierAgentFromEnv(env);
}

function buildServiceInfo(agent, serviceName, startedAt) {
    return {
        service: serviceName,
        protocolVersion: AGENT_PROTOCOL_VERSION,
        agentId: agent.agentId,
        role: agent.role,
        uptimeSec: Math.round((Date.now() - startedAt.getTime()) / 1000),
        ts: new Date().toISOString()
    };
}

function createAgentApp({
    agent,
    serviceName = 'crosschain-agent-service',
    payloadLimit = DEFAULT_PAYLOAD_LIMIT,
    startedAt = new Date()
} = {}) {
    if (!agent || typeof agent.execute !== 'function') {
        throw new Error('agent with execute(task, context) is required');
    }

    const app = express();
    app.use(express.json({ limit: payloadLimit }));

    app.get('/health', (_req, res) => {
        res.json({
            status: 'ok',
            ...buildServiceInfo(agent, serviceName, startedAt)
        });
    });

    app.get('/descriptor', (_req, res) => {
        res.json({
            success: true,
            ...buildServiceInfo(agent, serviceName, startedAt),
            descriptor: agent.getDescriptor ? agent.getDescriptor() : {
                agentId: agent.agentId,
                role: agent.role
            }
        });
    });

    app.post('/execute', verifyAgentAuth, async (req, res) => {
        try {
            const body = req.body || {};
            const task = body.task;
            const context = body.context && typeof body.context === 'object' ? body.context : {};

            if (!task || typeof task !== 'object' || Array.isArray(task)) {
                return res.status(400).json({
                    success: false,
                    error: 'task object is required'
                });
            }

            if (typeof agent.supports === 'function' && !agent.supports(task)) {
                return res.status(409).json({
                    success: false,
                    error: `Agent ${agent.agentId} does not support this task`
                });
            }

            const result = await agent.execute(task, context);
            return res.json({
                success: true,
                ...buildServiceInfo(agent, serviceName, startedAt),
                result
            });
        } catch (error) {
            return res.status(500).json({
                success: false,
                error: error.message || 'Agent execution failed'
            });
        }
    });

    app.use((error, _req, res, next) => {
        if (!error) return next();
        return res.status(400).json({
            success: false,
            error: error.message || 'Invalid request body'
        });
    });

    return app;
}

function startAgentService({
    env = process.env,
    agent = createAgentFromEnv(env),
    logger = console
} = {}) {
    const host = env.AGENT_HOST || '0.0.0.0';
    const port = parsePort(env.AGENT_PORT);
    const serviceName = env.AGENT_SERVICE_NAME || 'crosschain-agent-service';
    const app = createAgentApp({
        agent,
        serviceName,
        payloadLimit: env.AGENT_PAYLOAD_LIMIT || DEFAULT_PAYLOAD_LIMIT
    });

    const server = app.listen(port, host, () => {
        logger.log(JSON.stringify({
            event: 'agent-service-started',
            service: serviceName,
            protocolVersion: AGENT_PROTOCOL_VERSION,
            agent: agent.getDescriptor ? agent.getDescriptor() : { agentId: agent.agentId, role: agent.role },
            url: `http://${host}:${port}`,
            ts: new Date().toISOString()
        }));
    });

    return { app, server, agent, host, port };
}

if (require.main === module) {
    const runtime = startAgentService();

    const shutdown = (signal) => {
        runtime.server.close(() => {
            console.log(JSON.stringify({
                event: 'agent-service-stopped',
                signal,
                agentId: runtime.agent.agentId,
                ts: new Date().toISOString()
            }));
            process.exit(0);
        });
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
}

module.exports = {
    AGENT_PROTOCOL_VERSION,
    createAgentApp,
    createAgentFromEnv,
    createVerifierAgentFromEnv,
    parseBoolean,
    parsePort,
    startAgentService
};
