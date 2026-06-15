const VALID_AVAILABILITY_STATUSES = ['available', 'unavailable', 'in_use'];

class BaseAgent {
    constructor({
        agentId,
        role,
        capabilities = [],
        enabled = true,
        organization = null,
        strategyType = null,
        llmBackend = null,
        availabilityStatus = 'available'
    }) {
        this.agentId = agentId;
        this.role = role;
        this.capabilities = capabilities;
        this.enabled = enabled;
        this.organization = organization;
        this.strategyType = strategyType;
        this.llmBackend = llmBackend;
        this.availabilityStatus = VALID_AVAILABILITY_STATUSES.includes(availabilityStatus)
            ? availabilityStatus
            : 'available';
    }

    markAvailable() {
        this.availabilityStatus = 'available';
    }

    markUnavailable() {
        this.availabilityStatus = 'unavailable';
    }

    markInUse() {
        this.availabilityStatus = 'in_use';
    }

    getDescriptor() {
        return {
            agentId: this.agentId,
            role: this.role,
            capabilities: this.capabilities.slice(),
            organization: this.organization,
            strategyType: this.strategyType,
            llmBackend: this.llmBackend,
            enabled: this.enabled,
            availabilityStatus: this.availabilityStatus,
            kind: 'local'
        };
    }

    supports(_task) {
        return this.enabled && this.availabilityStatus === 'available';
    }

    createEnvelope(task, extra = {}) {
        return {
            agentId: this.agentId,
            role: this.role,
            taskId: task?.taskId || null,
            queryId: task?.queryId || null,
            evidenceVersion: task?.evidenceVersion || 0,
            generatedAt: new Date().toISOString(),
            organization: this.organization,
            strategyType: this.strategyType,
            llmBackend: this.llmBackend,
            ...extra
        };
    }

    async execute(_task, _context = {}) {
        throw new Error(`Agent ${this.agentId} must implement execute()`);
    }
}

module.exports = { BaseAgent };
