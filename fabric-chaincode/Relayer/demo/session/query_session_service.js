const { createQuerySession } = require('./query_session_model');

function parseTimeMs(value) {
    const ms = Date.parse(String(value || ''));
    return Number.isNaN(ms) ? null : ms;
}

class QuerySessionService {
    constructor(store) {
        this.store = store;
    }

    async create({ queryId, orchardBatchId }) {
        const session = createQuerySession({ queryId, orchardBatchId });
        await this.store.saveQuerySession(session);
        return this.store.getQuerySession(queryId);
    }

    async get(queryId) {
        return this.store.getQuerySession(queryId);
    }

    async list(limit) {
        return this.store.listQuerySessions(limit);
    }

    async patch(queryId, patch = {}) {
        const current = await this.store.getQuerySession(queryId);
        if (!current) return null;
        const next = { ...current, ...patch };
        await this.store.saveQuerySession(next);
        return this.store.getQuerySession(queryId);
    }

    async appendStep(queryId, step, details = {}) {
        const session = await this.store.getQuerySession(queryId);
        if (!session) return null;

        const nowIso = new Date().toISOString();
        const requestAt = parseTimeMs(session.requestTs);
        const previousStep = session.steps?.length ? session.steps[session.steps.length - 1] : null;
        const prevAt = parseTimeMs(previousStep?.ts);
        const nowAt = parseTimeMs(nowIso);

        const elapsedFromRequestMs =
            requestAt !== null && nowAt !== null ? Math.max(0, nowAt - requestAt) : null;
        const elapsedFromPreviousStepMs =
            prevAt !== null && nowAt !== null ? Math.max(0, nowAt - prevAt) : null;

        const enrichedDetails = {
            ...details,
            elapsedFromRequestMs,
            elapsedFromPreviousStepMs
        };

        const next = {
            ...session,
            steps: [
                ...(Array.isArray(session.steps) ? session.steps : []),
                { ts: nowIso, step, details: enrichedDetails }
            ],
            updatedAt: nowIso
        };
        await this.store.saveQuerySession(next);
        return this.store.getQuerySession(queryId);
    }
}

module.exports = { QuerySessionService };
