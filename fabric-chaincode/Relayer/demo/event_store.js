class DemoEventStore {
    constructor(limit = 500) {
        this.limit = limit;
        this.events = [];
        this.sequence = 0;
        this.clients = new Set();
    }

    addEvent(event) {
        const normalized = {
            id: `evt_${Date.now()}_${++this.sequence}`,
            ts: new Date().toISOString(),
            level: 'info',
            type: 'system',
            direction: 'UNKNOWN',
            relayState: 'INFO',
            correlationId: null,
            sourceTxHash: null,
            sourceBlockNumber: null,
            targetTxHash: null,
            targetBlockNumber: null,
            sourcePayloadHash: null,
            targetPayloadHash: null,
            receiptStatus: null,
            errorCode: null,
            message: '',
            data: {},
            ...event
        };

        this.events.push(normalized);
        if (this.events.length > this.limit) {
            this.events.shift();
        }

        const payload = `data: ${JSON.stringify(normalized)}\n\n`;
        for (const client of this.clients) {
            try {
                client.write(payload);
            } catch (_error) {
                // Ignore closed client write errors.
            }
        }

        return normalized;
    }

    getEvents(limit = 200) {
        const safeLimit = Number.isFinite(limit) ? Number(limit) : 200;
        const finalLimit = Math.max(1, Math.min(2000, safeLimit));
        return this.events.slice(-finalLimit);
    }

    attachClient(response) {
        this.clients.add(response);
    }

    detachClient(response) {
        this.clients.delete(response);
    }

    getClientCount() {
        return this.clients.size;
    }
}

module.exports = { DemoEventStore };
