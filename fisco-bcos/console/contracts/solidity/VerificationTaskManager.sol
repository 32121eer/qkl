// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.6.10 <0.9.0;

import "./AgentRegistry.sol";

/**
 * @title VerificationTaskManager
 * @dev 链上验证任务协调合约 —— 去中心化 Commit-Reveal 共识的核心
 *
 * 论文对应：
 *   §IV-A  验证任务模型
 *   §IV-B  验证组选择（委托 AgentRegistry）
 *   §IV-E  Commit-Reveal 协议（链上状态机）
 *   §IV-E  加权共识（链上计算）
 *   §IV-G  信誉更新（触发 AgentRegistry）
 *
 * 信任模型：
 *   - Relayer 只负责创建任务和提交证据哈希，不参与共识
 *   - Agent 直接与本合约交互，提交 commit/reveal
 *   - 共识计算完全在链上，任何人可验证
 *   - 超时由区块时间戳强制执行，无需可信第三方
 */
contract VerificationTaskManager {

    // ─── 常量 ───

    uint256 public constant REP_SCALE       = 1000;  // AgentRegistry 信誉精度
    uint256 public constant CONF_SCALE      = 1000;  // 置信度精度（0.700 → 700）
    uint256 public constant THRESHOLD_SCALE = 1000;

    // 默认阶段超时
    uint256 public constant DEFAULT_COMMIT_WINDOW_SEC  = 30;
    uint256 public constant DEFAULT_REVEAL_WINDOW_SEC  = 30;
    uint256 public constant DEFAULT_GLOBAL_TIMEOUT_SEC = 90;

    // ─── 枚举 ───

    enum TaskStatus {
        CREATED,
        COMMITTEE_SELECTED,
        COMMIT_OPEN,
        REVEAL_OPEN,
        CONSENSUS_COMPUTED,
        CONFIRMED,
        REJECTED,
        ARBITRATING,
        TIMEOUT
    }

    enum RiskLevel { NORMAL, CRITICAL }

    // ─── 数据结构 ───

    struct Task {
        string   taskId;
        string   queryId;
        string   sourceChain;
        string   targetChain;
        RiskLevel risk;
        uint256  deadline;        // 全局超时时间戳
        uint256  commitDeadline;  // Commit 阶段截止
        uint256  revealDeadline;  // Reveal 阶段截止
        bytes32  evidenceHash;    // 链下 evidence bundle 的 SHA-256
        TaskStatus status;
        uint256  groupSize;       // 实际委员会大小
        uint256  threshold;       // 共识阈值 ×1000，如 700 = 0.70
        bool     arbitrationDone;
    }

    struct CommitEntry {
        bytes32  commitHash;
        uint256  submittedAt;
        bool     exists;
    }

    struct RevealEntry {
        string   judgment;    // "APPROVE" / "REJECT" / "QUESTION"
        uint256  confidence;  // 0-1000
        bytes32  nonce;
        bool     valid;       // hash 校验通过
    }

    struct ConsensusResult {
        string   finalDecision;  // "CONFIRMED" / "REJECTED" / "ARBITRATING" / "TIMEOUT"
        uint256  approveWeight;
        uint256  rejectWeight;
        uint256  acceptRatio;    // ×1000
        uint256  validReveals;
        uint256  computedAt;
    }

    struct AgentOutcome {
        string  agentId;
        bool    aligned;
        uint256 confidence;
        uint256 latencyMs;
    }

    // ─── 状态变量 ───

    address        public admin;
    AgentRegistry  public agentRegistry;

    mapping(string => Task)             public tasks;
    mapping(string => string[])         public taskCommittees;   // taskId → agentId[]
    mapping(string => mapping(string => CommitEntry))  public commits;   // taskId → agentId → commit
    mapping(string => mapping(string => RevealEntry))  public reveals;   // taskId → agentId → reveal
    mapping(string => ConsensusResult)  public consensusResults;

    string[] public taskIds;

    // ─── 事件 ───

    event TaskCreated(
        string indexed taskId,
        string queryId,
        string risk,
        bytes32 evidenceHash,
        uint256 deadline
    );

    event CommitteeAssigned(
        string indexed taskId,
        string[] agentIds,
        uint256 seed,
        uint256 commitDeadline
    );

    event CommitSubmitted(
        string indexed taskId,
        string indexed agentId,
        bytes32 commitHash,
        uint256 submittedAt
    );

    event RevealPhaseOpened(
        string indexed taskId,
        uint256 revealDeadline
    );

    event RevealSubmitted(
        string indexed taskId,
        string indexed agentId,
        string judgment,
        uint256 confidence
    );

    event ConsensusFinalized(
        string indexed taskId,
        string finalDecision,
        uint256 acceptRatio,
        uint256 validReveals
    );

    event TaskStatusChanged(
        string indexed taskId,
        TaskStatus oldStatus,
        TaskStatus newStatus
    );

    event AgentSlashed(
        string indexed taskId,
        string indexed agentId,
        string reason
    );

    // ─── 修饰器 ───

    modifier onlyAdmin() {
        require(msg.sender == admin, "Only admin");
        _;
    }

    modifier taskExists(string memory taskId) {
        require(bytes(tasks[taskId].taskId).length > 0, "Task not found");
        _;
    }

    modifier inStatus(string memory taskId, TaskStatus expected) {
        require(tasks[taskId].status == expected, "Invalid task status");
        _;
    }

    // ─── 构造函数 ───

    constructor(address _agentRegistry) {
        admin = msg.sender;
        agentRegistry = AgentRegistry(_agentRegistry);
    }

    // ─── 任务创建（Relayer 调用）───

    /**
     * @dev Relayer 提交跨链任务，触发委员会选择
     * @param taskId      唯一任务 ID（如 "cc_task_<queryId>"）
     * @param queryId     查询 ID
     * @param sourceChain 源链标识
     * @param targetChain 目标链标识
     * @param riskStr     "NORMAL" 或 "CRITICAL"
     * @param evidenceHash 链下 evidence bundle 的哈希（供 agent 验证完整性）
     */
    function createTask(
        string memory taskId,
        string memory queryId,
        string memory sourceChain,
        string memory targetChain,
        string memory riskStr,
        bytes32 evidenceHash
    ) public onlyAdmin {
        require(bytes(tasks[taskId].taskId).length == 0, "Task already exists");

        RiskLevel risk = _parseRisk(riskStr);
        uint256 groupSize  = risk == RiskLevel.CRITICAL ? 7 : 5;
        uint256 threshold  = risk == RiskLevel.CRITICAL ? 750 : 700;  // ×1000
        uint256 now_       = block.timestamp;
        uint256 deadline   = now_ + DEFAULT_GLOBAL_TIMEOUT_SEC;

        tasks[taskId] = Task({
            taskId:          taskId,
            queryId:         queryId,
            sourceChain:     sourceChain,
            targetChain:     targetChain,
            risk:            risk,
            deadline:        deadline,
            commitDeadline:  0,
            revealDeadline:  0,
            evidenceHash:    evidenceHash,
            status:          TaskStatus.CREATED,
            groupSize:       groupSize,
            threshold:       threshold,
            arbitrationDone: false
        });
        taskIds.push(taskId);

        emit TaskCreated(taskId, queryId, riskStr, evidenceHash, deadline);

        // 立即触发委员会选择
        _selectCommittee(taskId, groupSize);
    }

    // ─── 委员会选择（内部）───

    function _selectCommittee(string memory taskId, uint256 groupSize) internal {
        Task storage task = tasks[taskId];

        // 委托 AgentRegistry 的加权随机选择
        string[] memory selected = agentRegistry.selectCommittee(
            taskId,
            AgentRegistry.AgentRole.VERIFIER,
            groupSize,
            task.risk == RiskLevel.CRITICAL ? "CRITICAL" : "NORMAL"
        );

        taskCommittees[taskId] = selected;

        uint256 commitDeadline = block.timestamp + DEFAULT_COMMIT_WINDOW_SEC;
        task.commitDeadline = commitDeadline;
        task.status = TaskStatus.COMMIT_OPEN;

        // AgentRegistry 记录委员会以防重选
        agentRegistry.finalizeCommittee(taskId);

        emit CommitteeAssigned(taskId, selected, 0, commitDeadline);
        emit TaskStatusChanged(taskId, TaskStatus.CREATED, TaskStatus.COMMIT_OPEN);
    }

    // ─── Commit 阶段（Agent 直接调用）───

    /**
     * @dev Agent 提交加密承诺
     *      commit = keccak256(abi.encodePacked(judgment, confidence, nonce))
     *      Agent 通过订阅 CommitteeAssigned 事件得知被选中
     */
    function submitCommit(
        string memory taskId,
        string memory agentId,
        bytes32 commitHash
    ) public taskExists(taskId) {
        Task storage task = tasks[taskId];
        require(task.status == TaskStatus.COMMIT_OPEN, "Not in commit phase");
        require(block.timestamp <= task.commitDeadline, "Commit deadline passed");
        require(_inCommittee(taskId, agentId), "Agent not in committee");
        require(!commits[taskId][agentId].exists, "Already committed");

        commits[taskId][agentId] = CommitEntry({
            commitHash:  commitHash,
            submittedAt: block.timestamp,
            exists:      true
        });

        emit CommitSubmitted(taskId, agentId, commitHash, block.timestamp);
    }

    /**
     * @dev 任何人可在 commit deadline 后触发进入 reveal 阶段
     *      （消除对 Relayer 驱动状态转换的依赖）
     */
    function openRevealPhase(string memory taskId) public taskExists(taskId) {
        Task storage task = tasks[taskId];
        require(task.status == TaskStatus.COMMIT_OPEN, "Not in commit phase");
        require(
            block.timestamp > task.commitDeadline ||
            _allCommitted(taskId),
            "Commit phase still open"
        );

        // 标记缺席者（信誉惩罚在 finalizeConsensus 中处理）
        _markAbsentCommitters(taskId);

        uint256 revealDeadline = block.timestamp + DEFAULT_REVEAL_WINDOW_SEC;
        task.revealDeadline = revealDeadline;
        task.status = TaskStatus.REVEAL_OPEN;

        emit RevealPhaseOpened(taskId, revealDeadline);
        emit TaskStatusChanged(taskId, TaskStatus.COMMIT_OPEN, TaskStatus.REVEAL_OPEN);
    }

    // ─── Reveal 阶段（Agent 直接调用）───

    /**
     * @dev Agent 揭示判断，合约链上验证与 commit 哈希一致
     * @param judgment   "APPROVE" / "REJECT" / "QUESTION"
     * @param confidence 0-1000（对应论文 0.0-1.0）
     * @param nonce      随机数（与 commit 时相同）
     */
    function submitReveal(
        string memory taskId,
        string memory agentId,
        string memory judgment,
        uint256 confidence,
        bytes32 nonce
    ) public taskExists(taskId) {
        Task storage task = tasks[taskId];
        require(task.status == TaskStatus.REVEAL_OPEN, "Not in reveal phase");
        require(block.timestamp <= task.revealDeadline, "Reveal deadline passed");
        require(_inCommittee(taskId, agentId), "Agent not in committee");
        require(commits[taskId][agentId].exists, "No commit found");
        require(!reveals[taskId][agentId].valid, "Already revealed");

        // 链上验证 commit 哈希：keccak256(judgment ‖ confidence ‖ nonce)
        bytes32 expected = keccak256(abi.encodePacked(judgment, confidence, nonce));
        require(expected == commits[taskId][agentId].commitHash, "Reveal does not match commit");

        reveals[taskId][agentId] = RevealEntry({
            judgment:   judgment,
            confidence: confidence,
            nonce:      nonce,
            valid:      true
        });

        emit RevealSubmitted(taskId, agentId, judgment, confidence);
    }

    // ─── 共识计算（任何人可触发）───

    /**
     * @dev 在 reveal deadline 后任何人可调用此函数触发链上共识
     *      w_i = reputation_i × confidence_i
     *      ratio = Σ(w_i | APPROVE) / (Σ(w_i | APPROVE) + Σ(w_i | REJECT))
     *      若 ratio ≥ threshold → CONFIRMED；≤ (1-threshold) → REJECTED；否则 ARBITRATING
     */
    function finalizeConsensus(string memory taskId) public taskExists(taskId) {
        Task storage task = tasks[taskId];
        require(
            task.status == TaskStatus.REVEAL_OPEN,
            "Not in reveal phase"
        );
        require(
            block.timestamp > task.revealDeadline || _allRevealed(taskId),
            "Reveal phase still open"
        );

        // 超时检查
        if (block.timestamp > task.deadline) {
            _setStatus(taskId, TaskStatus.TIMEOUT);
            emit ConsensusFinalized(taskId, "TIMEOUT", 0, 0);
            return;
        }

        string[] storage committee = taskCommittees[taskId];
        uint256 approveWeight = 0;
        uint256 rejectWeight  = 0;
        uint256 validReveals  = 0;

        AgentOutcome[] memory outcomes = new AgentOutcome[](committee.length);

        for (uint i = 0; i < committee.length; i++) {
            string memory agentId = committee[i];
            RevealEntry storage rev = reveals[taskId][agentId];

            if (!rev.valid) {
                // 沉默攻击：提交了 commit 但未揭示 → 重度惩罚
                if (commits[taskId][agentId].exists) {
                    emit AgentSlashed(taskId, agentId, "silent_revealer");
                }
                continue;
            }

            validReveals++;

            // 读取链上信誉（AgentRegistry，精度 ×1000）
            (uint256 rep, ) = agentRegistry.getAgentReputation(agentId);
            // w_i = rep × confidence（两者均 ×1000，结果 ×10^6，后续归一化）
            uint256 weight = rep * rev.confidence;

            if (_strEq(rev.judgment, "APPROVE")) {
                approveWeight += weight;
            } else if (_strEq(rev.judgment, "REJECT")) {
                rejectWeight += weight;
            }
            // QUESTION 票不计入正反双方权重
        }

        // 最小有效揭示数检查
        uint256 minReveals = task.groupSize / 2 + 1;
        if (validReveals < minReveals) {
            _setStatus(taskId, TaskStatus.ARBITRATING);
            emit ConsensusFinalized(taskId, "ARBITRATING", 0, validReveals);
            _triggerReputationUpdates(taskId, "ARBITRATING", committee);
            return;
        }

        uint256 total = approveWeight + rejectWeight;
        uint256 acceptRatio = total > 0
            ? (approveWeight * THRESHOLD_SCALE) / total
            : 0;

        string memory finalDecision;
        TaskStatus    nextStatus;

        if (acceptRatio >= task.threshold) {
            finalDecision = "CONFIRMED";
            nextStatus    = TaskStatus.CONFIRMED;
        } else if (acceptRatio <= (THRESHOLD_SCALE - task.threshold)) {
            finalDecision = "REJECTED";
            nextStatus    = TaskStatus.REJECTED;
        } else {
            finalDecision = "ARBITRATING";
            nextStatus    = TaskStatus.ARBITRATING;
        }

        consensusResults[taskId] = ConsensusResult({
            finalDecision: finalDecision,
            approveWeight: approveWeight,
            rejectWeight:  rejectWeight,
            acceptRatio:   acceptRatio,
            validReveals:  validReveals,
            computedAt:    block.timestamp
        });

        _setStatus(taskId, nextStatus);
        emit ConsensusFinalized(taskId, finalDecision, acceptRatio, validReveals);

        // 链上触发信誉更新
        _triggerReputationUpdates(taskId, finalDecision, committee);
    }

    // ─── 信誉更新（触发 AgentRegistry）───

    function _triggerReputationUpdates(
        string memory taskId,
        string memory finalDecision,
        string[] storage committee
    ) internal {
        bool taskAccepted = _strEq(finalDecision, "CONFIRMED");

        string[]  memory agentIds    = new string[](committee.length);
        bool[]    memory aligneds    = new bool[](committee.length);
        uint256[] memory confidences = new uint256[](committee.length);
        uint256[] memory latencies   = new uint256[](committee.length);

        for (uint i = 0; i < committee.length; i++) {
            string memory agentId = committee[i];
            RevealEntry storage rev = reveals[taskId][agentId];
            agentIds[i]    = agentId;
            confidences[i] = rev.valid ? rev.confidence : 0;
            latencies[i]   = 0; // 链下延迟数据不可信，此处置0

            if (!rev.valid) {
                aligneds[i] = false;
            } else if (taskAccepted) {
                aligneds[i] = _strEq(rev.judgment, "APPROVE");
            } else {
                aligneds[i] = _strEq(rev.judgment, "REJECT");
            }
        }

        agentRegistry.batchRecordTaskResults(
            taskId,
            agentIds,
            aligneds,
            confidences,
            latencies
        );
    }

    // ─── 超时强制（任何人可调用）───

    /**
     * @dev 全局超时后任何人可将任务标记为 TIMEOUT
     */
    function forceTimeout(string memory taskId) public taskExists(taskId) {
        Task storage task = tasks[taskId];
        require(block.timestamp > task.deadline, "Deadline not reached");
        require(
            task.status != TaskStatus.CONFIRMED &&
            task.status != TaskStatus.REJECTED &&
            task.status != TaskStatus.TIMEOUT,
            "Task already finalized"
        );
        _setStatus(taskId, TaskStatus.TIMEOUT);
        emit ConsensusFinalized(taskId, "TIMEOUT", 0, 0);
    }

    // ─── 查询函数 ───

    function getTask(string memory taskId)
        public view taskExists(taskId)
        returns (Task memory)
    {
        return tasks[taskId];
    }

    function getCommittee(string memory taskId)
        public view
        returns (string[] memory)
    {
        return taskCommittees[taskId];
    }

    function getConsensusResult(string memory taskId)
        public view
        returns (ConsensusResult memory)
    {
        return consensusResults[taskId];
    }

    function getReveal(string memory taskId, string memory agentId)
        public view
        returns (RevealEntry memory)
    {
        return reveals[taskId][agentId];
    }

    function getCommit(string memory taskId, string memory agentId)
        public view
        returns (CommitEntry memory)
    {
        return commits[taskId][agentId];
    }

    // ─── 内部工具 ───

    function _setStatus(string memory taskId, TaskStatus newStatus) internal {
        TaskStatus old = tasks[taskId].status;
        tasks[taskId].status = newStatus;
        emit TaskStatusChanged(taskId, old, newStatus);
    }

    function _inCommittee(string memory taskId, string memory agentId)
        internal view returns (bool)
    {
        string[] storage committee = taskCommittees[taskId];
        for (uint i = 0; i < committee.length; i++) {
            if (_strEq(committee[i], agentId)) return true;
        }
        return false;
    }

    function _allCommitted(string memory taskId) internal view returns (bool) {
        string[] storage committee = taskCommittees[taskId];
        for (uint i = 0; i < committee.length; i++) {
            if (!commits[taskId][committee[i]].exists) return false;
        }
        return true;
    }

    function _allRevealed(string memory taskId) internal view returns (bool) {
        string[] storage committee = taskCommittees[taskId];
        for (uint i = 0; i < committee.length; i++) {
            if (!reveals[taskId][committee[i]].valid) return false;
        }
        return true;
    }

    function _markAbsentCommitters(string memory taskId) internal {
        string[] storage committee = taskCommittees[taskId];
        for (uint i = 0; i < committee.length; i++) {
            string memory agentId = committee[i];
            if (!commits[taskId][agentId].exists) {
                emit AgentSlashed(taskId, agentId, "absent_committer");
            }
        }
    }

    function _parseRisk(string memory riskStr) internal pure returns (RiskLevel) {
        return _strEq(riskStr, "CRITICAL") ? RiskLevel.CRITICAL : RiskLevel.NORMAL;
    }

    function _strEq(string memory a, string memory b) internal pure returns (bool) {
        return keccak256(abi.encodePacked(a)) == keccak256(abi.encodePacked(b));
    }
}
