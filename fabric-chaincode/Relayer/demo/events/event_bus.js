const { normalizeDemoEvent } = require('../model/demo_event');

class DemoEventBus {
    constructor(limit = 500) {
        this.limit = limit;
        this.events = [];
        this.sequence = 0;
        this.clients = new Set();
        this.waiters = new Set();
    }

    addEvent(event) {
        const id = `evt_${Date.now()}_${++this.sequence}`;
        const normalized = normalizeDemoEvent(event, { id });

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

        for (const waiter of Array.from(this.waiters)) {
            try {
                if (waiter.predicate(normalized)) {
                    this.waiters.delete(waiter);
                    waiter.resolve(normalized);
                }
            } catch (_error) {
                // Ignore predicate failures and keep waiter until timeout.
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

    waitFor(predicate, timeoutMs = 30_000) {
        // If the event already exists (e.g. the waiter is registered late),
        // resolve immediately to avoid false timeouts.
        const reversed = this.events.slice().reverse();
        for (const existing of reversed) {
            try {
                if (predicate(existing)) {
                    return Promise.resolve(existing);
                }
            } catch (_error) {
                // Ignore predicate failures for existing events.
            }
        }

        const finalTimeoutMs = Math.max(0, Number(timeoutMs) || 0);
        return new Promise((resolve, reject) => {
            const waiter = {
                predicate,
                resolve: (event) => {
                    clearTimeout(timer);
                    this.waiters.delete(waiter);
                    resolve(event);
                },
                reject: (error) => {
                    clearTimeout(timer);
                    this.waiters.delete(waiter);
                    reject(error);
                }
            };

            const timer = setTimeout(() => {
                const err = new Error('Event wait timeout');
                err.code = 'ERR_WAIT_TIMEOUT';
                waiter.reject(err);
            }, finalTimeoutMs);

            this.waiters.add(waiter);
        });
    }
}

module.exports = { DemoEventBus };
