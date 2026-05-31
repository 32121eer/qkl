# 测试用例：多 Agent 协商与对抗鲁棒性

更新时间：2026-05-28
作用域：本机 5 容器 Agent + 本地 Ollama LLM + Relayer 协商层

本文档补齐了 `测试用例-多智能体可验证跨链查询.md`（TC-MA3C-QUERY-001 跨链查询主流程）
之外的两类用例：
1. **协商路径**（COMMIT / REJECT / OBSERVE / CRITICAL / 容错 / commit-reveal）
2. **对抗鲁棒性**（Byzantine 少数容忍、恶意无法强制错误共识、沉默 Agent、HMAC 鉴权）

所有用例已编码并跑通：
- **Jest 单元 + 集成**：19 个新用例，全部 PASS；并修复了上一次提交 `更新完跨链追溯应用，但是失效原因未排查` 遗留的 2 个失败用例。
- **真实容器端到端**：6 个用例，全部 PASS（含真实 LLM、HMAC、AGENT_BEHAVIOR 钩子）。
- **整仓 Jest**：75/75 PASS。

---

## 1. 涉及的能力 → 用例覆盖矩阵

| 系统能力 | Jest 用例 | 容器 e2e 用例 |
|---|---|---|
| 验证 Agent 决策与规则 | TC-VB-001~004 | — |
| 沉默/不响应 Agent 不打断协商 | TC-VB-005, TC-NEG-005 | TC-E2E-004 (容器停机) |
| 异构验证 Agent 描述符审计 | TC-VB-007~008 | — |
| NORMAL COMMIT 路径 | TC-NEG-001 | TC-E2E-003 |
| REJECT 路径（证据篡改 / 预验证失败） | TC-NEG-002 | — (覆盖于 TC-BYZ-003) |
| OBSERVE / 无法形成法定人数 | TC-NEG-003 | TC-E2E-006 |
| Commit-Reveal 全部有效 | TC-NEG-004 | TC-E2E-003 weightVector 校验 |
| CRITICAL 风险（n=7, θ=0.75）COMMIT | TC-CRT-001 | — |
| CRITICAL 容忍 1/7 Byzantine | TC-CRT-002 | — |
| CRITICAL 2/7 越过更严阈值阻止 COMMIT | TC-CRT-003 | — |
| Byzantine 1/5 always_reject 容忍 | TC-BYZ-001 | TC-E2E-005 |
| Byzantine 2/5 always_reject 阻断 COMMIT 但不能强制 REJECT | TC-BYZ-002 | TC-E2E-006 |
| Byzantine 2/5 always_approve 不能强制 COMMIT 篡改证据 | TC-BYZ-003 | — |
| HMAC 鉴权强制 | （单元已有 agent_service.test.js） | TC-E2E-002 |
| 健康检查 | — | TC-E2E-001 |

---

## 2. Jest 用例（rule-based 本地 Agent，确定性）

### 2.1 验证 Agent 行为钩子

文件：`fabric-chaincode/Relayer/__tests__/demo/agents/verifier_behavior.test.js`

| 编号 | 名称 | 关键断言 |
|---|---|---|
| **TC-VB-001** | honest 模式：合法证据 → APPROVE | `decision === 'APPROVE'`, `adversarial` 字段不存在 |
| **TC-VB-002** | `always_approve` 对**非法**证据仍 APPROVE | `decision === 'APPROVE'`, `adversarial === true`, `behavior === 'always_approve'` |
| **TC-VB-003** | `always_reject` 对**合法**证据仍 REJECT | `decision === 'REJECT'`, `adversarial === true` |
| **TC-VB-004** | `always_question` 强制 QUESTION | `decision === 'QUESTION'`, `behavior === 'always_question'` |
| **TC-VB-005** | `silent` 抛错（模拟无响应） | `execute()` rejects with `/silent/i` |
| **TC-VB-006** | `random` 50 次试验覆盖至少 2 种决策 | 决策集合大小 ≥ 2 |
| **TC-VB-007** | 未知 behavior 归一化为 honest | `agent.behavior === 'honest'` |
| **TC-VB-008** | `getDescriptor` 暴露 behavior 字段以便审计 | descriptor 含 `behavior` |

### 2.2 协商路径与拜占庭韧性

文件：`fabric-chaincode/Relayer/__tests__/demo/negotiation/negotiation_paths.test.js`

| 编号 | 名称 | 输入 | 关键断言 |
|---|---|---|---|
| **TC-NEG-001** | NORMAL COMMIT 主路径 | 5 honest verifier + 完整证据 + queryVerifyStatus=PASS | `finalDecision='COMMIT'`, `status='READY'`, `groupSize=5`, `threshold=0.7`, `acceptRatio===1`, `wbftSatisfied===true` |
| **TC-NEG-002** | REJECT 共识：预验证 FAIL | 同 5 honest，但 `preVerification.status='FAIL'` | 全部 REJECT；`finalDecision='REJECT'`, `status='REJECTED'`, `rejectRatio===1`, `rejectSatisfied===true` |
| **TC-NEG-003** | OBSERVE：混合决策不达法定人数 | 2 `always_question` + 1 `always_reject` + 2 honest | `finalDecision='OBSERVE'`, `wbftSatisfied===false`, `rejectSatisfied===false` |
| **TC-NEG-004** | commit-reveal 全部有效 | 5 honest + 合法证据 | 每个 `op.commitReveal.valid===true`，`weightVector[*].commitRevealValid===true`，`commitHash` 满足 `/^(0x)?[0-9a-f]+$/` |
| **TC-NEG-005** | 沉默 Agent 优雅降级 | 5 verifier，其中 1 `behavior='silent'` | 仅 4 个 opinion，`silent` agent 不在结果里；`validRevealCount===4`，`enoughReveals===true`，`finalDecision='COMMIT'`；`eventStore` 含 `AGENT_NO_RESPONSE` 审计事件 |
| **TC-BYZ-001** | 1/5 `always_reject` 被容忍 | 4 honest + 1 always_reject | `APPROVE=4, REJECT=1`；`finalDecision='COMMIT'`；`acceptRatio >= 0.7` |
| **TC-BYZ-002** | 2/5 `always_reject` 阻断 COMMIT 但不能强制 REJECT | 3 honest + 2 always_reject | `finalDecision='OBSERVE'`；`acceptRatio < 0.7`；`rejectRatio < 0.7`（活性受影响，安全性保留） |
| **TC-BYZ-003** | 2/5 `always_approve` 无法强制 COMMIT 篡改证据 | 3 honest + 2 always_approve，预验证 FAIL | `APPROVE=2, REJECT=3`；`finalDecision !== 'COMMIT'`；`acceptRatio < 0.7` |
| **TC-CRT-001** | CRITICAL n=7 COMMIT | 7 honest + 合法证据 + risk=CRITICAL | `groupSize=7`, `threshold=0.75`，`finalDecision='COMMIT'`，`acceptRatio===1` |
| **TC-CRT-002** | CRITICAL 容忍 1/7 Byzantine | 6 honest + 1 always_reject | `finalDecision='COMMIT'`，`acceptRatio >= 0.75` (约 0.857) |
| **TC-CRT-003** | CRITICAL 2/7 越过更严阈值 → 不 COMMIT | 5 honest + 2 always_reject | `acceptRatio < 0.75` (约 0.714)，`finalDecision !== 'COMMIT'` |

### 2.3 已修复的 pre-existing 失败

| 编号 | 文件 | 修复 |
|---|---|---|
| `query_broker_proof.test.js > session gets query proof fields and PASS status` | — | `mockVerify` 现在识别 broker 实际产出的字段别名（`sourceTxHash`/`sourceHeader.number`/`request.txHash`），并在预验证 FAIL 时显式 REJECT；保留 `sourceHeader` 检查以使第一轮自然 QUESTION，第二轮 ACCEPT。 |
| `query_broker_proof.test.js > arbitration resolves final round when committee still has recoverable questions` | — | 同上 |

跑通命令：
```bash
cd fabric-chaincode/Relayer
npx jest --runInBand
# Test Suites: 17 passed, 17 total
# Tests:       75 passed, 75 total
```

---

## 3. 真实容器端到端用例

文件：`fabric-chaincode/Relayer/scripts/test-containers-e2e.sh`

前置：本地 Ollama 在 11434 提供 `qwen2.5:14b` 与 `llama3.1:8b`；5 个 Agent 容器在 host 网络
（`docker-compose.agents.yml`），HMAC 强制开启。

| 编号 | 名称 | 步骤 | 预期 | 实测 |
|---|---|---|---|---|
| **TC-E2E-001** | 健康检查 | 顺序 GET `http://127.0.0.1:{19111..19115}/health` | 全部 `status=ok` | 5/5 OK |
| **TC-E2E-002** | HMAC 强制 | 不带签名头 POST `/execute` | 返回 `401` | 401 ✓ |
| **TC-E2E-003** | 5 honest COMMIT | 跑 `demo-negotiation-containers.js` | `finalDecision=COMMIT`，`acceptRatio===1`，`validRevealCount=5` | COMMIT, acceptRatio=1, reveals=5 |
| **TC-E2E-004** | 容错（停 1 容器） | `docker stop agent-verifier-semantic-02`；再跑协商 | 委员会降为 4 仍达 minReveals=4，`finalDecision=COMMIT` | COMMIT, reveals=4 |
| **TC-E2E-005** | Byzantine 1/5（真实容器） | `VERIFIER_SEMANTIC_02_BEHAVIOR=always_reject` 重建该容器，再跑协商 | `finalDecision=COMMIT`，`acceptRatio≥0.7` | COMMIT, acceptRatio=0.805 |
| **TC-E2E-006** | Byzantine 2/5（真实容器）阻断 COMMIT | 再把 proof-02 也设 `always_reject` | `finalDecision != COMMIT`（应 OBSERVE） | OBSERVE, acceptRatio=0.610, rejectRatio=0.390 |

跑通命令：
```bash
cd fabric-chaincode/Relayer
bash scripts/start-ollama.sh
docker compose -f docker-compose.agents.yml up -d
bash scripts/test-containers-e2e.sh
# Summary: 6 pass, 0 fail
```

---

## 4. 通过判定

整套用例通过需同时满足：

1. `npx jest --runInBand` → 全部绿，**75/75 PASS**。
2. `bash scripts/test-containers-e2e.sh` → 退出码 0，**6/6 PASS**。
3. TC-MA3C-QUERY-001（既有跨链查询主流程用例）跑通。

任一硬性断言失败（最终决策不符、`commitRevealValid===false`、`acceptRatio` 与预期方向相反、
HMAC 不强制、沉默 Agent 引发整轮抛错）即判定为失败。

---

## 5. 设计与实现要点（对应到代码）

| 测试需求 | 工程支撑 |
|---|---|
| 行为钩子可注入 | `VerifierAgent` 新增 `behavior` 选项，归一化非法值为 `honest`；`agent_service.js` 从 `AGENT_BEHAVIOR` 注入；`docker-compose.agents.yml` 每个 service 都通过 `${<ID>_BEHAVIOR:-honest}` 暴露。 |
| 沉默 Agent 不应崩溃整轮 | `AgentRuntime.evaluateTask` 把 `verifier.execute` 包进 try/catch，抛错时 emit `AGENT_NO_RESPONSE` 审计事件并跳过其 opinion；WBFT 自然降级。 |
| Mock LLM 给出符合管线的判断 | `LLMClient.mockVerify` 在 `preVerification.status='FAIL'` 时显式 REJECT；对合法证据按 `payload/blockHeight/txHash/preVerifPass/sourceHeader` 5 项打分（识别 broker 产生的所有字段别名）。 |
| CRITICAL 用例可独立运行 | `buildRuntime({ verifierCount: 7 })` 在 Jest 中重置 registry 并注册 7 个独立 org 的 proof 类 verifier，绕过组织上限 `⌊7/3⌋=2` 的限制。 |
| 真实容器对抗实验 | E2E 脚本通过 `VERIFIER_<ID>_BEHAVIOR=...` 环境变量 + `docker compose up -d --force-recreate <service>` 在线翻转任意 Agent 为恶意，结果在 `docs/xn/experiments/container-negotiation-latest.json` 留痕。 |

---

## 6. 复现一切的最短命令

```bash
cd /mnt/fast18/xunuo/qkl/cross-chain/fabric-chaincode/Relayer

# 1) 单元 + 集成（无需容器，无需 Ollama）
npx jest --runInBand

# 2) 真实容器端到端（需 Ollama 与 5 容器在运行）
bash scripts/start-ollama.sh
docker compose -f docker-compose.agents.yml up -d --build
bash scripts/test-containers-e2e.sh
```
