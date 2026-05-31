const { DemoEventBus } = require('./events/event_bus');

// Backwards-compatible adapter: older code expects DemoEventStore.
// Internally we use DemoEventBus so we can wait for events (event-driven) later.
class DemoEventStore {
    constructor(limit = 500) {
        this.bus = new DemoEventBus(limit);
    }

    addEvent(event) {
        return this.bus.addEvent(event);
    }

    getEvents(limit = 200) {
        return this.bus.getEvents(limit);
    }

    attachClient(response) {
        return this.bus.attachClient(response);
    }

    detachClient(response) {
        return this.bus.detachClient(response);
    }

    getClientCount() {
        return this.bus.getClientCount();
    }

    waitFor(predicate, timeoutMs) {
        return this.bus.waitFor(predicate, timeoutMs);
    }
}

module.exports = { DemoEventStore };
