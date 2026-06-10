// Multi-agent HTTP service: hosts N verifier agents in a single Node process,
// each mounted under its own sub-path (e.g. /a1, /a2). Designed for AutoDL
// instances where only 6006 and 6008 are publicly mapped — running two
// processes (one per port) gives 2 × N agents on one VM.
//
// Configuration via env var:
//   AGENT_PORT         port to listen on (default 6006)
//   AGENT_HOST         bind address (default 0.0.0.0)
//   AGENT_BUNDLE_JSON  JSON array of agent specs:
//     [
//       {
//         "mountPath":     "/a1",                       (required, must start with '/')
//         "agentId":       "verifier-cloud-a1",         (required)
//         "organization":  "org-cloud-a-1",
//         "strategyType":  "A_PROOF_VALIDATOR",
//         "focus":         "proof",                     ("proof"|"balanced"|"semantic"|"structural")
//         "strictProof":   false,
//         "behavior":      "honest",
//         "sharedSecret":  "..."                        (per-agent HMAC secret)
//       },
//       ...
//     ]
//
// Each agent is reachable as:
//   GET  http://<host>:<port><mountPath>/health
//   GET  http://<host>:<port><mountPath>/descriptor
//   POST http://<host>:<port><mountPath>/execute   (HMAC-signed body)
//
// The relayer configures each agent's RemoteAgentClient with
//   baseUrl: "https://<public-url-of-this-port><mountPath>"

const express = require('express');
const crypto = require('crypto');
const { VerifierAgent } = require('./verifier_agent');

const AGENT_PROTOCOL_VERSION = 'agent-http-v1';
const DEFAULT_PORT = 6006;
const DEFAULT_HOST = '0.0.0.0';
const DEFAULT_PAYLOAD_LIMIT = '2mb';

function parseBoolean(value, defaultValue = false) {
    if (value === undefined || value === null || value === '') return defaultValue;
    const v = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(v)) return true;
    if (['0', 'false', 'no', 'off'].includes(v)) return false;
    return defaultValue;
}

function parsePort(value, defaultValue = DEFAULT_PORT) {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) && parsed > 0 && parsed < 65536 ? parsed : defaultValue;
}

function buildVerifier(spec) {
    return new VerifierAgent({
        agentId:       spec.agentId,
        focus:         String(spec.focus || 'balanced').trim().toLowerCase(),
        strictProof:   parseBoolean(spec.strictProof, spec.focus === 'proof'),
        organization:  spec.organization || null,
        strategyType:  spec.strategyType || null,
        llmBackend:    spec.llmBackend || null,
        useLLM:        parseBoolean(spec.useLLM, false),
        behavior:      spec.behavior || 'honest'
    });
}

function makeAuthMiddleware(sharedSecret, { authDisabled = false } = {}) {
    return (req, res, next) => {
        if (authDisabled || !sharedSecret) return next();
        const timestamp = req.headers['x-agent-timestamp'];
        const signature = req.headers['x-agent-signature'];
        if (!timestamp || !signature) {
            return res.status(401).json({ success: false, error: 'Unauthorized: missing authentication headers' });
        }
        const now = Math.floor(Date.now() / 1000);
        const ts = Number(timestamp);
        if (!Number.isFinite(ts) || Math.abs(now - ts) > 300) {
            return res.status(401).json({ success: false, error: 'Unauthorized: timestamp expired or invalid' });
        }
        const payload = JSON.stringify(req.body);
        const msg = `${timestamp}:${payload}`;
        const expected = crypto.createHmac('sha256', sharedSecret).update(msg).digest('hex');
        if (signature !== expected) {
            return res.status(401).json({ success: false, error: 'Unauthorized: invalid signature' });
        }
        next();
    };
}

function buildAgentInfo(agent, serviceName, startedAt) {
    return {
        service: serviceName,
        protocolVersion: AGENT_PROTOCOL_VERSION,
        agentId: agent.agentId,
        role: agent.role,
        uptimeSec: Math.round((Date.now() - startedAt.getTime()) / 1000),
        ts: new Date().toISOString()
    };
}

function createAgentSubApp({ agent, sharedSecret, serviceName, startedAt, payloadLimit, authDisabled }) {
    const sub = express();
    sub.use(express.json({ limit: payloadLimit }));

    sub.get('/health', (_req, res) => {
        res.json({ status: 'ok', ...buildAgentInfo(agent, serviceName, startedAt) });
    });

    sub.get('/descriptor', (_req, res) => {
        res.json({
            success: true,
            ...buildAgentInfo(agent, serviceName, startedAt),
            descriptor: agent.getDescriptor ? agent.getDescriptor() : { agentId: agent.agentId, role: agent.role }
        });
    });

    sub.post('/execute', makeAuthMiddleware(sharedSecret, { authDisabled }), async (req, res) => {
        try {
            const body = req.body || {};
            const task = body.task;
            const context = body.context && typeof body.context === 'object' ? body.context : {};
            if (!task || typeof task !== 'object' || Array.isArray(task)) {
                return res.status(400).json({ success: false, error: 'task object is required' });
            }
            if (typeof agent.supports === 'function' && !agent.supports(task)) {
                return res.status(409).json({ success: false, error: `Agent ${agent.agentId} does not support this task` });
            }
            const result = await agent.execute(task, context);
            return res.json({ success: true, ...buildAgentInfo(agent, serviceName, startedAt), result });
        } catch (error) {
            return res.status(500).json({ success: false, error: error.message || 'Agent execution failed' });
        }
    });

    sub.use((error, _req, res, next) => {
        if (!error) return next();
        return res.status(400).json({ success: false, error: error.message || 'Invalid request body' });
    });

    return sub;
}

function loadBundle(env = process.env) {
    const raw = env.AGENT_BUNDLE_JSON;
    if (!raw) {
        throw new Error('AGENT_BUNDLE_JSON env var is required (JSON array of agent specs).');
    }
    let parsed;
    try { parsed = JSON.parse(raw); } catch (err) {
        throw new Error(`AGENT_BUNDLE_JSON is not valid JSON: ${err.message}`);
    }
    if (!Array.isArray(parsed) || parsed.length === 0) {
        throw new Error('AGENT_BUNDLE_JSON must be a non-empty array.');
    }
    const seenPaths = new Set();
    for (const spec of parsed) {
        if (!spec.mountPath || typeof spec.mountPath !== 'string' || !spec.mountPath.startsWith('/')) {
            throw new Error(`Each agent spec needs a mountPath starting with '/': ${JSON.stringify(spec)}`);
        }
        if (seenPaths.has(spec.mountPath)) {
            throw new Error(`Duplicate mountPath '${spec.mountPath}' in bundle.`);
        }
        seenPaths.add(spec.mountPath);
        if (!spec.agentId) {
            throw new Error(`Each agent spec needs an agentId: ${JSON.stringify(spec)}`);
        }
    }
    return parsed;
}

function startMultiAgentService({ env = process.env, logger = console, exitOnError = false } = {}) {
    const port = parsePort(env.AGENT_PORT);
    const host = env.AGENT_HOST || DEFAULT_HOST;
    const serviceName = env.AGENT_SERVICE_NAME || 'crosschain-agent-bundle';
    const payloadLimit = env.AGENT_PAYLOAD_LIMIT || DEFAULT_PAYLOAD_LIMIT;
    const authDisabled = parseBoolean(env.AGENT_AUTH_DISABLED, false);
    const startedAt = new Date();

    const bundle = loadBundle(env);
    const app = express();
    const mounted = [];

    for (const spec of bundle) {
        const agent = buildVerifier(spec);
        const sub = createAgentSubApp({
            agent,
            sharedSecret: spec.sharedSecret || null,
            serviceName,
            startedAt,
            payloadLimit,
            authDisabled
        });
        app.use(spec.mountPath, sub);
        mounted.push({ mountPath: spec.mountPath, agentId: agent.agentId, organization: spec.organization, strategyType: spec.strategyType });
    }

    // Root health summarises the bundle so operators can probe the port quickly.
    app.get('/health', (_req, res) => {
        res.json({
            status: 'ok',
            service: serviceName,
            protocolVersion: AGENT_PROTOCOL_VERSION,
            bundleSize: mounted.length,
            agents: mounted,
            uptimeSec: Math.round((Date.now() - startedAt.getTime()) / 1000),
            ts: new Date().toISOString()
        });
    });

    const server = app.listen(port, host, () => {
        logger.log(JSON.stringify({
            event: 'agent-bundle-started',
            service: serviceName,
            protocolVersion: AGENT_PROTOCOL_VERSION,
            url: `http://${host}:${port}`,
            agents: mounted,
            ts: new Date().toISOString()
        }));
    });

    // Fail loudly on bind errors (e.g. EADDRINUSE) instead of leaving a
    // half-dead process behind a stale PID file. The launcher relies on the
    // process actually exiting so its health probe + PID cleanup can detect
    // the failure rather than reporting a zombie as "running".
    server.on('error', (error) => {
        logger.error(JSON.stringify({
            event: 'agent-bundle-error',
            service: serviceName,
            url: `http://${host}:${port}`,
            code: error && error.code ? error.code : null,
            message: error && error.message ? error.message : String(error),
            ts: new Date().toISOString()
        }));
        if (exitOnError) {
            process.exit(1);
        }
    });

    return { app, server, host, port, agents: mounted };
}

module.exports = { startMultiAgentService, createAgentSubApp, loadBundle };

if (require.main === module) {
    startMultiAgentService({ exitOnError: true });
}
