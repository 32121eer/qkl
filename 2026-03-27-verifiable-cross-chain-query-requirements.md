# 可验证跨链查询原型需求文档

## 1. 文档目的

本文档定义“可验证跨链查询原型”的第一阶段需求，目标是在当前仓库已有的 Fabric ↔ FISCO-BCOS 演示系统上，落地一个**可实现、可验证、可展示**的查询证明原型。

这里的“可验证”特指：

- 查询结果不再只是普通返回值
- 系统能够生成结构化查询证明包
- 系统能够对证明包进行一致性校验
- 前端能够展示结果承诺、证明摘要和校验结论

本文档只定义需求与验收标准，不包含实现步骤。实现步骤见对应计划文档。

## 2. 目标与边界

### 2.1 目标

第一阶段原型需要实现以下能力：

1. 为 FISCO -> Fabric 的 orchard 查询生成规范化查询对象 `Q`
2. 为查询结果生成结果承诺 `C_Q`
3. 为查询会话生成结构化证明包 `Π_Q`
4. 在 relayer / demo API 层执行 `VerifyQuery`
5. 在 `/app-query` 页面展示证明摘要与校验结果

### 2.2 非目标

第一阶段不包含以下能力：

- 真正的 Fabric 世界状态 Merkle membership proof
- 不存在性证明
- 范围查询、分页查询、聚合查询
- 将 `VerifyQuery` 下沉到 Fabric 链码或 FISCO 合约
- 新增前端测试框架或大型 UI 重构

### 2.3 可实现性约束

为保证本阶段可实现，系统采用**原型化见证（prototype witness）**替代完整状态证明：

- 使用查询时刻的来源区块头、结果快照摘要和上下文绑定来构造 proof bundle
- 使用纯 JavaScript 验证器做 bundle 自洽性校验
- 在文档、字段名和 UI 上明确标识这是 `query-proof-v1` / prototype witness

## 3. 适用范围

本需求仅覆盖当前仓库中的以下路径：

- `fabric-chaincode/Relayer/demo/`
- `demo-ui/src/pages/AppQueryPage.jsx`
- 必要时对 `routes_query.js`、`routes_proof_cards.js`、store/session 层做兼容性扩展

不要求修改底层 FISCO 节点、Fabric 网络脚本或链码验证逻辑。

## 4. 用户与使用场景

### 4.1 用户角色

1. 演示操作者
2. 项目开发者
3. 评审/老师/合作方

### 4.2 核心场景

用户在 `/app-query` 页面输入或选择 `orchardBatchId`，触发一次 FISCO -> Fabric 查询。系统在完成原有查询流程的同时，生成一份与该次查询绑定的 proof bundle，并在页面上展示：

- 该查询对应的查询对象
- 结果承诺
- 来源高度与来源头摘要
- 原型化见证摘要
- 校验结论与各检查项

### 4.3 失败场景

系统需要能区分以下失败：

1. 查询本身失败
2. 查询成功但 proof bundle 缺失
3. proof bundle 存在但校验失败
4. proof bundle 字段篡改导致 commitment 不一致

## 5. 功能需求

## 5.1 查询对象规范化

系统必须提供一个稳定的查询对象生成逻辑，将业务查询参数映射为统一对象。

### 必填字段

- `chainId`
- `namespace`
- `key`
- `queryType`
- `codec`
- `context`

### 要求

1. 相同输入必须生成完全一致的 `Q`
2. `Q` 的序列化必须稳定
3. `Q` 必须可用于后续 commitment 计算与校验

### 第一阶段固定值

- `chainId`: `FABRIC_NET_01`
- `namespace`: `orchard`
- `queryType`: `single-key-read`
- `codec`: `json`

## 5.2 结果承诺生成

系统必须生成 `C_Q`，并满足以下要求：

1. `C_Q` 基于稳定 JSON 序列化和哈希计算
2. 输入至少包括 `Q`、结果值、来源高度、来源头摘要、元信息
3. 相同输入必须生成相同 commitment
4. 任一关键输入变化时，commitment 必须变化

### 输出字段

- `queryCommitment`
- `queryCommitmentInputs` 或等价摘要字段

## 5.3 查询结果证明包

系统必须生成版本化 proof bundle，建议版本号为：

```text
query-proof-v1
```

### 证明包最低要求字段

- `version`
- `queryObject`
- `resultValue`
- `sourceChain`
- `sourceHeight`
- `sourceHeader`
- `sourceHeaderHash`
- `stateWitness`
- `meta`
- `commitment`

### 约束

1. `stateWitness.type` 在第一阶段固定为 `record-snapshot`
2. `stateWitness.note` 必须明确说明不是 full merkle proof
3. 证明包必须和具体 query session 一一绑定

## 5.4 查询校验器

系统必须提供一个 `VerifyQuery` 原型实现，负责校验 proof bundle 的内部一致性。

### 必须校验的检查项

1. `queryObjectMatched`
2. `headerMatched`
3. `stateWitnessMatched`
4. `commitmentMatched`

### 校验输出

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
  "verifiedAt": "..."
}
```

### 行为要求

1. 若任一检查项失败，`ok` 必须为 `false`
2. 失败结果必须可写入 session 和 API 响应
3. 校验器不得依赖链外不可重复的数据源

## 5.5 Query Session 扩展

当前 query session 模型必须扩展，至少支持以下字段：

- `queryObject`
- `queryCommitment`
- `queryProof`
- `queryVerifyStatus`
- `queryVerifyChecks`
- `queryProofVersion`

### 状态要求

1. 查询成功且 proof 校验通过时，`queryVerifyStatus = PASS`
2. 查询成功但 proof 校验失败时，`queryVerifyStatus = FAILED` 或 `MISMATCH`
3. 查询失败时，不要求生成完整 proof，但必须保持字段兼容

## 5.6 API 暴露要求

查询详情接口必须返回 proof 相关字段，至少包括：

- `queryObject`
- `queryCommitment`
- `queryVerifyStatus`
- `queryVerifyChecks`
- `queryProofVersion`

证明卡片接口如存在聚合展示能力，必须支持新增 `query-proof` 类型，或以现有结构兼容承载。

## 5.7 UI 展示要求

`/app-query` 页面必须展示以下内容：

1. 查询对象摘要
2. 结果承诺摘要
3. 来源高度 / 来源头摘要
4. 校验状态
5. 详细检查项
6. 原型化见证标识

### 展示约束

1. 不要求完整展示全部 proof JSON
2. 默认展示摘要，必要时折叠展开详情
3. 必须明确区分“查询成功”和“proof 校验通过”这两个层次

## 6. 非功能需求

### 6.1 可维护性

新增逻辑应放在独立目录中，不直接堆积进 `query_broker.js`。

### 6.2 向后兼容

现有 query 流程必须继续可用。即使 proof 功能关闭或失败，原有查询主链路不能被破坏。

### 6.3 可观测性

proof 生成与校验结果必须可进入：

- session
- event store
- API
- UI

### 6.4 可解释性

所有对外字段命名必须让评审或演示对象能理解，不允许只有内部缩写。

## 7. 数据结构建议

## 7.1 查询对象 `Q`

```json
{
  "chainId": "FABRIC_NET_01",
  "namespace": "orchard",
  "key": "batch:BATCH-APPLE-0001",
  "queryType": "single-key-read",
  "codec": "json",
  "context": {
    "channel": "mychannel",
    "chaincode": "gateway_cc",
    "schema": "orchard-record-v1"
  }
}
```

## 7.2 结果承诺

```json
{
  "queryCommitment": "0x...",
  "queryProofVersion": "query-proof-v1"
}
```

## 7.3 证明包 `Π_Q`

```json
{
  "version": "query-proof-v1",
  "queryObject": {},
  "resultValue": {},
  "sourceChain": "FABRIC_NET_01",
  "sourceHeight": 123,
  "sourceHeader": {},
  "sourceHeaderHash": "0x...",
  "stateWitness": {
    "type": "record-snapshot",
    "recordHash": "0x...",
    "sourceFunction": "GetOrchardRecord",
    "note": "prototype witness, not full merkle proof"
  },
  "meta": {
    "generatedAt": "2026-03-27T00:00:00.000Z",
    "schema": "orchard-record-v1"
  },
  "commitment": "0x..."
}
```

## 8. 验收标准

满足以下条件可判定需求完成：

1. `/app-query` 完成一次查询后，session 中存在 `queryObject`、`queryCommitment`、`queryProof`
2. proof 校验结果可从 API 返回，并在前端可见
3. 篡改结果值时，`commitmentMatched` 必须失败
4. 篡改查询对象时，`queryObjectMatched` 必须失败
5. proof 缺失时，系统应明确返回缺失状态，而不是静默通过
6. 原有查询主流程不因 proof 功能而回归失败

## 9. 详细测试规格

## 9.1 测试策略

为保证本阶段可实现，测试分为三层：

1. `Relayer demo query` 逻辑单元测试
2. API 层集成测试
3. UI 手工验收测试

第一阶段不新增前端自动化测试框架；若后续已有团队要求，再单独扩展。

## 9.2 单元测试规格

### A. 查询对象生成器

应覆盖：

1. 相同 batchId 生成相同 `Q`
2. 不同 batchId 生成不同 `Q.key`
3. 输出字段完整
4. 空输入时使用明确错误或兜底策略

### B. 结果承诺生成器

应覆盖：

1. 相同输入生成相同 commitment
2. `resultValue` 变化时 commitment 变化
3. `sourceHeight` 变化时 commitment 变化
4. `queryObject` 变化时 commitment 变化
5. 输出包含 version / commitment 摘要字段

### C. 证明包构造器

应覆盖：

1. proof bundle 字段齐全
2. `stateWitness.type === record-snapshot`
3. `commitment` 与构造输入一致
4. 缺失 header 或结果值时应报错或返回明确失败

### D. 查询校验器

应覆盖：

1. 正常 proof 校验通过
2. 查询对象被篡改时 `queryObjectMatched = false`
3. header hash 被篡改时 `headerMatched = false`
4. `recordHash` 与结果值不一致时 `stateWitnessMatched = false`
5. commitment 被篡改时 `commitmentMatched = false`

## 9.3 集成测试规格

### A. QueryBroker 扩展

应覆盖：

1. 查询成功后 session 中写入 proof 相关字段
2. proof 校验通过时 `queryVerifyStatus = PASS`
3. proof 构造失败时不会破坏原有失败处理逻辑
4. late relay success / timeout recovery 场景下 proof 字段仍保持一致

### B. API 返回

应覆盖：

1. 查询详情接口返回 `queryObject`
2. 查询详情接口返回 `queryCommitment`
3. 查询详情接口返回 `queryVerifyChecks`
4. proof card 接口返回 query-proof 摘要或兼容字段

## 9.4 手工验收测试规格

### 场景 1：正常查询

步骤：

1. 启动 demo
2. 在 `/app-query` 输入有效 batchId
3. 发起查询
4. 等待完成

预期：

- 页面显示查询成功
- 页面显示 proof 摘要
- 页面显示 `PASS`

### 场景 2：结果篡改模拟

步骤：

1. 在开发环境中对 proof bundle 的 `resultValue` 做人工修改
2. 刷新查询详情

预期：

- 页面显示 proof 校验失败
- `commitmentMatched` 或 `stateWitnessMatched` 为失败

### 场景 3：proof 缺失

步骤：

1. 模拟 proof builder 未返回结果
2. 发起查询

预期：

- 页面或接口明确显示 proof 缺失/未生成
- 不得错误显示为 PASS

## 9.5 回归测试要求

以下现有能力不得被破坏：

1. 原有 FISCO -> Fabric 查询主链路
2. 原有 session 状态流转
3. 原有 `/app-query` 页面基本展示
4. 原有 event store 写入

## 10. 风险与限制

1. 第一阶段 proof 是 prototype witness，不是 full state proof
2. Fabric 状态证明能力不足时，只能先验证 bundle 自洽性与来源绑定
3. 若前端一次性拉取完整 proof JSON，可能带来展示和性能负担

## 11. 文档关系

本文档应与以下文档配合使用：

- 背景与研究依据：
  [`2026-03-10-verifiable-cross-chain-query-report.md`](/home/tr/projects/cross-chain/docs/2026-03-10-verifiable-cross-chain-query-report.md)
- 当前原型设计草案：
  [`2026-03-10-verifiable-cross-chain-query-prototype-design.md`](/home/tr/projects/cross-chain/docs/2026-03-10-verifiable-cross-chain-query-prototype-design.md)

如进入实现阶段，应继续配套维护开发计划文档。
