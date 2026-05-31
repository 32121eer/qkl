/**
 * On-chain Agent Registry Client
 * Interacts with AgentRegistry.sol deployed on FISCO-BCOS
 */

const { ethers } = require('ethers');
const AgentRegistryABI = require('../../abi/AgentRegistry.json');

class OnChainRegistryClient {
    constructor({
        contractAddress,
        rpcEndpoint = 'http://127.0.0.1:8545',
        privateKey,
        adminAddress = null
    } = {}) {
        this.contractAddress = contractAddress;
        this.rpcEndpoint = rpcEndpoint;
        this.privateKey = privateKey;
        this.adminAddress = adminAddress;

        this.provider = null;
        this.wallet = null;
        this.contract = null;
        this._connected = false;
    }

    async connect() {
        if (this._connected) return;

        const staticNetwork = new ethers.Network('fisco-bcos', 1);
        this.provider = new ethers.JsonRpcProvider(this.rpcEndpoint, staticNetwork, {
            staticNetwork: true
        });

        if (this.privateKey) {
            this.wallet = new ethers.Wallet(this.privateKey, this.provider);
        }

        const signer = this.wallet || this.provider;
        this.contract = new ethers.Contract(this.contractAddress, AgentRegistryABI, signer);

        // Test connection
        await this.contract.admin();
        this._connected = true;
    }

    // ─── Agent 管理 ───

    async registerAgent(agentId, role, organization, strategyType, endpoint, publicKey) {
        await this.connect();
        const tx = await this.contract.registerAgent(
            agentId,
            role, // 0=NONE, 1=COLLECTOR, 2=VERIFIER, 3=ARBITER, 4=COORDINATOR, 5=SUBMITTER
            organization,
            strategyType,
            endpoint,
            publicKey || ethers.ZeroHash
        );
        return await tx.wait();
    }

    async batchRegisterAgents(agents) {
        await this.connect();
        const tx = await this.contract.batchRegisterAgents(
            agents.map(a => a.agentId),
            agents.map(a => a.role),
            agents.map(a => a.organization),
            agents.map(a => a.strategyType || ''),
            agents.map(a => a.endpoint || ''),
            agents.map(a => a.publicKey || ethers.ZeroHash)
        );
        return await tx.wait();
    }

    async getAgent(agentId) {
        await this.connect();
        const agent = await this.contract.getAgent(agentId);
        return {
            agentId: agent.agentId,
            role: Number(agent.role),
            organization: agent.organization,
            strategyType: agent.strategyType,
            endpoint: agent.endpoint,
            publicKey: agent.publicKey,
            reputation: Number(agent.reputation),
            successCount: Number(agent.successCount),
            totalTasks: Number(agent.totalTasks),
            registeredAt: Number(agent.registeredAt),
            lastActiveAt: Number(agent.lastActiveAt),
            status: Number(agent.status)
        };
    }

    async getAgentReputation(agentId) {
        await this.connect();
        const [reputation, successRate] = await this.contract.getAgentReputation(agentId);
        return {
            reputation: Number(reputation) / 1000, // 转换为 0-1
            successRate: Number(successRate) / 100 // 转换为百分比
        };
    }

    async isAgentActive(agentId) {
        await this.connect();
        return await this.contract.isAgentActive(agentId);
    }

    async getActiveVerifiers() {
        await this.connect();
        return await this.contract.getActiveVerifiers();
    }

    // ─── 委员会选择 ───

    async selectCommittee(taskId, role, committeeSize, riskLevel = 'NORMAL') {
        await this.connect();
        const tx = await this.contract.selectCommittee(taskId, role, committeeSize, riskLevel);
        const receipt = await tx.wait();

        // 解析事件获取选中的委员会
        const event = receipt.logs
            .map(log => {
                try {
                    return this.contract.interface.parseLog(log);
                } catch (e) {
                    return null;
                }
            })
            .find(e => e?.name === 'CommitteeSelected');

        return {
            taskId,
            agentIds: event?.args?.agentIds || [],
            seed: event?.args?.seed?.toString(),
            blockNumber: receipt.blockNumber
        };
    }

    async getCommittee(taskId) {
        await this.connect();
        const committee = await this.contract.getCommittee(taskId);
        return {
            taskId: committee.taskId,
            agentIds: committee.selectedAgents,
            seed: committee.seed.toString(),
            selectedAt: Number(committee.selectedAt),
            finalized: committee.finalized
        };
    }

    async finalizeCommittee(taskId) {
        await this.connect();
        const tx = await this.contract.finalizeCommittee(taskId);
        return await tx.wait();
    }

    // ─── 信誉管理 ───

    async recordTaskResult(taskId, agentId, aligned, confidence, latencyMs) {
        await this.connect();
        const tx = await this.contract.recordTaskResult(
            taskId,
            agentId,
            aligned,
            Math.round(confidence * 1000), // 转换为 0-1000
            Math.round(latencyMs)
        );
        return await tx.wait();
    }

    async batchRecordTaskResults(taskId, results) {
        await this.connect();
        const tx = await this.contract.batchRecordTaskResults(
            taskId,
            results.map(r => r.agentId),
            results.map(r => r.aligned),
            results.map(r => Math.round(r.confidence * 1000)),
            results.map(r => Math.round(r.latencyMs))
        );
        return await tx.wait();
    }

    async getReputationHistory(agentId, limit = 10) {
        await this.connect();
        const history = await this.contract.getReputationHistory(agentId, limit);
        return history.map(h => ({
            agentId: h.agentId,
            delta: Number(h.delta) / 1000,
            newReputation: Number(h.newReputation) / 1000,
            reason: h.reason,
            updatedAt: Number(h.updatedAt)
        }));
    }

    // ─── 查询统计 ───

    async getAgentCount() {
        await this.connect();
        return Number(await this.contract.getAgentCount());
    }

    async getAgentsByRole(role) {
        await this.connect();
        return await this.contract.getAgentsByRole(role);
    }
}

module.exports = { OnChainRegistryClient };
