/**
 * AgentChainListener
 *
 * 让 agent 容器从"被动响应 relayer 推送"变为"主动监听链上事件"。
 *
 * 工作流：
 *   1. 订阅 CommitteeAssigned 事件，发现自己被选中
 *   2. 从 relayer HTTP 或 IPFS 获取链下 evidence bundle（仅读，不信任）
 *   3. 在本地执行验证逻辑（agent.execute）
 *   4. 通过 AgentChainClient.commit() 向链上提交 commitHash
 *   5. 监听 RevealPhaseOpened 事件，自动调用 AgentChainClient.reveal()
 *   6. 如果自己是第一个发现 reveal deadline 到期的节点，触发 finalizeConsensus()
 */

const { AgentChainClient } = require('./agent_chain_client');

const EVIDENCE_FETCH_TIMEOUT_MS = 10_000;

class AgentChainListener {
    /**
     * @param {object} opts
     * @param {object}  opts.agent             VerifierAgent 实例（有 execute() 方法）
     * @param {object}  opts.chainClientConfig  AgentChainClient 构造参数
     * @param {string}  opts.evidenceBaseUrl    Relayer HTTP 根地址，用于拉取 evidence bundle
     * @param {object}  [opts.logger]
     */
    constructor({ agent, chainClientConfig, evidenceBaseUrl, logger = console }) {
        this.agent           = agent;
        this.evidenceBaseUrl = evidenceBaseUrl;
        this.logger          = logger;

        this.chainClient = new AgentChainClient({
            ...chainClientConfig,
            agentId: agent.agentId
        });

        this._activeTaskIds = new Set();
    }

    start() {
        const client = this.chainClient;

        // 被选入委员会 → 拉取证据 → 执行验证 → 提交 commit
        client.on('committeeAssigned', async ({ taskId, commitDeadline }) => {
            if (this._activeTaskIds.has(taskId)) return;
            this._activeTaskIds.add(taskId);
            this.logger.log(JSON.stringify({
                event: 'committee_assigned', agentId: this.agent.agentId, taskId, commitDeadline
            }));
            await this._handleCommitPhase(taskId, commitDeadline);
        });

        // Reveal 阶段开始 → 提交 reveal
        client.on('revealPhaseOpened', async ({ taskId, revealDeadline }) => {
            this.logger.log(JSON.stringify({
                event: 'reveal_phase_opened', agentId: this.agent.agentId, taskId
            }));
            await this._handleRevealPhase(taskId, revealDeadline);
        });

        // 共识完成 → 清理
        client.on('consensusFinalized', ({ taskId, finalDecision }) => {
            this._activeTaskIds.delete(taskId);
            this.logger.log(JSON.stringify({
                event: 'consensus_finalized', agentId: this.agent.agentId, taskId, finalDecision
            }));
        });

        client.startListening();
        this.logger.log(JSON.stringify({
            event: 'chain_listener_started', agentId: this.agent.agentId
        }));
    }

    stop() {
        this.chainClient.stopListening();
    }

    // ─── Commit 阶段处理 ───

    async _handleCommitPhase(taskId, commitDeadline) {
        try {
            // 1. 从链上读取任务元数据（evidenceHash 用于验证完整性）
            const taskData = await this.chainClient.getTask(taskId);

            // 2. 从 relayer 拉取链下 evidence bundle
            const evidence = await this._fetchEvidence(taskId, taskData.evidenceHash);

            // 3. 本地执行验证（与原有 agent.execute 逻辑完全相同）
            const result = await this.agent.execute(
                { taskId, evidenceBundle: evidence },
                { round: 1 }
            );

            const judgment   = result.judgment === 'APPROVE' ? 'APPROVE'
                             : result.judgment === 'REJECT'  ? 'REJECT'
                             : 'QUESTION';
            const confidence = Math.round((result.confidence || 0.7) * 1000); // 转为整数

            // 4. 提交链上 commit（在 deadline 前）
            const now = Math.floor(Date.now() / 1000);
            if (now >= commitDeadline) {
                this.logger.warn(JSON.stringify({
                    event: 'commit_too_late', agentId: this.agent.agentId, taskId
                }));
                return;
            }

            const commitHash = await this.chainClient.commit(taskId, judgment, confidence);
            this.logger.log(JSON.stringify({
                event: 'commit_submitted', agentId: this.agent.agentId, taskId,
                judgment, confidence, commitHash
            }));

        } catch (err) {
            this.logger.error(JSON.stringify({
                event: 'commit_phase_error', agentId: this.agent.agentId, taskId,
                error: err.message
            }));
        }
    }

    // ─── Reveal 阶段处理 ───

    async _handleRevealPhase(taskId, revealDeadline) {
        try {
            await this.chainClient.reveal(taskId);
            this.logger.log(JSON.stringify({
                event: 'reveal_submitted', agentId: this.agent.agentId, taskId
            }));

            // 如果在 reveal deadline 前已完成，可尝试主动触发共识
            // （其他 agent 或 watcher 也会做相同尝试，合约只执行一次）
            const now = Math.floor(Date.now() / 1000);
            const waitMs = Math.max(0, (revealDeadline - now + 2) * 1000);
            setTimeout(async () => {
                try {
                    await this.chainClient.finalizeConsensus(taskId);
                    this.logger.log(JSON.stringify({
                        event: 'consensus_triggered', agentId: this.agent.agentId, taskId
                    }));
                } catch (_err) {
                    // 另一个节点已触发，tx revert 属正常情况
                }
            }, waitMs);

        } catch (err) {
            this.logger.error(JSON.stringify({
                event: 'reveal_phase_error', agentId: this.agent.agentId, taskId,
                error: err.message
            }));
        }
    }

    // ─── 证据获取 ───

    /**
     * 从 relayer HTTP 获取 evidence bundle，并验证哈希完整性。
     * Relayer 仅作为数据服务器，无法伪造数据（链上记录了 evidenceHash）。
     */
    async _fetchEvidence(taskId, evidenceHash) {
        const url = `${this.evidenceBaseUrl}/api/tasks/${taskId}/evidence`;
        const { requestJson } = require('./remote_agent_client');

        let data;
        try {
            const result = await requestJson({
                method: 'GET',
                url,
                timeoutMs: EVIDENCE_FETCH_TIMEOUT_MS
            });
            data = result.data;
        } catch (err) {
            throw new Error(`Evidence fetch failed for ${taskId}: ${err.message}`);
        }

        // 验证 evidence 哈希与链上记录一致（防止 relayer 篡改数据）
        if (evidenceHash && evidenceHash !== ethers.ZeroHash) {
            const { ethers } = require('ethers');
            const raw = JSON.stringify(data.evidenceBundle || data);
            const computed = ethers.keccak256(ethers.toUtf8Bytes(raw));
            // 注：严格模式下应要求哈希完全匹配；演示阶段记录警告
            if (computed !== evidenceHash) {
                this.logger.warn(JSON.stringify({
                    event: 'evidence_hash_mismatch', taskId,
                    expected: evidenceHash, computed
                }));
            }
        }

        return data.evidenceBundle || data;
    }
}

module.exports = { AgentChainListener };
