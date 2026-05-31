# Multi-Agent 跨链查询最小演示步骤

本文档用于复现当前仓库中已经接入的 Multi-Agent 跨链查询协商流程。

## 1. 目标

复现以下链路：

1. FISCO 用户发起查询请求
2. Fabric 返回查询结果与 query-proof
3. 多个 Verifier Agent 对同一任务独立判断
4. Coordinator 生成 `finalProposal`
5. 只有 `finalProposal.finalDecision === COMMIT` 时，响应才允许继续提交到目标链

## 2. 前置条件

确保以下服务可正常启动：

- FISCO-BCOS 本地链
- Fabric 测试网络
- Relayer Demo API
- Demo UI

如果基础链路未启动，先在仓库根目录执行：

```bash
unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY no_proxy NO_PROXY
cd /mnt/fast18/xunuo/qkl/cross-chain
bash start-all.sh
bash scripts/start-demo.sh
```

成功后默认访问地址：

- UI: `http://localhost:15173/app-query`
- API 健康检查: `http://127.0.0.1:18080/health`

## 3. 最小自动化测试

在仓库根目录执行：

```bash
cd /mnt/fast18/xunuo/qkl/cross-chain/fabric-chaincode/Relayer
npx jest __tests__/demo/query --runInBand
```

预期结果：

- `query_broker_proof.test.js` 通过
- `query_negotiation_api.test.js` 通过
- 全部 query 相关测试通过

当前基线结果：

- 7 个 test suite 通过
- 31 个测试通过

## 4. 演示步骤

### Step 1：打开查询页面

浏览器访问：

```text
http://localhost:15173/app-query
```

### Step 2：向 A 链写入一条果园记录

在页面左侧：

1. 输入 `orchardBatchId`
2. 点击“写入 A 链记录”

建议直接使用默认批次号：

```text
BATCH-APPLE-0001
```

预期结果：

- “最近写入记录（A链可见）”列表中能看到该批次

### Step 3：从 B 链发起查询

在页面右侧：

1. 输入同一个 `orchardBatchId`
2. 点击“从 FISCO 发起查询 -> Fabric”

预期结果：

- 会生成新的 `queryId`
- 会话状态从 `REQUEST_SENT` 开始推进

### Step 4：观察协商面板

在右侧详情卡片里，关注新增的协商字段：

- `协商状态`
- `提案结论`
- `Negotiation` 面板

预期结果：

- `协商状态` 最终为 `协商完成`
- `提案结论` 最终为 `允许提交`
- `Negotiation` 面板中可见：
  - `proposalId`
  - `round`
  - `approved / required`
  - `Approve / Question / Reject` 数量

在当前默认路径下，正常成功案例通常会看到：

```text
status = READY
finalDecision = COMMIT
```

### Step 5：观察 Query Proof

继续在右侧详情卡片查看 `VerifyQuery` 面板。

预期结果：

- `Proof 校验` 显示 `PASS`
- `Query proof` 中能看到：
  - 查询对象 `Q`
  - 结果承诺 `C_Q`
  - 证明包 `Π_Q`

### Step 6：确认最终提交成功

继续观察右侧详情：

- `状态` 最终为 `已完成`
- `响应交易` 不为空
- 查询结果载荷可见

这表示：

1. query-proof 已生成
2. Agent 首轮判断已完成
3. `finalProposal` 已生成
4. 提交门禁已通过
5. Fabric -> FISCO 响应已真正执行

## 5. 可选观察点

如果你想直接从接口看协商摘要，可以执行：

```bash
curl -s http://127.0.0.1:18080/demo/app/query/sessions?limit=5 | jq
```

关注每个 session 里的：

```json
{
  "negotiationStatus": "READY",
  "negotiationProposalId": "proposal_xxx",
  "finalProposal": {
    "finalDecision": "COMMIT"
  },
  "negotiationSummary": {
    "status": "READY",
    "finalDecision": "COMMIT",
    "quorum": {
      "approved": 3,
      "required": 3
    }
  }
}
```

## 6. 当前已验证的行为

自动化测试已覆盖以下最小行为：

1. 正常 proof 路径下会生成 `finalProposal`，且可完成提交
2. proof 被篡改时，协商门禁会阻断提交
3. API 返回 `negotiationSummary`
4. 阻断态下结构化分歧仍然可见

## 7. 当前限制

当前演示仍然是“单进程内逻辑多 Agent”，不是独立网络部署。

当前协商仍是：

- 首轮 verdict
- 结构化分歧分析
- `finalProposal` 决策

还没有做：

- 真正的多轮补证据协商
- 仲裁 Agent 介入
- 链上验证聚合结果
- 经济激励与质押罚没
