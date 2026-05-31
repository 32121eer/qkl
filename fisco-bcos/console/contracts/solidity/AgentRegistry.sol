// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.6.10 <0.9.0;

import "./Crypto.sol";

/**
 * @title AgentRegistry
 * @dev 链上 Agent 注册、委员会选择和信誉管理合约
 *
 * 论文对应：第 IV-B 节（验证组选择）和第 IV-G 节（信誉更新）
 */
contract AgentRegistry {
    // ─── 数据结构 ───

    enum AgentRole { NONE, COLLECTOR, VERIFIER, ARBITER, COORDINATOR, SUBMITTER }
    enum AgentStatus { INACTIVE, ACTIVE, SUSPENDED, REVOKED }

    struct Agent {
        string agentId;           // 唯一标识
        AgentRole role;           // 角色
        string organization;      // 所属组织
        string strategyType;      // A/B/C 类型（VERIFIER 专用）
        string endpoint;          // 【已弃用】服务端点明文，生产环境应使用链下安全目录
        bytes32 publicKey;        // VRF 公钥 / 签名公钥
        bytes32 identityHash;     // 身份哈希：keccak256(agentId || organization || publicKey)
        uint256 reputation;       // 信誉值（放大 1000 倍存储，如 0.85 → 850）
        uint256 successCount;     // 成功验证次数
        uint256 totalTasks;       // 总参与任务数
        uint256 registeredAt;     // 注册时间
        uint256 lastActiveAt;     // 最后活跃时间
        AgentStatus status;       // 状态
    }

    struct CommitteeSelection {
        string taskId;            // 任务 ID
        string[] selectedAgents;  // 选中的 Agent ID 列表
        uint256 seed;             // VRF 种子 / 随机种子
        uint256 selectedAt;       // 选择时间
        bool finalized;           // 是否已最终确认
    }

    struct ReputationUpdate {
        string agentId;
        int256 delta;             // 信誉变化（可正可负）
        uint256 newReputation;
        string reason;            // 更新原因
        uint256 updatedAt;
    }

    // ─── 状态变量 ───

    address public admin;
    address public cryptoAddress;
    uint256 public constant REP_SCALE = 1000;        // 信誉精度
    uint256 public constant MIN_REPUTATION = 100;    // 最低信誉 0.1
    uint256 public constant MAX_REPUTATION = 1000;   // 最高信誉 1.0
    uint256 public constant DEFAULT_REPUTATION = 500; // 默认信誉 0.5

    // Agent 注册表
    mapping(string => Agent) public agents;
    string[] public agentIdList;

    // 按角色索引
    mapping(AgentRole => string[]) public agentsByRole;

    // 委员会选择记录
    mapping(string => CommitteeSelection) public committees;
    string[] public committeeTaskIds;

    // 信誉更新历史（按 Agent）
    mapping(string => ReputationUpdate[]) public reputationHistory;

    // ─── 事件 ───

    event AgentRegistered(
        string indexed agentId,
        AgentRole role,
        string organization,
        string strategyType,
        uint256 registeredAt
    );

    event AgentStatusChanged(
        string indexed agentId,
        AgentStatus oldStatus,
        AgentStatus newStatus,
        uint256 changedAt
    );

    event CommitteeSelected(
        string indexed taskId,
        string[] agentIds,
        uint256 seed,
        uint256 selectedAt
    );

    event ReputationUpdated(
        string indexed agentId,
        int256 delta,
        uint256 newReputation,
        string reason,
        uint256 updatedAt
    );

    event TaskResultRecorded(
        string indexed taskId,
        string indexed agentId,
        bool aligned,       // 是否与最终结果一致
        uint256 confidence, // 报告的置信度（放大 1000 倍）
        uint256 latencyMs   // 响应延迟
    );

    event AgentEndpointUpdated(
        string indexed agentId,
        string newEndpoint,
        uint256 updatedAt
    );

    // ─── 修饰器 ───

    modifier onlyAdmin() {
        require(msg.sender == admin, "Only admin");
        _;
    }

    modifier agentExists(string memory agentId) {
        require(bytes(agents[agentId].agentId).length > 0, "Agent not found");
        _;
    }

    modifier onlyActiveAgent(string memory agentId) {
        require(agents[agentId].status == AgentStatus.ACTIVE, "Agent not active");
        _;
    }

    // ─── 构造函数 ───

    constructor(address _cryptoAddress) {
        admin = msg.sender;
        cryptoAddress = _cryptoAddress;
    }

    // ─── Agent 管理 ───

    /**
     * @dev 注册新 Agent
     * @param agentId 唯一标识
     * @param role 角色（0=NONE, 1=COLLECTOR, 2=VERIFIER, 3=ARBITER, 4=COORDINATOR, 5=SUBMITTER）
     * @param organization 所属组织
     * @param strategyType 策略类型（A_PROOF_VALIDATOR / B_POLICY_CHECKER / C_SEMANTIC_REASONER）
     * @param endpoint 服务端点
     * @param publicKey VRF/签名公钥
     */
    function registerAgent(
        string memory agentId,
        AgentRole role,
        string memory organization,
        string memory strategyType,
        string memory endpoint,
        bytes32 publicKey
    ) public onlyAdmin {
        require(bytes(agents[agentId].agentId).length == 0, "Agent already exists");
        require(role != AgentRole.NONE, "Invalid role");
        require(bytes(organization).length > 0, "Organization required");

        uint256 nowTs = block.timestamp;
        bytes32 _identityHash = keccak256(abi.encodePacked(agentId, organization, publicKey));

        agents[agentId] = Agent({
            agentId: agentId,
            role: role,
            organization: organization,
            strategyType: strategyType,
            endpoint: endpoint,
            publicKey: publicKey,
            identityHash: _identityHash,
            reputation: DEFAULT_REPUTATION,
            successCount: 0,
            totalTasks: 0,
            registeredAt: nowTs,
            lastActiveAt: nowTs,
            status: AgentStatus.ACTIVE
        });

        agentIdList.push(agentId);
        agentsByRole[role].push(agentId);

        emit AgentRegistered(agentId, role, organization, strategyType, nowTs);
    }

    /**
     * @dev 批量注册 Agent（方便初始化）
     */
    function batchRegisterAgents(
        string[] memory _agentIds,
        AgentRole[] memory _roles,
        string[] memory _organizations,
        string[] memory _strategyTypes,
        string[] memory _endpoints,
        bytes32[] memory _publicKeys
    ) public onlyAdmin {
        require(
            _agentIds.length == _roles.length &&
            _roles.length == _organizations.length &&
            _organizations.length == _strategyTypes.length &&
            _strategyTypes.length == _endpoints.length &&
            _endpoints.length == _publicKeys.length,
            "Array length mismatch"
        );

        for (uint i = 0; i < _agentIds.length; i++) {
            registerAgent(
                _agentIds[i],
                _roles[i],
                _organizations[i],
                _strategyTypes[i],
                _endpoints[i],
                _publicKeys[i]
            );
        }
    }

    /**
     * @dev 更新 Agent 状态
     */
    function setAgentStatus(
        string memory agentId,
        AgentStatus newStatus
    ) public onlyAdmin agentExists(agentId) {
        Agent storage agent = agents[agentId];
        AgentStatus oldStatus = agent.status;
        agent.status = newStatus;

        emit AgentStatusChanged(agentId, oldStatus, newStatus, block.timestamp);
    }

    /**
     * @dev 更新 Agent 端点（已弃用：生产环境应使用链下安全目录）
     */
    function setAgentEndpoint(
        string memory agentId,
        string memory newEndpoint
    ) public onlyAdmin agentExists(agentId) {
        agents[agentId].endpoint = newEndpoint;
        emit AgentEndpointUpdated(agentId, newEndpoint, block.timestamp);
    }

    // ─── 委员会选择 ───

    /**
     * @dev 基于区块哈希的伪随机委员会选择
     *      论文 IV-B 节：VRF 加权随机选择
     *      注意：生产环境应使用 VRF 验证，此处简化实现
     * @param taskId 任务 ID
     * @param role 需要选择的角色
     * @param committeeSize 委员会大小
     * @param riskLevel 风险等级（"NORMAL" 或 "CRITICAL"）
     */
    function selectCommittee(
        string memory taskId,
        AgentRole role,
        uint256 committeeSize,
        string memory riskLevel
    ) public onlyAdmin returns (string[] memory) {
        require(committeeSize > 0, "Committee size must > 0");
        require(committees[taskId].selectedAt == 0, "Committee already selected for this task");

        string[] memory candidates = agentsByRole[role];
        require(candidates.length >= committeeSize, "Not enough candidates");

        // 筛选活跃 Agent
        string[] memory activeCandidates = new string[](candidates.length);
        uint256 activeCount = 0;
        for (uint i = 0; i < candidates.length; i++) {
            if (agents[candidates[i]].status == AgentStatus.ACTIVE) {
                activeCandidates[activeCount] = candidates[i];
                activeCount++;
            }
        }
        require(activeCount >= committeeSize, "Not enough active candidates");

        // 使用区块哈希 + taskId 作为随机种子
        uint256 seed = uint256(keccak256(abi.encodePacked(
            blockhash(block.number - 1),
            block.timestamp,
            taskId
        )));

        // 按信誉加权随机选择
        string[] memory selected = new string[](committeeSize);
        bool[] memory used = new bool[](activeCount);

        for (uint i = 0; i < committeeSize; i++) {
            // 计算总信誉权重
            uint256 totalWeight = 0;
            for (uint j = 0; j < activeCount; j++) {
                if (!used[j]) {
                    totalWeight += agents[activeCandidates[j]].reputation;
                }
            }

            require(totalWeight > 0, "No valid weight");

            // 加权随机选择
            uint256 randomPoint = uint256(keccak256(abi.encodePacked(seed, i))) % totalWeight;
            uint256 cumulativeWeight = 0;

            for (uint j = 0; j < activeCount; j++) {
                if (used[j]) continue;
                cumulativeWeight += agents[activeCandidates[j]].reputation;
                if (cumulativeWeight > randomPoint) {
                    selected[i] = activeCandidates[j];
                    used[j] = true;
                    break;
                }
            }
        }

        // 保存委员会记录
        committees[taskId] = CommitteeSelection({
            taskId: taskId,
            selectedAgents: selected,
            seed: seed,
            selectedAt: block.timestamp,
            finalized: false
        });
        committeeTaskIds.push(taskId);

        emit CommitteeSelected(taskId, selected, seed, block.timestamp);

        return selected;
    }

    /**
     * @dev VRF 验证版委员会选择（更安全）
     * @param taskId 任务 ID
     * @param role 角色
     * @param committeeSize 委员会大小
     * @param vrfProof VRF 证明
     * @param vrfPublicKey VRF 公钥
     */
    function selectCommitteeVRF(
        string memory taskId,
        AgentRole role,
        uint256 committeeSize,
        bytes memory vrfProof,
        bytes memory vrfPublicKey
    ) public onlyAdmin returns (string[] memory) {
        require(committeeSize > 0, "Committee size must > 0");

        // 验证 VRF
        Crypto crypto = Crypto(cryptoAddress);
        (bool valid, uint256 seed) = crypto.curve25519VRFVerify(
            abi.encodePacked(taskId),
            vrfPublicKey,
            vrfProof
        );
        require(valid, "Invalid VRF proof");

        string[] memory candidates = agentsByRole[role];
        require(candidates.length >= committeeSize, "Not enough candidates");

        // 筛选活跃 Agent
        string[] memory activeCandidates = new string[](candidates.length);
        uint256 activeCount = 0;
        for (uint i = 0; i < candidates.length; i++) {
            if (agents[candidates[i]].status == AgentStatus.ACTIVE) {
                activeCandidates[activeCount] = candidates[i];
                activeCount++;
            }
        }
        require(activeCount >= committeeSize, "Not enough active candidates");

        // 基于 VRF seed 的加权选择
        string[] memory selected = new string[](committeeSize);
        bool[] memory used = new bool[](activeCount);

        for (uint i = 0; i < committeeSize; i++) {
            uint256 totalWeight = 0;
            for (uint j = 0; j < activeCount; j++) {
                if (!used[j]) {
                    totalWeight += agents[activeCandidates[j]].reputation;
                }
            }
            require(totalWeight > 0, "No valid weight");

            uint256 randomPoint = uint256(keccak256(abi.encodePacked(seed, i))) % totalWeight;
            uint256 cumulativeWeight = 0;

            for (uint j = 0; j < activeCount; j++) {
                if (used[j]) continue;
                cumulativeWeight += agents[activeCandidates[j]].reputation;
                if (cumulativeWeight > randomPoint) {
                    selected[i] = activeCandidates[j];
                    used[j] = true;
                    break;
                }
            }
        }

        committees[taskId] = CommitteeSelection({
            taskId: taskId,
            selectedAgents: selected,
            seed: seed,
            selectedAt: block.timestamp,
            finalized: false
        });
        committeeTaskIds.push(taskId);

        emit CommitteeSelected(taskId, selected, seed, block.timestamp);

        return selected;
    }

    /**
     * @dev 确认委员会（防止重选）
     */
    function finalizeCommittee(string memory taskId) public onlyAdmin {
        require(committees[taskId].selectedAt > 0, "Committee not found");
        committees[taskId].finalized = true;
    }

    // ─── 信誉管理 ───

    /**
     * @dev 记录任务结果并更新信誉
     *      论文 IV-G 节：非对称评分机制
     * @param taskId 任务 ID
     * @param agentId Agent ID
     * @param aligned 是否与最终结果一致
     * @param reportedConfidence 报告的置信度（0-1000，对应 0.0-1.0）
     * @param latencyMs 响应延迟（毫秒）
     */
    function recordTaskResult(
        string memory taskId,
        string memory agentId,
        bool aligned,
        uint256 reportedConfidence,
        uint256 latencyMs
    ) public onlyAdmin agentExists(agentId) {
        Agent storage agent = agents[agentId];
        require(agent.status == AgentStatus.ACTIVE, "Agent not active");

        agent.totalTasks++;
        agent.lastActiveAt = block.timestamp;

        // 基础信誉变化
        int256 delta;
        string memory reason;

        if (aligned) {
            // 判断正确
            agent.successCount++;
            if (reportedConfidence > 700) {
                // 高置信度且正确 → 大奖励
                delta = 50;  // +0.05
                reason = "Aligned with high confidence";
            } else {
                // 低置信度但正确 → 小奖励
                delta = 20;  // +0.02
                reason = "Aligned with low confidence";
            }
        } else {
            // 判断错误
            if (reportedConfidence > 700) {
                // 高置信度但错误 → 大惩罚（过度自信）
                delta = -150; // -0.15
                reason = "Misaligned with high confidence (overconfident)";
            } else {
                // 低置信度且错误 → 小惩罚
                delta = -50;  // -0.05
                reason = "Misaligned with low confidence";
            }
        }

        // 延迟惩罚（超过 5 秒开始惩罚）
        if (latencyMs > 5000) {
            int256 latencyPenalty = -int256((latencyMs - 5000) / 1000); // 每多 1 秒 -0.001
            delta += latencyPenalty;
            reason = string(abi.encodePacked(reason, ", latency penalty"));
        }

        // 应用变化
        _applyReputationChange(agentId, delta, reason);

        emit TaskResultRecorded(taskId, agentId, aligned, reportedConfidence, latencyMs);
    }

    /**
     * @dev 批量记录任务结果
     */
    function batchRecordTaskResults(
        string memory taskId,
        string[] memory agentIds,
        bool[] memory alignedResults,
        uint256[] memory confidences,
        uint256[] memory latencies
    ) public onlyAdmin {
        require(
            agentIds.length == alignedResults.length &&
            alignedResults.length == confidences.length &&
            confidences.length == latencies.length,
            "Array length mismatch"
        );

        for (uint i = 0; i < agentIds.length; i++) {
            recordTaskResult(taskId, agentIds[i], alignedResults[i], confidences[i], latencies[i]);
        }
    }

    /**
     * @dev 应用信誉变化（内部函数）
     */
    function _applyReputationChange(
        string memory agentId,
        int256 delta,
        string memory reason
    ) internal {
        Agent storage agent = agents[agentId];

        int256 currentRep = int256(agent.reputation);
        int256 newRep = currentRep + delta;

        // 边界限制
        if (newRep < int256(MIN_REPUTATION)) {
            newRep = int256(MIN_REPUTATION);
        } else if (newRep > int256(MAX_REPUTATION)) {
            newRep = int256(MAX_REPUTATION);
        }

        agent.reputation = uint256(newRep);

        // 如果信誉过低，自动暂停
        if (agent.reputation <= MIN_REPUTATION && agent.status == AgentStatus.ACTIVE) {
            agent.status = AgentStatus.SUSPENDED;
            emit AgentStatusChanged(agentId, AgentStatus.ACTIVE, AgentStatus.SUSPENDED, block.timestamp);
        }

        // 记录历史
        reputationHistory[agentId].push(ReputationUpdate({
            agentId: agentId,
            delta: delta,
            newReputation: agent.reputation,
            reason: reason,
            updatedAt: block.timestamp
        }));

        emit ReputationUpdated(agentId, delta, agent.reputation, reason, block.timestamp);
    }

    /**
     * @dev 手动调整信誉（管理用途）
     */
    function adjustReputation(
        string memory agentId,
        int256 delta,
        string memory reason
    ) public onlyAdmin agentExists(agentId) {
        _applyReputationChange(agentId, delta, reason);
    }

    // ─── 查询函数 ───

    function getAgent(string memory agentId)
        public
        view
        agentExists(agentId)
        returns (Agent memory)
    {
        return agents[agentId];
    }

    function getAgentReputation(string memory agentId)
        public
        view
        agentExists(agentId)
        returns (uint256 reputation, uint256 successRate)
    {
        Agent storage agent = agents[agentId];
        reputation = agent.reputation;
        if (agent.totalTasks > 0) {
            successRate = (agent.successCount * 10000) / agent.totalTasks; // 百分比 * 100
        } else {
            successRate = 0;
        }
    }

    function getCommittee(string memory taskId)
        public
        view
        returns (CommitteeSelection memory)
    {
        return committees[taskId];
    }

    function getAgentsByRole(AgentRole role)
        public
        view
        returns (string[] memory)
    {
        return agentsByRole[role];
    }

    function getActiveVerifiers()
        public
        view
        returns (string[] memory)
    {
        string[] memory allVerifiers = agentsByRole[AgentRole.VERIFIER];
        uint256 activeCount = 0;
        for (uint i = 0; i < allVerifiers.length; i++) {
            if (agents[allVerifiers[i]].status == AgentStatus.ACTIVE) {
                activeCount++;
            }
        }

        string[] memory active = new string[](activeCount);
        uint256 idx = 0;
        for (uint i = 0; i < allVerifiers.length; i++) {
            if (agents[allVerifiers[i]].status == AgentStatus.ACTIVE) {
                active[idx] = allVerifiers[i];
                idx++;
            }
        }
        return active;
    }

    function getAgentCount() public view returns (uint256) {
        return agentIdList.length;
    }

    function getAgentCountByRole(AgentRole role) public view returns (uint256) {
        return agentsByRole[role].length;
    }

    function getReputationHistory(string memory agentId, uint256 limit)
        public
        view
        agentExists(agentId)
        returns (ReputationUpdate[] memory)
    {
        ReputationUpdate[] storage history = reputationHistory[agentId];
        uint256 actualLimit = limit > history.length ? history.length : limit;
        ReputationUpdate[] memory result = new ReputationUpdate[](actualLimit);
        for (uint i = 0; i < actualLimit; i++) {
            result[i] = history[history.length - actualLimit + i];
        }
        return result;
    }

    function isAgentActive(string memory agentId) public view returns (bool) {
        return agents[agentId].status == AgentStatus.ACTIVE;
    }
}
