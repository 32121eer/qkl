/**
 * OnchainConsensusWatcher
 *
 * QueryBroker 使用这个模块替代 agentRuntime.evaluateTask()。
 * 职责：
 *   1. 向 VerificationTaskManager.sol 创建链上任务（createTask）
 *   2. 发布 evidence bundle 到 HTTP 端点（agent 可拉取）
 *   3. 轮询或监听链上 ConsensusFinalized / TaskStatusChanged 事件
 *   4. 返回链上共识结果，供 QueryBroker 决定是否推进响应上链
 *
 * 这是 Relayer 去中心化改造的最小侵入点：
 *   QueryBroker 中只需将 runInitialAgentRound() 替换为 waitForOnchainConsensus()。
 */

const { ethers } = require('ethers');
const crypto = require('node:crypto');

const TASK_MANAGER_ABI = [
    'event ConsensusFinalized(string indexed taskId, string finalDecision, uint256 acceptRatio, uint256 validReveals)',
    'event TaskStatusChanged(string indexed taskId, uint8 oldStatus, uint8 newStatus)',
    'function createTask(string taskId, string queryId, string sourceChain, string targetChain, string riskStr, bytes32 evidenceHash)',
    'function getTask(string taskId) view returns (tuple(string taskId, string queryId, string sourceChain, string targetChain, uint8 risk, uint256 deadline, uint256 commitDeadline, uint256 revealDeadline, bytes32 evidenceHash, uint8 status, uint256 groupSize, uint256 threshold, bool arbitrationDone))',
    'function getConsensusResult(string taskId) view returns (tuple(string finalDecision, uint256 approveWeight, uint256 rejectWeight, uint256 acceptRatio, uint256 validReveals, uint256 computedAt))'
];

// TaskStatus 枚举与合约保持一致
const TERMINAL_STATUSES = new Set([5, 6, 7, 8]); // CONFIRMED=5, REJECTED=6, ARBITRATING=7, TIMEOUT=8

class OnchainConsensusWatcher {
    /**
     * @param {object} opts
     * @param {string}  opts.rpcUrl              FISCO-BCOS RPC
     * @param {string}  opts.taskManagerAddress  VerificationTaskManager 合约地址
     * @param {string}  opts.privateKey          Relayer 签名私钥（onlyAdmin）
     * @param {object}  [opts.evidenceStore]     { set(taskId, bundle), get(taskId) }
     * @param {number}  [opts.pollIntervalMs]
     * @param {number}  [opts.maxWaitMs]         最长等待时间（对齐合约 DEFAULT_GLOBAL_TIMEOUT_SEC）
     */
    constructor({
        rpcUrl,
        taskManagerAddress,
        privateKey,
        evidenceStore = null,
        pollIntervalMs = 1500,
        maxWaitMs = 95_000
    }) {
        this.evidenceStore  = evidenceStore || new Map();
        this.pollIntervalMs = pollIntervalMs;
        this.maxWaitMs      = maxWaitMs;

        const provider = new ethers.JsonRpcProvider(rpcUrl);
        const wallet   = new ethers.Wallet(privateKey, provider);
        this.contract  = new ethers.Contract(taskManagerAddress, TASK_MANAGER_ABI, wallet);
    }

    /**
     * 计算 evidence bundle 的哈希（与 AgentChainListener._fetchEvidence 对称）
     */
    computeEvidenceHash(evidenceBundle) {
        const raw = JSON.stringify(evidenceBundle || {});
        return ethers.keccak256(ethers.toUtf8Bytes(raw));
    }

    /**
     * 发布 evidence bundle（agent 通过 GET /api/tasks/:taskId/evidence 拉取）
     */
    publishEvidence(taskId, evidenceBundle) {
        if (typeof this.evidenceStore.set === 'function') {
            this.evidenceStore.set(taskId, evidenceBundle);
        } else {
            this.evidenceStore[taskId] = evidenceBundle;
        }
    }

    /**
     * 创建链上任务，等待共识完成，返回结果。
     * 替代 QueryBroker 中的 runInitialAgentRound()。
     *
     * @param {string} taskId
     * @param {object} session          当前查询 session
     * @param {object} evidenceBundle   已组装的 evidence bundle
     * @returns {{ finalDecision, acceptRatio, validReveals, onchain: true }}
     */
    async waitForOnchainConsensus(taskId, session, evidenceBundle) {
        const queryId     = session.queryId || taskId;
        const sourceChain = session.requestedByChain || 'fisco-bcos';
        const targetChain = session.targetDataChain  || 'fabric';
        const risk        = session.risk || session.riskLevel || 'NORMAL';

        // 1. 发布证据（agent 拉取）
        this.publishEvidence(taskId, evidenceBundle);
        const evidenceHash = this.computeEvidenceHash(evidenceBundle);

        // 2. 链上创建任务（触发委员会选择，emit CommitteeAssigned）
        const tx = await this.contract.createTask(
            taskId, queryId, sourceChain, targetChain, risk, evidenceHash
        );
        await tx.wait();

        // 3. 等待链上 ConsensusFinalized 事件
        return this._pollForResult(taskId);
    }

    async _pollForResult(taskId) {
        const start   = Date.now();
        const timeout = this.maxWaitMs;

        return new Promise((resolve, reject) => {
            const timer = setInterval(async () => {
                try {
                    if (Date.now() - start > timeout) {
                        clearInterval(timer);
                        reject(new Error(`OnchainConsensusWatcher: timeout waiting for task ${taskId}`));
                        return;
                    }

                    const task = await this.contract.getTask(taskId);
                    const status = Number(task.status);

                    if (!TERMINAL_STATUSES.has(status)) return; // 继续轮询

                    clearInterval(timer);
                    const result = await this.contract.getConsensusResult(taskId);
                    resolve({
                        finalDecision: result.finalDecision,
                        acceptRatio:   Number(result.acceptRatio),
                        validReveals:  Number(result.validReveals),
                        taskStatus:    status,
                        onchain:       true
                    });
                } catch (err) {
                    // 网络抖动，继续轮询
                }
            }, this.pollIntervalMs);
        });
    }
}

module.exports = { OnchainConsensusWatcher };
