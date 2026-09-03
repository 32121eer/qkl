function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function faultError(code, message, { recoverable = false, insufficient = false } = {}) {
    const error = new Error(message || code);
    error.code = code;
    error.recoverable = recoverable;
    error.insufficient = insufficient;
    return error;
}

class FaultInjector {
    constructor(plan = []) {
        this.plan = (plan || []).map((entry, index) => ({
            id: entry.id || `fault-${index}`,
            remaining: entry.times === undefined ? 1 : Number(entry.times),
            ...entry
        }));
        this.applied = [];
    }

    matches(entry, node, context) {
        if (entry.remaining <= 0) return false;
        if (entry.queryId && entry.queryId !== context.queryId) return false;
        if (entry.nodeId && entry.nodeId !== node.id) return false;
        if (entry.attempt && Number(entry.attempt) !== Number(context.attempt)) return false;
        if (entry.candidate && entry.candidate !== context.candidate) return false;
        return true;
    }

    async execute(node, context, delegate) {
        const entry = this.plan.find((candidate) => this.matches(candidate, node, context));
        if (!entry) return delegate();

        entry.remaining -= 1;
        this.applied.push({
            faultId: entry.id,
            queryId: context.queryId,
            nodeId: node.id,
            attempt: context.attempt,
            candidate: context.candidate,
            action: entry.action
        });

        if (entry.action === 'error') {
            throw faultError(entry.code || 'INJECTED_ERROR', entry.message, {
                recoverable: Boolean(entry.recoverable),
                insufficient: Boolean(entry.insufficient)
            });
        }
        if (entry.action === 'timeout') {
            await wait(entry.delayMs || (Number(node.timeoutMs || 1000) + 100));
            return delegate();
        }
        if (entry.action === 'delay') {
            await wait(entry.delayMs || 0);
            return delegate();
        }
        if (entry.action === 'replace') {
            return typeof entry.value === 'function' ? entry.value(node, context) : entry.value;
        }
        if (entry.action === 'mutate') {
            const result = await delegate();
            return entry.mutate(result, node, context);
        }
        throw faultError('UNKNOWN_FAULT_ACTION', `Unknown fault action '${entry.action}'`);
    }
}

module.exports = { FaultInjector, faultError, wait };
