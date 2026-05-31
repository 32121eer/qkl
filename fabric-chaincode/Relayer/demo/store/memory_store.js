class DemoMemoryStore {
    constructor({ maxSessions = 1000 } = {}) {
        this.maxSessions = maxSessions;
        this.querySessions = new Map();
        this.querySessionOrder = [];
        this.fiscoLocalRecords = new Map();
    }

    saveQuerySession(session) {
        this.querySessions.set(session.queryId, session);
        if (!this.querySessionOrder.includes(session.queryId)) {
            this.querySessionOrder.unshift(session.queryId);
        }
        if (this.querySessionOrder.length > this.maxSessions) {
            const removed = this.querySessionOrder.splice(this.maxSessions);
            for (const queryId of removed) {
                this.querySessions.delete(queryId);
            }
        }
        return session;
    }

    getQuerySession(queryId) {
        const item = this.querySessions.get(queryId);
        if (!item) return null;
        return JSON.parse(JSON.stringify(item));
    }

    listQuerySessions(limit = 20) {
        const safeLimit = Math.max(1, Math.min(this.maxSessions, Number(limit) || 20));
        const ids = this.querySessionOrder.slice(0, safeLimit);
        const items = [];
        for (const queryId of ids) {
            const item = this.querySessions.get(queryId);
            if (item) {
                items.push(JSON.parse(JSON.stringify(item)));
            }
        }
        return items;
    }

    saveFiscoLocalRecord(record) {
        this.fiscoLocalRecords.set(record.recordId, JSON.parse(JSON.stringify(record)));
        return record;
    }

    getFiscoLocalRecord(recordId) {
        const item = this.fiscoLocalRecords.get(recordId);
        return item ? JSON.parse(JSON.stringify(item)) : null;
    }

    listFiscoLocalRecords(limit = 50, category = null) {
        let items = Array.from(this.fiscoLocalRecords.values());
        if (category) items = items.filter(r => r.category === category);
        return items.slice(0, Math.max(1, Math.min(500, Number(limit) || 50)))
            .map(r => JSON.parse(JSON.stringify(r)));
    }
}

module.exports = { DemoMemoryStore };


