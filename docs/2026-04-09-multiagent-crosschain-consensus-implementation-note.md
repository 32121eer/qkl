# Multi-Agent 跨链协商方案说明

## 1. 文档目的

本文档基于仓库根目录的 `multiagent_crosschain_consensus.md`，结合当前项目已实现的 Fabric <-> FISCO-BCOS 跨链 Demo、查询会话状态机、query-proof 原型和轻客户端校验链路，说明以下内容：

1. 该方案在本项目中的推荐实现过程。
2. 方案落地时最关键的技术难点。
3. 每个难点在当前代码结构下的可行解决方案。
4. 为什么建议先做说明和分阶段演进，而不是直接一次性改成“完整多 Agent 网络”。

本文档只做设计说明，不直接实现代码。

---

## 2. 当前项目的真实基线

在讨论多 Agent 方案前，必须先明确当前项目的真实运行基线，否则后续实现会走偏。

### 2.1 当前实际在跑的核心链路

当前系统不是“多中继共识网络”，而是“单 Relayer 编排 + 双链轻验证 + Demo 可视化”：

- Fabric 侧通过 JavaScript 链码 `fabric-chaincode/gateway_cc/lib/gateway.js` 发起和接收跨链消息。
- FISCO 侧通过 `fisco-bcos/console/contracts/solidity/GatewayAir.sol` 发起和接收跨链消息。
- `fabric-chaincode/Relayer/relayer.js` 负责监听双链事件、顺序补齐区块头、调用目标链接收接口。
- `fabric-chaincode/Relayer/demo/broker/query_broker.js` 负责跨链查询流程编排。
- `fabric-chaincode/Relayer/demo/session/query_session_service.js` 维护查询会话状态机。
- `fabric-chaincode/Relayer/demo/query/` 已经具备 query object、commitment、proof bundle、VerifyQuery 的原型实现。
- `demo-ui/src/pages/AppQueryPage.jsx` 已经可以展示查询会话进度和 query-proof 摘要。

### 2.2 当前链路的本质

当前实现已经具备多 Agent 方案最重要的“骨架”，但还没有多 Agent 的“决策层”：

- 已有“观察层”：`fabric_monitor.js`、`fisco_bcos_monitor.js`
- 已有“执行层”：`message_handler.js`
- 已有“编排层”：`query_broker.js`
- 已有“状态层”：`query_session_service.js`
- 已有“证据层”：`query_proof_builder.js`、`query_verifier.js`
- 已有“展示层”：`AppQueryPage.jsx`、`/demo/app/query/*`

换句话说，本项目现在缺的不是跨链主流程，而是：

- 多 Agent 身份抽象
- 多轮协商协议
- 协商结果聚合与提交规则
- 信誉/仲裁/惩罚机制
- 面向多 Agent 的事件、证据、审计模型

### 2.3 当前应以哪套链码为基线

当前建议以如下组件作为后续实现基线：

- Fabric 网关链码：`fabric-chaincode/gateway_cc/lib/gateway.js`
- FISCO 网关合约：`fisco-bcos/console/contracts/solidity/GatewayAir.sol`
- Relayer 主流程：`fabric-chaincode/Relayer/relayer.js`
- Demo 查询编排：`fabric-chaincode/Relayer/demo/broker/query_broker.js`

不建议把 `fabric-chaincode/my-chain-code/gateway_cc/gateway_cc.go` 作为主线继续扩展。它更适合看作早期实验版本，而当前 Demo、文档和 query-proof 原型都已经与 JavaScript 链码主线对齐。

---

## 3. `multiagent_crosschain_consensus.md` 在本项目中的含义

根目录方案文档的核心思想不是“再加几个监听进程”，而是把当前单中继的单点决策，升级为“多 Agent 协商后再提交目标链”的架构。

如果映射到本项目，可以理解为把当前线性流程：

`监听事件 -> 补区块头 -> 构造消息 -> 直接提交目标链 -> 等回执`

改造成：

`监听事件 -> 形成跨链任务 -> 多 Agent 各自取证/验证 -> 协商收敛 -> 生成聚合结论 -> 由提交 Agent 上链 -> 记录信誉与审计数据`

### 3.1 角色映射

结合现有代码，建议把多 Agent 先设计成逻辑角色，而不是一开始就做分布式独立节点。

| 多 Agent 角色 | 在当前项目中的职责映射 | 推荐首个落点 |
|---|---|---|
| Monitor Agent | 监听双链新区块和跨链事件 | `fabric_monitor.js` / `fisco_bcos_monitor.js` |
| Evidence Agent | 提取 header、payload、query-proof、receipt 等证据 | `block_header_extractor.js` / `demo/query/*` |
| Verifier Agent | 对消息合法性、header 连续性、proof 一致性做独立验证 | 新增 `demo/agents/verifier_agent.js` |
| Coordinator Agent | 组织多轮协商、收集投票、输出最终提案 | 新增 `demo/agents/coordinator_agent.js` |
| Submitter Agent | 负责最终向目标链提交 receive/receiveLite | 基于 `message_handler.js` 封装 |
| Arbitration Agent | 当分歧无法收敛时参与仲裁 | 后续新增，不建议首版就实现完整自治 |

### 3.2 与现有 query-proof 原型的关系

本项目已经在查询流程里实现了一个非常重要的前置能力：

- 查询对象 `Q`
- 承诺 `C_Q`
- 证明包 `Π_Q`
- `VerifyQuery`

这意味着多 Agent 协商不需要从零开始“证明化”。更合理的做法是：

1. 继续沿用 query-proof 的证据封装思路。
2. 把单份 proof 扩展成“多 Agent 对同一证据的独立判定结果”。
3. 将最终协商结果视为一个更高层的 `consensus proof / negotiation record`。

所以，多 Agent 方案不是替换 query-proof，而是建立在 query-proof 和 header 校验链路之上。

---

## 4. 推荐实现过程

## 4.1 总体原则

对当前仓库，最稳妥的路线不是一步到位做“去中心化多 Agent 网络”，而是分三层演进：

1. 先做“单进程内多 Agent 逻辑化模拟”。
2. 再做“多轮协商、信誉、仲裁”的协议层。
3. 最后视需要做“多实例部署、链上登记、经济激励”。

原因很直接：

- 当前 Demo 的 UI、API、Session、EventStore 已经比较稳定。
- 直接改成多实例网络会同时引入并发、时序、幂等、配置、观测五类复杂度。
- 如果先在单进程内把角色、证据、协商、聚合流程跑通，后续拆成独立 Agent 才有边界。

---

## 4.2 Phase 0：冻结现有单 Relayer 主流程，补齐协议抽象边界

### 目标

在不改变当前业务行为的前提下，为多 Agent 接入准备稳定接口。

### 需要做的事情

1. 从 `query_broker.js` 中抽出“跨链任务对象”。
2. 抽出统一的 `evidence bundle` 结构，包含：
   - source chain
   - source block/header
   - source tx hash
   - payload hash
   - query object
   - proof bundle
   - relay receipt
3. 给 `RelayFacade` 和 `EventStore` 增加“协商事件”类型。
4. 给 `QuerySession` 增加协商相关字段，但先不改变 UI 主流程。

### 推荐新增的数据结构

```json
{
  "taskId": "cc_task_xxx",
  "taskType": "QUERY_RESPONSE_RELAY",
  "sourceChain": "FABRIC_NET_01",
  "targetChain": "FISCO_NET_01",
  "evidenceBundle": {
    "sourceHeader": {},
    "sourceHeaderHash": "0x...",
    "payloadHash": "0x...",
    "queryProof": {},
    "receipts": []
  },
  "negotiation": {
    "status": "PENDING",
    "round": 0,
    "proposalId": null,
    "agentOpinions": []
  }
}
```

### 对应改造点

- `fabric-chaincode/Relayer/demo/broker/query_broker.js`
- `fabric-chaincode/Relayer/demo/session/query_session_model.js`
- `fabric-chaincode/Relayer/demo/session/query_session_service.js`
- `fabric-chaincode/Relayer/demo/event_store.js`

### 为什么这是第一步

因为当前 `QueryBroker.run()` 仍然是强线性的。如果不先把“任务”和“证据”抽象出来，后面多 Agent 只能硬插在函数内部，代码会迅速失控。

---

## 4.3 Phase 1：在单进程中引入逻辑多 Agent

### 目标

先不做独立进程/独立网络，只在 Relayer Demo 内部把单一决策拆成多个 Agent 的独立判断。

### 推荐实现方式

新增一个 Agent Runtime 层，例如：

- `fabric-chaincode/Relayer/demo/agents/agent_registry.js`
- `fabric-chaincode/Relayer/demo/agents/base_agent.js`
- `fabric-chaincode/Relayer/demo/agents/monitor_agent.js`
- `fabric-chaincode/Relayer/demo/agents/verifier_agent.js`
- `fabric-chaincode/Relayer/demo/agents/coordinator_agent.js`
- `fabric-chaincode/Relayer/demo/agents/submitter_agent.js`

### 建议运行模式

当前阶段每个 Agent 仍运行在同一 Node.js 进程中，但必须满足：

1. 每个 Agent 有独立输入输出。
2. 每个 Agent 对同一任务独立给出 verdict。
3. Coordinator 只能读取 Agent 输出，不能直接篡改原始证据。
4. 最终提交动作由 Submitter Agent 单独执行。

### 协商前的最小 verdict 模型

```json
{
  "agentId": "verifier-fabric-01",
  "taskId": "cc_task_xxx",
  "decision": "APPROVE",
  "confidence": 0.92,
  "checks": {
    "headerSequential": true,
    "payloadMatched": true,
    "queryProofValid": true,
    "targetMethodAllowed": true
  },
  "reasons": [
    "source header already verified",
    "query proof passes VerifyQuery"
  ],
  "generatedAt": "2026-04-09T00:00:00.000Z"
}
```

### 对应改造点

- `query_broker.js` 不再直接“自己判断后提交”，而是把任务交给 Agent Runtime。
- `message_handler.js` 只保留提交能力，不承担最终决策。
- `api_server.js` 和 `AppQueryPage.jsx` 增加“协商状态摘要”展示。

### 本阶段交付结果

即便系统仍是单进程，也已经从“单体逻辑”变成“多角色协商式架构”。这一步完成后，后续是否拆成多个真实 Agent 实例，已经只是部署问题，不再是架构问题。

---

## 4.4 Phase 2：引入多轮协商协议

### 目标

把“多个 verdict 做一次多数表决”升级成 `multiagent_crosschain_consensus.md` 里提出的“多轮协商与渐进式共识”。

### 协商过程建议

对于一个跨链任务，Coordinator 组织如下流程：

1. Round 0：收集所有 Agent 的初始 verdict。
2. 识别分歧点：
   - header 不一致
   - query-proof 校验结果不一致
   - payload 语义判断不一致
   - 提交条件不一致
3. 生成 revised proposal：
   - 要么补证据
   - 要么补等待时间
   - 要么降级为只做观察不提交
4. 进入下一轮协商。
5. 达到阈值后形成 Final Proposal。
6. 交由 Submitter Agent 执行。

### 适合当前项目的分歧类型

本项目里分歧不应一开始就做自然语言大模型式“自由协商”，而应先做结构化分歧：

- `HEADER_GAP`
- `HEADER_HASH_MISMATCH`
- `QUERY_PROOF_FAILED`
- `TIMEOUT_BUT_LATE_SUCCESS_POSSIBLE`
- `PAYLOAD_SCHEMA_INVALID`
- `TARGET_CHAIN_UNAVAILABLE`

### 推荐新增模块

- `fabric-chaincode/Relayer/demo/negotiation/negotiation_protocol.js`
- `fabric-chaincode/Relayer/demo/negotiation/proposal_builder.js`
- `fabric-chaincode/Relayer/demo/negotiation/disagreement_analyzer.js`

### 本阶段最重要的限制

不要一上来引入 LLM 生成修正提案。第一版应以规则驱动为主，因为当前项目的链路是确定性系统，分歧来源主要是证据不全、时序不一致、校验失败，而不是开放语义协商。

---

## 4.5 Phase 3：把协商结果映射回当前跨链提交链路

### 目标

让多 Agent 的最终结论真正控制 `receiveLite/Receive` 的调用，而不是只停留在 Demo 展示。

### 落地方式

当前项目里，真正执行跨链提交的是 `MessageHandler.relayMessage()`。因此建议：

1. `relayMessage()` 改为只接受 `finalProposal`。
2. `finalProposal` 必须携带：
   - 聚合 verdict
   - 已签名或已确认的 Agent 意见摘要
   - 使用的证据版本
   - 最终提交理由
3. 目标链接收交易成功后，把提交结果回写到会话与协商记录中。

### 推荐的最终提案结构

```json
{
  "proposalId": "proposal_xxx",
  "taskId": "cc_task_xxx",
  "finalDecision": "COMMIT",
  "rounds": 2,
  "quorum": {
    "required": 3,
    "approved": 3,
    "rejected": 1
  },
  "evidenceRef": {
    "sourceHeaderHash": "0x...",
    "payloadHash": "0x...",
    "queryCommitment": "0x..."
  },
  "supportingAgents": [
    "verifier-01",
    "verifier-02",
    "coordinator-01"
  ]
}
```

### 链侧改造建议

首版不建议马上要求链码或合约验证完整多 Agent 结果。更合适的路线是：

1. 先把聚合结果记录到 Demo API / Session / EventStore。
2. 第二步把摘要附加进 payload 或 metadata。
3. 第三步再考虑目标链如何验证门限签名或协商摘要。

原因是当前 Fabric/FISCO 接口主要面向“单次接收”，还没有专门的共识结果验证接口。如果首版就强行下沉，会同时卡在接口设计和链上 gas / world-state 结构上。

---

## 4.6 Phase 4：引入信誉系统与仲裁机制

### 目标

把方案文档中的“动态角色分配”和“信誉驱动选择”落到当前项目。

### 推荐做法

初版信誉先放在 Relayer Demo 的持久层，不要一开始上链。

推荐新增：

- `demo/store/agent_reputation_store.js`
- `demo/agents/reputation_service.js`
- `demo/negotiation/arbitration_service.js`

信誉分可以先按以下维度计算：

1. 历史判断是否与最终提交结果一致
2. 是否经常超时
3. 是否经常提供无效证据
4. 是否与其他 Agent 呈现异常高相关投票模式

### 角色选择策略

对于每个跨链任务，不是固定全部 Agent 都参与，而是：

1. 先筛选具备能力的 Agent
2. 再按信誉排序
3. 再按多样性约束去重
4. 最后组成当轮协商组

这部分与根目录方案文档完全一致，但要注意在当前项目里的真实限制：

- 现阶段 Agent 数量不会很多
- 冷启动时信誉样本不足
- 全量动态调度可能导致调试困难

所以建议先做“半动态”：

- Coordinator 固定
- Verifier 组半动态
- Submitter 固定单一执行器

---

## 4.7 Phase 5：经济激励与链上登记

### 目标

把研究方案里“激励相容、质押、惩罚”的部分补齐。

### 现实判断

这部分对当前仓库不是第一优先级，也不是短期可稳定交付的内容。

原因有三个：

1. 当前项目是跨链 Demo，不是 Agent 经济网络。
2. Fabric 和 FISCO 都还没有为 Agent 注册、质押、惩罚准备专门的合约/链码结构。
3. 如果协商协议本身还未稳定，先做经济层只会放大设计返工。

### 推荐顺序

先做：

- 协商记录可审计
- 信誉分可计算
- 仲裁可触发

再考虑：

- Agent 注册表
- 质押与罚没
- 门限签名证明
- 链上奖励结算

---

## 5. 本项目中的端到端实现流程示例

以下以当前最适合验证多 Agent 方案的场景为例：

`FISCO 发起果园批次查询 -> Fabric 查询数据 -> 返回 FISCO`

### 现有流程

```text
UI /app-query
  -> POST /demo/app/query/request
  -> QueryBroker.run(queryId)
  -> triggerOrchardQueryRequest()
  -> waitForRelayEvent(FISCO_TO_FABRIC)
  -> getOrchardRecord()
  -> buildQueryProofArtifacts()
  -> triggerOrchardQueryResponse()
  -> waitForRelayEvent(FABRIC_TO_FISCO)
  -> session COMPLETED
```

### 引入多 Agent 后的目标流程

```text
UI /app-query
  -> 创建 QuerySession
  -> QueryBroker 创建 CrossChainTask
  -> Monitor Agent 收集源链事件
  -> Evidence Agent 提取 header / payload / query-proof
  -> 多个 Verifier Agent 各自执行校验
  -> Coordinator Agent 组织多轮协商
  -> 形成 FinalProposal
  -> Submitter Agent 调用 message_handler 上链
  -> 回写 session / negotiation / proof card / reputation
```

### 该流程最适合先落地的原因

因为它天然具备：

- 明确的业务对象：`orchardBatchId`
- 明确的查询返回值
- 已有 `query-proof`
- 已有 Session 状态机
- 已有 UI 页面展示空间

所以比直接改双向通用消息中继更容易验证多 Agent 协商方案是否成立。

---

## 6. 实现难点与对应解决方案

## 6.1 难点一：当前系统是线性编排，多 Agent 需要并行判定和聚合

### 为什么难

`QueryBroker.run()` 现在是一条线顺着往下执行的。它假设：

- 只有一个决策中心
- 只有一份证据
- 只有一个最终动作

而多 Agent 架构要求：

- 多个 Agent 独立看证据
- 独立产出 verdict
- 协调者不能直接跳过协商
- 最终提交必须基于聚合结果

### 解决方案

先做“任务对象 + Agent Runtime + Proposal”三层抽象，再把 `QueryBroker` 改成编排器。

换句话说，不是直接把多 Agent 代码塞进 `run()`，而是改成：

`QueryBroker -> create task -> dispatch to Agent Runtime -> wait final proposal -> execute commit`

这样能保住现有 Session、API、UI 基本稳定。

---

## 6.2 难点二：双链异构，证据格式无法直接统一

### 为什么难

本项目同时面对：

- Fabric 区块与事件模型
- FISCO 区块与事件模型
- query-proof 原型数据
- receipt / header / payload / callId 等不同格式

如果没有统一证据模型，每个 Agent 都会各自解析链数据，最终很难比较意见差异。

### 解决方案

引入统一 `evidence bundle`，让所有 Agent 只消费标准化后的证据，而不直接操作原始链对象。

最低限度统一以下字段：

- `sourceChain`
- `targetChain`
- `sourceBlockNumber`
- `sourceHeader`
- `sourceHeaderHash`
- `sourceTxHash`
- `payload`
- `payloadHash`
- `queryProof`
- `relayReceipts`

其中 header 提取可继续复用 `block_header_extractor.js`，proof 生成可继续复用 `demo/query/*`。

---

## 6.3 难点三：当前“验证”仍偏轻量，没有完整交易级证明

### 为什么难

无论是当前 Fabric -> FISCO 的 `receiveLite`，还是 query-proof 原型，本质上都还不是完整交易包含性证明或状态 membership proof。

这意味着多 Agent 即便达成一致，也不能自动等价于“密码学终局安全”。

### 解决方案

分两层处理：

1. 协议层承认这一现实：
   - 首版多 Agent 协商结论是“更可信的中继决策”，不是“完全密码学终审”。
2. 工程层逐步升级：
   - 短期：继续依赖 header continuity + query-proof 原型
   - 中期：补更强的 state witness
   - 长期：再考虑完整 Merkle proof 或 zk 证明

这样可以避免因为追求一步到位的强证明而迟迟无法落地。

---

## 6.4 难点四：超时、晚到成功、重复事件会破坏协商一致性

### 为什么难

当前项目已经出现过这类问题，所以 `query_broker.js` 里专门有 `reconcileByRelaySuccess()` 用于处理“超时后晚到成功”。

进入多 Agent 以后，这类问题会更复杂：

- 某些 Agent 先看到失败
- 某些 Agent 后看到成功
- 某轮协商基于旧证据做出拒绝
- 下一轮又因为晚到回执变成可提交

### 解决方案

必须把协商对象建立在“证据版本”上，而不是建立在“瞬时判断”上。

建议：

1. 每次证据更新都生成 `evidenceVersion`
2. Agent verdict 必须标记来源版本
3. Coordinator 只聚合同一 `evidenceVersion` 的意见
4. 若收到新证据，自动开启新一轮协商

这样可以避免“不同时间看到不同事实”的意见被误判成真实分歧。

---

## 6.5 难点五：如何避免把当前 Demo 的 UI/API 一起推翻

### 为什么难

当前 `/app-query` 页面已经围绕如下模型构建：

- `QuerySession`
- `steps`
- `queryProofSummary`
- `queryVerifyStatus`

如果多 Agent 直接引入一套全新数据模型，前端、API、状态存储都会一起重写。

### 解决方案

采用“兼容式扩展”：

- 保留 `QuerySession` 作为主记录对象
- 新增 `negotiationStatus`、`negotiationRounds`、`agentSummary`
- 旧字段继续服务现有 UI
- 新字段只在新面板里展示

也就是：

- 现有页面先继续能看“请求、查询、返回、完成”
- 新增面板再看“本轮由哪些 Agent 参与、谁赞成、谁反对、最后为何提交”

这样用户理解成本最低，回归风险也最低。

---

## 6.6 难点六：信誉系统存在冷启动和共谋识别问题

### 为什么难

方案文档里希望根据能力、信誉和多样性动态选 Agent，但在当前项目里：

- Agent 数量初期很少
- 样本不足
- 很多 Agent 可能由同一进程模拟

这会导致信誉和反共谋在首版很难“真实有效”。

### 解决方案

首版不要把信誉作为强门槛，而应作为弱排序因子。

推荐顺序：

1. 先固定一组 Agent 跑通
2. 开始记录历史表现
3. 再启用信誉排序
4. 最后才启用“多样性约束”和“异常相关性检测”

也就是说，信誉系统要晚于协商系统落地，否则你会在没有数据的情况下做伪动态调度。

---

## 6.7 难点七：链上接口暂不支持“多 Agent 聚合结果验证”

### 为什么难

目前：

- Fabric `Receive()` 关心的是来源 header 是否已验证
- FISCO `receiveLite()` 关心的是 `lightClient.verifyBlockHeader(...)`

它们都不关心“这笔提交是否由 3/4 的 Agent 协商同意”。

### 解决方案

分阶段推进：

1. 首版：链下聚合，链下审计，上链仍走现有接口
2. 第二版：把聚合摘要放进 payload / event metadata
3. 第三版：链上新增 `verifyConsensusResult(...)` 或门限签名校验逻辑

这也是为什么本文档建议先做“说明文档 + 分阶段实现”，而不是直接修改链码和合约接口。

---

## 7. 推荐的模块改造清单

以下是按优先级排序的建议改造点。

### 第一批必须改

- `fabric-chaincode/Relayer/demo/broker/query_broker.js`
- `fabric-chaincode/Relayer/demo/session/query_session_model.js`
- `fabric-chaincode/Relayer/demo/session/query_session_service.js`
- `fabric-chaincode/Relayer/demo/event_store.js`
- `fabric-chaincode/Relayer/demo/api_server.js`
- `demo-ui/src/pages/AppQueryPage.jsx`

### 第二批新增模块

- `fabric-chaincode/Relayer/demo/agents/base_agent.js`
- `fabric-chaincode/Relayer/demo/agents/agent_registry.js`
- `fabric-chaincode/Relayer/demo/agents/verifier_agent.js`
- `fabric-chaincode/Relayer/demo/agents/coordinator_agent.js`
- `fabric-chaincode/Relayer/demo/agents/submitter_agent.js`
- `fabric-chaincode/Relayer/demo/negotiation/negotiation_protocol.js`
- `fabric-chaincode/Relayer/demo/negotiation/proposal_builder.js`
- `fabric-chaincode/Relayer/demo/negotiation/disagreement_analyzer.js`

### 第三批再考虑

- `fabric-chaincode/gateway_cc/lib/gateway.js`
- `fisco-bcos/console/contracts/solidity/GatewayAir.sol`
- Agent reputation / staking / registry 相关链上模块

---

## 8. 建议的实施顺序

如果后续你确认要实现，我建议按下面顺序推进：

1. 先把 `QuerySession` 扩成能承载 negotiation 数据。
2. 在单进程里引入 Agent Runtime 和多个 Verifier Agent。
3. 用现有 `/app-query` 查询流程跑通“多 verdict -> coordinator -> final proposal”。
4. 再让 `message_handler.js` 只接受 `finalProposal` 驱动提交。
5. 再补 UI 协商面板。
6. 最后再做信誉、仲裁和链上聚合摘要。

这是当前仓库里风险最低、回归最可控、可观测性最强的一条路线。

---

## 9. 结论

结合当前项目，`multiagent_crosschain_consensus.md` 最合理的落地方式，不是“推翻现有 Relayer 重写一个多节点系统”，而是：

1. 以现有单 Relayer、QuerySession、query-proof、轻客户端校验为基座；
2. 先把单点决策改造成逻辑多 Agent 协商；
3. 再逐步把协商结果变成真正控制跨链提交的依据；
4. 最后再视需要引入信誉、仲裁、门限签名和经济激励。

对于本项目，最先值得实现的试点场景不是通用跨链消息，而是已经存在 query-proof 基础的 `FISCO -> Fabric -> FISCO` 查询闭环。因为它证据最完整、页面已具备、最容易看清多 Agent 协商到底有没有实际价值。
