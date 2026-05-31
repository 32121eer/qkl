# 跨链项目算法改造方向调研报告

## 1. 结论先行

基于当前代码形态，我建议把后续算法演进的主线定为：

**方向 A：把现有 Lite Header 校验升级为“Finality-aware Light Client + Misbehaviour Detection”，并为后续消息包含性证明预留接口。**

这是最值得先做的方向，因为它同时满足三点：

1. **和当前架构强相关**：项目已经有 `SubmitBlockHeader`、`Receive`、`waitForRelayEvent` 这些基础骨架，不是从零开始。
2. **研究价值最高**：现在的验证仍以“顺序提交区块头 + 本地 hash 对比”为主，安全模型偏弱，适合往更完整的轻客户端算法推进。
3. **落地风险可控**：相比直接上 zkBridge，全量 zk 证明门槛太高；相比单做 UI/流程优化，这条线更有论文感和系统价值。

我建议报告后的首个原型目标不是“全量 zk 桥”，而是：

**P1：Finality-aware header verification**
**P2：Conflicting header / misbehaviour detection**
**P3：消息或查询结果的包含性证明接口**

## 2. 当前实现的算法基线

从现有代码看，项目已经具备“轻验证雏形”，但离真正的可验证跨链还差三层关键能力。

### 2.1 已有能力

- Fabric 侧 `SubmitBlockHeader` 已做**顺序连续性校验**：要求 `blockNumber == latest + 1` 且 `previousHash` 匹配。[`fabric-chaincode/gateway_cc/lib/gateway.js`](/home/tr/projects/cross-chain/fabric-chaincode/gateway_cc/lib/gateway.js#L117)
- `Receive` 已要求来源区块必须先写入本地 LightClient 状态，并校验 `chainId / blockNumber / blockHash` 一致。[`fabric-chaincode/gateway_cc/lib/gateway.js`](/home/tr/projects/cross-chain/fabric-chaincode/gateway_cc/lib/gateway.js#L246)
- Relayer 已具备顺序提交远端 header 的流程，并处理了一部分 MVCC 冲突。[`fabric-chaincode/Relayer/monitors/fabric_monitor.js`](/home/tr/projects/cross-chain/fabric-chaincode/Relayer/monitors/fabric_monitor.js#L287)

### 2.2 核心短板

- `verifySourceBlock()` 目前基本是空实现，实际上没有做“最终性”判断，只打印确认数后直接返回 `true`。[`fabric-chaincode/Relayer/handlers/message_handler.js`](/home/tr/projects/cross-chain/fabric-chaincode/Relayer/handlers/message_handler.js#L214)
- Fabric 侧 `generateMerkleProof()` 明确还没实现。[`fabric-chaincode/Relayer/monitors/fabric_monitor.js`](/home/tr/projects/cross-chain/fabric-chaincode/Relayer/monitors/fabric_monitor.js#L260)
- `Receive` 只验证“这个 header hash 在本地存在”，**没有验证消息/event/payload 确实包含在该区块的可证明状态中**。
- QueryBroker 的查询完成依赖 relay event 与超时恢复逻辑，更像**工程状态机一致性**，不是**密码学可验证查询**。[`fabric-chaincode/Relayer/demo/broker/query_broker.js`](/home/tr/projects/cross-chain/fabric-chaincode/Relayer/demo/broker/query_broker.js#L20)

换句话说，当前项目已经从“纯转发”进化到“header-aware relay”，但还没有进入“state-proof-aware relay”。

## 3. 候选算法方向

## 方向 A：Finality-aware Light Client + Misbehaviour Detection

### 要解决什么问题

现在的 LightClient-lite 只保证“我收到了一串连续 header”，但没有证明“这串 header 真正经过远端链共识最终确认”。这意味着如果 relayer、RPC 或中间数据源出错，目标链缺少足够强的拒绝机制。

### 可升级点

- 从“父哈希连续”升级为“**最终性证明 + 信任根更新**”
- 增加**冲突 header 检测**：同高度双头、时间不单调、无效委员会签名
- 检测到 misbehaviour 后冻结对应链客户端，阻断继续接收消息

### 对应研究参考

- IBC 的 Tendermint light client 把轻客户端设计成“header 更新 + misbehaviour 检测 + 冻结客户端”的体系，而不是单纯存 header。
- IBC 文档明确把 light client 用作**快速验证跨链消息**的基础。

### 对本项目的意义

这是当前代码最自然的升级路径。你已经有 `SubmitBlockHeader` 与 `GetLatestBlockNumber`，只差把“顺序检查器”提升成“共识安全检查器”。

### 推荐度

**最高。建议作为主线。**

## 方向 B：消息包含性证明 / 可验证跨链查询

### 要解决什么问题

当前 `Receive` 更像“信任 relayer 给我的 payload 对应这个 block”，但没有证明这个 payload 的 event、tx receipt 或 world-state 结果确实存在于源链可承诺状态里。

### 可升级点

- 为 FISCO -> Fabric 增加 event/receipt inclusion proof
- 为 Fabric -> FISCO 增加链码结果或事件的 membership proof
- 对 `/app-query` 的查询结果增加“**结果来自哪个状态根/区块根**”的证明

### 对应研究参考

- ICS-23 的目标就是定义跨语言、跨系统的通用 Merkle proof 表示，并明确支持 existence / non-existence proof，以及 batch proof。
- IBC 把 packet flow 建立在 membership / non-membership proof 之上，而不是只验证 header。
- Cosmos 的 ICS-31/32 也说明“跨链查询”本身可以成为协议级对象，而不是纯业务 API。

### 对本项目的意义

这条线最适合你现在的演示场景。因为你不只是做资产跨链，还在做**跨链查询**。如果能把 orchard 查询结果变成“可验证返回值”，项目的学术味和演示说服力都会明显增强。

### 推荐度

**第二优先级。建议紧跟方向 A。**

## 方向 C：批量证明、聚合证明与 zk 化

### 要解决什么问题

一旦开始做真正的 header / inclusion proof，单条证明的验证成本、链上存储成本、relay 延迟都会明显上升。此时必须考虑批量化。

### 可升级点

- header 批量提交
- 多消息 proof 批量验证
- explorer / query session 的 proof card 改为“单根证明 + 成员证明”
- 长期可演进为 zk light client 或 zk proof aggregation

### 对应研究参考

- `Hyperproofs` 说明向量承诺可以把多 proof 聚合，并把证明更新成本压到对数级。
- `zkBridge` 证明了跨链桥可以用 succinct proof 降低链上验证成本，但工程门槛显著更高。

### 对本项目的意义

这条线更偏中长期。它不是最适合第一步落地的方向，但很适合作为报告里的“第二阶段上限”，说明你项目未来可以从 Lite client 继续走向 succinct bridge。

### 推荐度

**第三优先级。适合作为中长期研究路线。**

## 方向 D：Optimistic Verification + Watcher 挑战窗口

### 要解决什么问题

如果短期做不动完整 native verification 或 zk verification，可以引入 optimistic lane：消息先进入待确认状态，给 watcher 一个挑战窗口，再最终生效。

### 对应研究参考

- Nomad 的核心思路就是 optimistic verification：成本更低、可部署性更强，但依赖至少一个诚实 watcher。

### 对本项目的意义

这条线很适合做**工程折中方案**，尤其适合 Fabric/FISCO 这种异构链组合。但它的研究亮点不如方向 A+B 连贯，且需要设计 watcher、超时、仲裁与冻结流程。

### 推荐度

**可作为方向 A 的低成本变体，不建议单独作为主线。**

## 4. 优先级排序

| 方向 | 安全增益 | 研究价值 | 与现有代码匹配度 | 首版落地难度 | 建议 |
| --- | --- | --- | --- | --- | --- |
| A. Finality-aware Light Client | 高 | 高 | 高 | 中 | 第一优先 |
| B. 可验证跨链查询 / Membership Proof | 高 | 高 | 高 | 中高 | 第二优先 |
| C. 证明聚合 / zk 化 | 很高 | 很高 | 中 | 高 | 第三优先 |
| D. Optimistic Verification | 中 | 中 | 中高 | 中 | 备选 |

## 5. 建议的研究报告主命题

如果你要先做一篇“能指导后续实现”的调研报告，我建议报告标题定为：

**《面向 Fabric 与 FISCO-BCOS 异构跨链的 Finality-aware 轻客户端与可验证查询机制研究》**

这个题目有三个优点：

- 能覆盖当前项目最真实的痛点：Lite header 校验还不够。
- 能自然扩展到查询证明，不会只停留在“桥转发”。
- 后面无论走 membership proof、optimistic lane 还是 zk aggregation，都能纳入该主线。

## 6. 建议的实施路线

### 第一阶段：补齐轻客户端安全语义

- 定义 trusted checkpoint / trusted validator set
- 定义 header update rule、finality rule、misbehaviour rule
- 在 Fabric 侧加入 `freeze client` 状态
- 在 Relayer 侧加入 header 可信性与失败分类

### 第二阶段：把消息验证从 header-level 升级到 state-proof-level

- 为跨链消息增加 inclusion proof 接口
- 为查询结果增加 source state root 绑定
- 在 proof card 中展示 “header proof / state proof / query proof”

### 第三阶段：做批量化与 zk 化

- 批量 header 更新
- proof aggregation
- 评估是否引入 zk light client / recursive proof

## 7. 参考资料

- IBC 总览与 light client 角色：https://docs.cosmos.network/ibc/v10.1.x/intro
- IBC proof 机制：https://ibc.cosmos.network/v10/ibc/light-clients/proofs/
- ICS-23 proof 标准：https://github.com/cosmos/ics23
- IBC 标准总表（含 ICS-31/32/28）：https://github.com/cosmos/ibc
- Nomad optimistic verification：https://docs.nomad.xyz/the-nomad-protocol/verification-mechanisms/optimistic-verification
- Hyperproofs：https://eprint.iacr.org/2021/599
- zkBridge：https://arxiv.org/abs/2210.00264
