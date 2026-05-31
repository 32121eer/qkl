class AgentRegistry {
    constructor() {
        this.agents = new Map();
    }

    register(agent) {
        if (!agent || !agent.agentId) {
            return null;
        }
        this.agents.set(agent.agentId, agent);
        return agent;
    }

    get(agentId) {
        return this.agents.get(agentId) || null;
    }

    unregister(agentId) {
        return this.agents.delete(agentId);
    }

    list(role = null) {
        const agents = Array.from(this.agents.values());
        if (!role) {
            return agents.slice();
        }
        return agents.filter((agent) => agent.role === role);
    }
}

module.exports = { AgentRegistry };
