/**
 * AgentChainClient
 *
 * Agent 侧的链上交互封装。负责：
 *   1. 订阅 VerificationTaskManager 的 CommitteeAssigned 事件
 *   2. 向链上提交 commit（submitCommit）
 *   3. 向链上提交 reveal（submitReveal）
 *   4. 读取链上任务状态和信誉
 *
 * 依赖：ethers.js 6，与现有 fisco_bcos_monitor.js 保持一致的 RPC 配置。
 */

const { ethers } = require('ethers');
const crypto = require('node:crypto');

// ABI 片段：只包含 Agent 需要的方法和事件
const TASK_MANAGER_ABI = [
    'event CommitteeAssigned(string indexed taskId, string[] agentIds, uint256 seed, uint256 commitDeadline)',
    'event RevealPhaseOpened(string indexed taskId, uint256 revealDeadline)',
    'event ConsensusFinalized(string indexed taskId, string finalDecision, uint256 acceptRatio, uint256 validReveals)',
    'function getTask(string taskId) view returns (tuple(string taskId, string queryId, string sourceChain, string targetChain, uint8 risk, uint256 deadline, uint256 commitDeadline, uint256 revealDeadline, bytes32 evidenceHash, uint8 status, uint256 groupSize, uint256 threshold, bool arbitrationDone))',
    'function getCommittee(string taskId) view returns (string[])',
    'function submitCommit(string taskId, string agentId, bytes32 commitHash)',
    'function submitReveal(string taskId, string agentId, string judgment, uint256 confidence, bytes32 nonce)',
    'function openRevealPhase(string taskId)',
    'function finalizeConsensus(string taskId)',
    'function forceTimeout(string taskId)'
];

class AgentChainClient {
    /**
     * @param {object} opts
     * @param {string}  opts.rpcUrl            FISCO-BCOS JSON-RPC 端点
     * @param {string}  opts.taskManagerAddress VerificationTaskManager 合约地址
     * @param {string}  opts.privateKey         Agent 的私钥（用于签名链上交易）
     * @param {string}  opts.agentId            Agent 标识（与链上注册一致）
     * @param {number}  [opts.pollIntervalMs]   事件轮询间隔（FISCO 不支持 eth_subscribe 时使用）
     */
    constructor({
        rpcUrl,
        taskManagerAddress,
        privateKey,
        agentId,
        pollIntervalMs = 2000
    }) {
        if (!rpcUrl || !taskManagerAddress || !privateKey || !agentId) {
            throw new Error('AgentChainClient: rpcUrl, taskManagerAddress, privateKey, agentId are required');
        }
        this.agentId = agentId;
        this.pollIntervalMs = pollIntervalMs;

        this.provider = new ethers.JsonRpcProvider(rpcUrl);
        this.wallet   = new ethers.Wallet(privateKey, this.provider);
        this.contract = new ethers.Contract(taskManagerAddress, TASK_MANAGER_ABI, this.wallet);

        this._listeners   = new Map();   // eventName → handler[]
        this._pollTimer   = null;
        this._lastBlock   = 0;
        this._pendingCommitReveal = new Map(); // taskId → { nonce, judgment, confidence }
    }

    // ─── 事件订阅 ───

    /**
     * 开始轮询 CommitteeAssigned 事件。
     * 当本 agent 被选入委员会时，调用注册的 onCommitteeAssigned 处理器。
     */
    startListening() {
        if (this._pollTimer) return;
        this._pollTimer = setInterval(() => this._poll(), this.pollIntervalMs);
    }

    stopListening() {
        if (this._pollTimer) {
            clearInterval(this._pollTimer);
            this._pollTimer = null;
        }
    }

    on(event, handler) {
        if (!this._listeners.has(event)) this._listeners.set(event, []);
        this._listeners.get(event).push(handler);
    }

    _emit(event, ...args) {
        (this._listeners.get(event) || []).forEach((h) => {
            try { h(...args); } catch (_) {}
        });
    }

    async _poll() {
        try {
            const latest = await this.provider.getBlockNumber();
            if (latest <= this._lastBlock) return;

            const from = this._lastBlock + 1;
            const to   = latest;
            this._lastBlock = latest;

            // CommitteeAssigned — 检查本 agent 是否被选中
            const committeeFilter = this.contract.filters.CommitteeAssigned();
            const committeeEvents = await this.contract.queryFilter(committeeFilter, from, to);
            for (const ev of committeeEvents) {
                const { taskId, agentIds, commitDeadline } = ev.args;
                if (agentIds.includes(this.agentId)) {
                    this._emit('committeeAssigned', { taskId, agentIds, commitDeadline: Number(commitDeadline) });
                }
            }

            // RevealPhaseOpened
            const revealFilter = this.contract.filters.RevealPhaseOpened();
            const revealEvents = await this.contract.queryFilter(revealFilter, from, to);
            for (const ev of revealEvents) {
                const { taskId, revealDeadline } = ev.args;
                if (this._pendingCommitReveal.has(taskId)) {
                    this._emit('revealPhaseOpened', { taskId, revealDeadline: Number(revealDeadline) });
                }
            }

            // ConsensusFinalized
            const finalFilter = this.contract.filters.ConsensusFinalized();
            const finalEvents = await this.contract.queryFilter(finalFilter, from, to);
            for (const ev of finalEvents) {
                const { taskId, finalDecision, acceptRatio, validReveals } = ev.args;
                this._emit('consensusFinalized', {
                    taskId,
                    finalDecision,
                    acceptRatio: Number(acceptRatio),
                    validReveals: Number(validReveals)
                });
                this._pendingCommitReveal.delete(taskId);
            }
        } catch (_err) {
            // 网络抖动时静默重试
        }
    }

    // ─── Commit-Reveal 操作 ───

    /**
     * 生成并提交 commit。
     * commitment = keccak256(judgment ‖ confidence ‖ nonce)
     * 与链上 VerificationTaskManager.submitReveal 的验证逻辑对称。
     *
     * @param {string} taskId
     * @param {string} judgment   "APPROVE" | "REJECT" | "QUESTION"
     * @param {number} confidence 0-1000
     * @returns {string} commitHash（hex）
     */
    async commit(taskId, judgment, confidence) {
        const nonce = ethers.hexlify(crypto.randomBytes(32));

        // 与 Solidity keccak256(abi.encodePacked(judgment, confidence, nonce)) 对称
        const commitHash = ethers.keccak256(
            ethers.solidityPacked(
                ['string', 'uint256', 'bytes32'],
                [judgment, confidence, nonce]
            )
        );

        const tx = await this.contract.submitCommit(taskId, this.agentId, commitHash);
        await tx.wait();

        // 保存以备 reveal 阶段使用
        this._pendingCommitReveal.set(taskId, { nonce, judgment, confidence });

        return commitHash;
    }

    /**
     * 揭示之前的 commit。
     * 链上合约会重算哈希验证一致性。
     */
    async reveal(taskId) {
        const pending = this._pendingCommitReveal.get(taskId);
        if (!pending) throw new Error(`No pending commit for task ${taskId}`);

        const { judgment, confidence, nonce } = pending;
        const tx = await this.contract.submitReveal(
            taskId,
            this.agentId,
            judgment,
            confidence,
            nonce
        );
        await tx.wait();
        return { judgment, confidence };
    }

    /**
     * 触发 reveal 阶段（commit deadline 到期后任何人可调用）
     */
    async openRevealPhase(taskId) {
        const tx = await this.contract.openRevealPhase(taskId);
        await tx.wait();
    }

    /**
     * 触发链上共识计算（reveal deadline 到期后任何人可调用）
     */
    async finalizeConsensus(taskId) {
        const tx = await this.contract.finalizeConsensus(taskId);
        await tx.wait();
    }

    // ─── 只读查询 ───

    async getTask(taskId) {
        return this.contract.getTask(taskId);
    }

    async getCommittee(taskId) {
        return this.contract.getCommittee(taskId);
    }

    async getConsensusResult(taskId) {
        return this.contract.getConsensusResult(taskId);
    }
}

module.exports = { AgentChainClient };
