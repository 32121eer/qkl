# 可验证跨链查询原型设计文档

## 1. 文档目标

本文档作为配套原型设计说明，负责把研究报告中的三个核心对象：

- `Q`：规范化查询对象
- `C_Q`：查询结果承诺
- `\Pi_Q`：查询结果证明

映射到当前仓库的具体模块、接口、数据结构与最小实现路径。目标不是一次性做完完整论文系统，而是在**尽量少破坏现有 demo 流程**的前提下，做出一个可运行、可展示、可继续演进的研究原型。

## 2. 设计边界

第一版原型只处理以下场景：

- 查询方向：`FISCO -> Fabric`
- 查询对象：`orchardBatchId`
- 查询类型：单键确定性查询
- 证明目标：证明“返回结果是真的”
- 验证位置：先在 relayer / demo API 层实现 proof bundle 生产与校验，再决定是否下沉到链码或合约

第一版不做：

- 不存在性证明
- 范围查询、聚合查询
- 通用 zk proof
- Fabric 世界状态的通用 Merkle proof 引擎

## 3. 现有代码基础

当前项目里已经有几块可直接复用的基础。

### 3.1 Query Session 编排

- [`query_broker.js`](/home/tr/projects/cross-chain/fabric-chaincode/Relayer/demo/broker/query_broker.js)
- [`query_session_service.js`](/home/tr/projects/cross-chain/fabric-chaincode/Relayer/demo/session/query_session_service.js)

这部分已经负责 request -> fetch -> response 的完整状态推进，适合作为 proof 生成与记录的主挂载点。

### 3.2 Relay 与事件观测

- [`relay_facade.js`](/home/tr/projects/cross-chain/fabric-chaincode/Relayer/demo/app/relay_facade.js)
- [`event_store.js`](/home/tr/projects/cross-chain/fabric-chaincode/Relayer/demo/event_store.js)

这部分可以承载 proof 验证结果、proof card 展示数据和会话回溯信息。

### 3.3 目标侧轻客户端雏形

- [`gateway.js`](/home/tr/projects/cross-chain/fabric-chaincode/gateway_cc/lib/gateway.js)
- [`fabric_monitor.js`](/home/tr/projects/cross-chain/fabric-chaincode/Relayer/monitors/fabric_monitor.js)

这部分已经具备“远端 header 提交 + hash 校验”的基础语义，后续可作为 `\Pi_Q` 中 header 可信性的来源。

## 4. 原型核心思路

由于第一版不实现通用世界状态 Merkle proof，原型采用一种**研究型近似实现**：

1. 先把 Fabric 查询结果规范化为 `Q` 与 `value`
2. 绑定查询时刻对应的 source height / source block header
3. 构造一份结构化 `proof bundle`
4. 在目标侧或 demo API 侧执行 `VerifyQuery`
5. 将 `C_Q`、验证结论和 proof 摘要展示到 UI

这意味着第一版更像“proof-aware query prototype”，而不是最终版的通用状态证明引擎。这样的好处是：

- 可以先跑通论文里的对象模型和流程
- 不必一次解决 Fabric 状态树证明难题
- 后续可以逐步把 `state witness` 替换为真正的 membership proof

## 5. 数据模型设计

## 5.1 查询对象 `Q`

建议新增一个独立的规范化函数，生成如下结构：

```json
{
  "chainId": "FABRIC_NET_01",
  "namespace": "orchard",
  "key": "batch:orchard-001",
  "queryType": "single-key-read",
  "codec": "json",
  "context": {
    "channel": "mychannel",
    "chaincode": "gateway_cc",
    "schema": "orchard-record-v1"
  }
}
```

建议放置位置：

- 新增：`fabric-chaincode/Relayer/demo/query/query_object.js`

职责：

- 输入业务参数，如 `orchardBatchId`
- 输出确定性的规范化查询对象
- 保证相同业务查询生成相同 `Q`

## 5.2 查询结果承诺 `C_Q`

建议使用稳定 JSON 序列化后做哈希：

```text
C_Q = sha256(stable_json({
  queryObject: Q,
  sourceHeight,
  sourceStateRoot,
  resultValue,
  meta
}))
```

第一版 `sourceStateRoot` 可先用“source header hash + result snapshot hash”的组合近似承载，后续再替换为真正状态根。

建议放置位置：

- 新增：`fabric-chaincode/Relayer/demo/query/query_commitment.js`

职责：

- 生成 commitment
- 返回 commitment 摘要与输入快照
- 为 UI 和 event store 提供统一字段

## 5.3 查询结果证明 `\Pi_Q`

第一版 proof bundle 建议定义为：

```json
{
  "version": "query-proof-v1",
  "queryObject": {},
  "resultValue": {},
  "sourceChain": "FABRIC_NET_01",
  "sourceHeight": 123,
  "sourceTxId": "abc...",
  "sourceHeader": {},
  "sourceHeaderHash": "0x...",
  "stateWitness": {
    "type": "record-snapshot",
    "recordHash": "0x...",
    "sourceFunction": "GetOrchardRecord",
    "note": "prototype witness, not full merkle proof"
  },
  "meta": {
    "generatedAt": "2026-03-10T00:00:00.000Z",
    "schema": "orchard-record-v1"
  },
  "commitment": "0x..."
}
```

建议放置位置：

- 新增：`fabric-chaincode/Relayer/demo/query/query_proof_builder.js`

职责：

- 接收 `Q`、`value`、source header、query metadata`
- 构造 `\Pi_Q`
- 输出给 QueryBroker、event store、API 和 UI

## 6. 验证逻辑设计

## 6.1 `VerifyQuery` 的原型版本

建议实现一个纯 JavaScript 验证器：

- 新增：`fabric-chaincode/Relayer/demo/query/query_verifier.js`

输入：

- 原始查询请求参数
- `proof bundle`

输出：

```json
{
  "ok": true,
  "checks": {
    "queryObjectMatched": true,
    "headerMatched": true,
    "stateWitnessMatched": true,
    "commitmentMatched": true
  },
  "commitment": "0x...",
  "verifiedAt": "2026-03-10T00:00:00.000Z"
}
```

### 第一版检查项

1. `Q` 是否由当前请求参数规范化得到
2. `sourceHeader` 与 `sourceHeight` 是否一致
3. `sourceHeaderHash` 是否和 header 序列化结果一致
4. `recordHash` 是否和 `resultValue` 一致
5. `commitment` 是否可重算得到

### 第二版再升级的检查项

1. `sourceHeight` 是否已经被目标侧 light client 接受
2. `stateWitness` 是否升级为真正 membership proof
3. `VerifyQuery` 是否下沉到 Fabric 链码或 FISCO 合约

## 7. 模块落点与接口改造建议

## 7.1 QueryBroker

文件：

- [`query_broker.js`](/home/tr/projects/cross-chain/fabric-chaincode/Relayer/demo/broker/query_broker.js)

建议改造点：

1. 在 `getOrchardRecord()` 返回后立即构造 `Q`
2. 获取当前 source height / source header
3. 生成 `\Pi_Q`
4. 调用 `VerifyQuery`
5. 将验证结果写入 session 与 event store

建议新增 session 字段：

```json
{
  "queryObject": {},
  "queryCommitment": "0x...",
  "queryProof": {},
  "queryVerifyStatus": "PASS",
  "queryVerifyChecks": {}
}
```

## 7.2 Session Store

文件：

- [`memory_store.js`](/home/tr/projects/cross-chain/fabric-chaincode/Relayer/demo/store/memory_store.js)
- [`sqlite_store.js`](/home/tr/projects/cross-chain/fabric-chaincode/Relayer/demo/store/sqlite_store.js)

建议：

- 允许 session JSON 持久化更大的 `queryProof` 对象
- 对于 sqlite 模式，可只持久化 proof 摘要和 commitment，完整 proof 需要时再按需展开

## 7.3 API Layer

文件：

- [`routes_query.js`](/home/tr/projects/cross-chain/fabric-chaincode/Relayer/demo/api/routes_query.js)
- [`routes_proof_cards.js`](/home/tr/projects/cross-chain/fabric-chaincode/Relayer/demo/api/routes_proof_cards.js)

建议：

- 在查询详情接口中暴露 `queryObject`、`queryCommitment`、`queryVerifyStatus`
- 为 proof card 增加 `query-proof` 类型
- 返回简化版 proof 摘要，避免 UI 一次拉取过大 JSON

## 7.4 UI Layer

文件：

- [`AppQueryPage.jsx`](/home/tr/projects/cross-chain/demo-ui/src/pages/AppQueryPage.jsx)
- [`ExplorerPage.jsx`](/home/tr/projects/cross-chain/demo-ui/src/pages/ExplorerPage.jsx)

建议展示项：

- Query Object 摘要
- Source Height / Header Hash
- Query Commitment
- Verification Checks
- “prototype witness / full proof” 标识

## 8. 文件级拆分建议

建议新增目录：

```text
fabric-chaincode/Relayer/demo/query/
  query_object.js
  query_commitment.js
  query_proof_builder.js
  query_verifier.js
  query_types.js
```

各文件职责：

- `query_object.js`：查询对象规范化
- `query_commitment.js`：commitment 计算
- `query_proof_builder.js`：proof bundle 构造
- `query_verifier.js`：proof 校验
- `query_types.js`：统一字段名与版本常量

这样可以避免把研究型逻辑散落在 `query_broker.js` 里。

## 9. 分阶段实现建议

### Phase 1：对象模型跑通

目标：

- 定义 `Q`
- 定义 `C_Q`
- 在 QueryBroker 中生成并存储 commitment

完成标准：

- 查询会话里可看到 `queryObject` 和 `queryCommitment`

### Phase 2：proof bundle 跑通

目标：

- 生成 `\Pi_Q`
- 在 API 中返回 proof 摘要
- UI 展示 query proof card

完成标准：

- `/app-query` 页面能显示 commitment、source height、header hash、record hash

### Phase 3：本地验证器跑通

目标：

- 增加 `VerifyQuery`
- 输出校验项结果

完成标准：

- 错误修改 `resultValue` 时，验证器能拒绝
- 错误修改 `queryObject` 时，验证器能拒绝

### Phase 4：接入轻客户端状态

目标：

- 将 `sourceHeight accepted by light client` 纳入验证条件

完成标准：

- proof 校验不仅检查 bundle 自洽性，还检查 header 是否被目标侧接受

### Phase 5：替换原型 witness

目标：

- 用真正状态证明替换 `record-snapshot` 型 witness

完成标准：

- 从“研究型近似原型”升级为“状态证明原型”

## 10. 原型成功标准

若满足以下条件，可认为该原型达到论文配套演示要求：

1. 用户在 `/app-query` 发起查询后，可以看到 `Q`、`C_Q` 和 proof 摘要
2. 系统能够明确输出 “query proof verified” 或 “verification failed”
3. 篡改结果值或篡改查询对象时，验证器能稳定报错
4. proof card 能说明当前 proof 属于“prototype witness”还是“full proof”

## 11. 风险与注意事项

### 11.1 最大风险

Fabric 第一版不一定能方便导出严格意义上的世界状态 membership proof，因此原型很可能需要先采用“可验证快照见证”替代。

### 11.2 表达风险

论文里必须明确区分：

- **prototype witness**
- **full state proof**

否则容易被审稿或答辩时质疑“你这只是结果快照，不是真正证明”。

### 11.3 工程风险

如果直接把大量 proof JSON 写进 session store 和 SSE 流，前端与 API 可能变重，因此建议默认返回摘要、按需展开详情。

## 12. 与研究报告的关系

本设计文档对应研究报告中的“机制落地层”。

- 研究报告负责回答：为什么这个方向值得研究、机制是什么、理论上为何成立
- 本设计文档负责回答：如何在当前仓库里把机制做成原型

因此，两份文档应配合使用：

- 论文或课题申报时，以研究报告为主
- 原型实现或代码开发时，以本设计文档为主
