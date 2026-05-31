# 论文要求落地清单

本文档用于把 `论文初稿-中文版.md` 中的协议要求映射到当前项目实现，便于后续论文实现章节、演示脚本和实验章节对齐。

## 已落实

| 论文要求 | 当前项目落点 | 说明 |
|---|---|---|
| 验证任务模型 `T=(id, src, dst, query, risk, deadline, status)` | `fabric-chaincode/Relayer/demo/negotiation/cross_chain_task.js` | `crossChainTask` 已加入 `risk`、双链、证据包、协商状态和证据版本。 |
| NORMAL/CRITICAL 风险参数 | `demo/negotiation/protocol_config.js`、`demo/broker/query_broker.js` | NORMAL 默认 `n=5, theta=0.70`，CRITICAL 默认 `n=7, theta=0.75`；批次名含 `CRITICAL/REGULATORY/AUDIT` 时自动升为 CRITICAL。 |
| 信誉加权 VRF 式随机选组 | `demo/negotiation/committee_selector.js` | 使用任务上下文生成可审计 `selectionSeed`，按信誉权重做确定性加权抽样。 |
| 组织多样性与策略异构约束 | `committee_selector.js`、`demo/agents/agent_runtime.js` | 默认验证者跨多个组织，含 A/B/C 三类策略；NORMAL 下同组织上限为 `floor(n/3)`。 |
| 双收集者证据比对 | `demo/agents/evidence_agent.js`、`query_broker.js` | `evidence-01` 与 `evidence-02` 独立生成 `collectorAttestations`，比对 `evidenceHash` 和组织来源。 |
| 密码学预验证 | `query_broker.js`、`demo/query/query_verifier.js` | `VerifyQuery` 结果写入 `evidenceBundle.preVerification`，验证失败时协商层拒绝提交。 |
| Commit-Reveal 独立判断 | `demo/negotiation/commit_reveal.js`、`demo/agents/agent_runtime.js` | 每个验证者输出 `commitHash`、`nonce`、`judgment`、`reasonHash` 和 `commitRevealValid` 审计字段。 |
| `rep_i * confidence_i` 加权共识 | `demo/negotiation/proposal_builder.js`、`weight_allocator.js` | 最终提案计算 `effectiveWeight`、`acceptRatio`、`rejectRatio` 和最小 reveal 数。 |
| 仲裁路径 | `demo/agents/arbitration_agent.js`、`negotiation_protocol.js` | 当最终轮仍为 `OBSERVE` 时触发仲裁，仲裁结果写回最终提案。 |
| 非对称信誉更新 | `demo/negotiation/reputation_store.js` | 对高置信正确、低置信正确、低置信错误、高置信错误分别给出不同 alignment 更新。 |
| 结算/惩罚展示 | `demo/negotiation/settlement_engine.js`、`demo-ui/src/pages/AppQueryPage.jsx` | 结算按有效权重分配；高置信错误拒绝会加重 slash。 |
| 前端可审计展示 | `demo-ui/src/pages/AppQueryPage.jsx`、`demo/api_server.js` | `/app-query` 展示风险等级、阈值、accept ratio、reveal 数、有效权重和 commit-reveal 校验数。 |

## 已验证

```bash
cd fabric-chaincode/Relayer
npx jest __tests__/demo/negotiation/wbft_weighting.test.js \
  __tests__/demo/query/query_broker_proof.test.js \
  __tests__/demo/query/query_negotiation_api.test.js \
  __tests__/demo/experiments/ma3c_wbft_simulator.test.js \
  --runInBand
```

结果：4 个测试套件、16 个测试全部通过。

## 后续可增强

1. 将当前单进程逻辑 Agent 拆成可独立部署的 Agent 进程。
2. 将 `selectionSeed` 换成目标链合约或区块提议者提供的真实 VRF 输出。
3. 将协调合约从 demo 内存状态推进到 FISCO-BCOS Solidity 合约。
4. 接入真实 LLM 后端，让 C 类型语义推理器输出结构化推理摘要并链下存证。
5. 扩展实验脚本，覆盖论文中的 40% Byzantine、策略性对手和沉默攻击场景。
