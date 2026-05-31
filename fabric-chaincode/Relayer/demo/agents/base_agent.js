class BaseAgent {
    constructor({
        agentId,
        role,
        capabilities = [],
        enabled = true,
        organization = null,
        strategyType = null,
        llmBackend = null
    }) {
        this.agentId = agentId;
        this.role = role;
        this.capabilities = capabilities;
        this.enabled = enabled;
        this.organization = organization;
        this.strategyType = strategyType;
        this.llmBackend = llmBackend;
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
            kind: 'local'
        };
    }

    supports(_task) {
        return this.enabled;
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
