class RelayFacade {
    constructor({ eventStore }) {
        this.eventStore = eventStore;
    }

    findRelayEvent(direction, { sourceTxHash, correlationId }) {
        const items = this.eventStore.getEvents(2000).slice().reverse();
        for (const item of items) {
            if (item.direction !== direction) {
                continue;
            }
            if (item.relayState !== 'SUCCESS' && item.relayState !== 'FAILED') {
                continue;
            }
            if (sourceTxHash && item.sourceTxHash === sourceTxHash) {
                return item;
            }
            if (correlationId && item.correlationId === correlationId) {
                return item;
            }
        }
        return null;
    }

    waitForRelayEvent(direction, lookup, timeoutMs, pollIntervalMs = 300) {
        const safeTimeoutMs = Math.max(0, Number(timeoutMs) || 0);
        const safePollMs = Math.max(50, Number(pollIntervalMs) || 300);
        const finalLookup = lookup || {};

        const existing = this.findRelayEvent(direction, finalLookup);
        if (existing) {
            return Promise.resolve(existing);
        }

        // Prefer event-driven waiting, with a polling fallback to avoid regressions.
        const eventDriven = (typeof this.eventStore.waitFor === 'function')
            ? this.eventStore.waitFor((item) => {
                if (item.direction !== direction) return false;
                if (item.relayState !== 'SUCCESS' && item.relayState !== 'FAILED') return false;
                if (finalLookup.sourceTxHash && item.sourceTxHash === finalLookup.sourceTxHash) return true;
                if (finalLookup.correlationId && item.correlationId === finalLookup.correlationId) return true;
                return false;
            }, safeTimeoutMs)
            : null;

        const polling = (async () => {
            const startedAt = Date.now();
            while (Date.now() - startedAt < safeTimeoutMs) {
                const matched = this.findRelayEvent(direction, finalLookup);
                if (matched) return matched;
                await new Promise((resolve) => setTimeout(resolve, safePollMs));
            }
            return this.findRelayEvent(direction, finalLookup);
        })();

        return Promise.race([
            eventDriven || polling,
            polling
        ]).then((matched) => {
            if (matched) return matched;
            const err = new Error('Relay result query timeout');
            err.code = 'ERR_QUERY_TIMEOUT';
            throw err;
        });
    }
}

module.exports = { RelayFacade };

