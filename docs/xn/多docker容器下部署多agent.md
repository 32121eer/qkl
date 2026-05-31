# 多 Docker 容器下部署多 Agent 实现步骤

更新时间：2026-05-10

本文档说明如何把当前项目中的单进程逻辑 Agent 改造成“单机 Docker 多容器多 Agent”部署形态。目标是在只有一台电脑的情况下，让每个 Agent 作为独立容器运行，拥有独立端口、HTTP API、配置、密钥和日志，从而支撑论文中的“多 Agent 协商原型”表述。

注意：这种方案仍然不是多物理节点。更准确的论文表述是：

> 本原型在单台主机上通过 Docker 容器部署多个逻辑独立的 Agent 节点。每个 Agent 拥有独立进程、端口、配置、密钥和日志，通过 HTTP API 与协调组件交互。该环境用于验证多 Agent 协商流程、审计机制和容器化部署可行性；跨物理节点部署下的网络故障隔离和真实 Byzantine 容错实验留待后续工作。

## 1. 当前状态

当前项目的 Agent 位于：

```text
fabric-chaincode/Relayer/demo/agents/
```

核心入口是：

```text
fabric-chaincode/Relayer/demo/agents/agent_runtime.js
```

现在的运行方式是：

```text
Relayer Node.js 进程
└─ AgentRuntime
   ├─ EvidenceAgent 对象
   ├─ VerifierAgent 对象
   ├─ CoordinatorAgent 对象
   ├─ SubmitterAgent 对象
   └─ ArbitrationAgent 对象
```

这属于“单进程多 Agent 对象”。下一步要改成：

```text
Relayer / Coordinator 进程
├─ 通过 HTTP 调用 agent-evidence-01:19101
├─ 通过 HTTP 调用 agent-evidence-02:19102
├─ 通过 HTTP 调用 agent-verifier-proof-01:19111
├─ 通过 HTTP 调用 agent-verifier-policy-01:19112
├─ 通过 HTTP 调用 agent-verifier-semantic-01:19113
└─ 通过 HTTP 调用 agent-arbitration-01:19131
```

## 2. 目标架构

推荐第一阶段只把 Verifier Agent 容器化，Evidence/Submitter/Coordinator 先保留在 Relayer 进程内。这样改动小、风险低、论文说服力已经明显增强。

### 2.1 第一阶段目标

```text
Docker network: crosschain-agent-net

relayer-demo-api
├─ local EvidenceAgent
├─ local CoordinatorAgent
├─ local SubmitterAgent
├─ remote verifier-proof-01     http://agent-verifier-proof-01:19111
├─ remote verifier-policy-01    http://agent-verifier-policy-01:19112
├─ remote verifier-semantic-01  http://agent-verifier-semantic-01:19113
└─ local ArbitrationAgent
```

### 2.2 第二阶段目标

```text
relayer-demo-api / coordinator
├─ remote evidence-01
├─ remote evidence-02
├─ remote verifier-*
├─ remote arbitration-*
└─ remote submitter-01
```

### 2.3 第三阶段目标

把 Coordinator 也拆成独立服务：

```text
coordinator-service
├─ 调用 evidence agents
├─ 调用 verifier agents
├─ 调用 arbitration agents
└─ 把 finalProposal 返回 relayer
```

## 3. 需要新增的文件

建议新增：

```text
fabric-chaincode/Relayer/demo/agents/agent_service.js
fabric-chaincode/Relayer/demo/agents/remote_agent_client.js
fabric-chaincode/Relayer/demo/agents/remote_agent_registry.js
fabric-chaincode/Relayer/Dockerfile.agent
fabric-chaincode/Relayer/docker-compose.agents.yml
fabric-chaincode/Relayer/config/agents.remote.example.json
```

建议新增运行时目录：

```text
.demo/agents/
├─ evidence-01/
│  ├─ config.json
│  ├─ keys/agent.key
│  └─ logs/
├─ evidence-02/
├─ verifier-proof-01/
├─ verifier-policy-01/
├─ verifier-semantic-01/
├─ arbitration-01/
└─ submitter-01/
```

`.demo/agents/*/keys` 不应提交到 Git。

## 4. HTTP API 契约

每个 Agent 容器至少暴露 3 个 API。

### 4.1 `GET /health`

用于健康检查。

响应：

```json
{
  "status": "ok",
  "agentId": "verifier-proof-01",
  "role": "VERIFIER",
  "ts": "2026-05-10T00:00:00.000Z"
}
```

### 4.2 `GET /descriptor`

用于 Coordinator/Relayer 获取 Agent 元数据。

响应：

```json
{
  "agentId": "verifier-proof-01",
  "role": "VERIFIER",
  "organization": "org-b",
  "strategyType": "A_PROOF_VALIDATOR",
  "capabilities": [
    "evidence_validation",
    "query_proof_check",
    "semantic_validation"
  ],
  "endpoint": "http://agent-verifier-proof-01:19111"
}
```

### 4.3 `POST /execute`

用于执行 Agent 判断。

请求：

```json
{
  "task": {
    "taskId": "cc_task_query_001",
    "queryId": "query_001",
    "risk": "NORMAL",
    "sourceChain": "FISCO_NET_01",
    "targetChain": "FABRIC_NET_01",
    "evidenceBundle": {}
  },
  "context": {
    "round": 1,
    "assignedWeight": 0.2,
    "session": {}
  }
}
```

响应：

```json
{
  "agentId": "verifier-proof-01",
  "role": "VERIFIER",
  "round": 1,
  "decision": "APPROVE",
  "confidence": 0.88,
  "assignedWeight": 0.2,
  "focus": "proof",
  "checks": {},
  "reasons": [
    "query proof verified"
  ],
  "generatedAt": "2026-05-10T00:00:00.000Z",
  "signature": "0x..."
}
```

第一阶段可以先不做签名，但响应字段要预留 `signature`。

## 5. Agent 服务实现步骤

### 5.1 新增 `agent_service.js`

文件位置：

```text
fabric-chaincode/Relayer/demo/agents/agent_service.js
```

职责：

1. 读取环境变量。
2. 根据 `AGENT_ROLE/AGENT_STRATEGY/AGENT_FOCUS` 创建对应 Agent。
3. 启动 Express HTTP 服务。
4. 暴露 `/health`、`/descriptor`、`/execute`。
5. 写入独立日志。

推荐环境变量：

```bash
AGENT_ID=verifier-proof-01
AGENT_ROLE=VERIFIER
AGENT_FOCUS=proof
AGENT_STRATEGY=A_PROOF_VALIDATOR
AGENT_ORG=org-b
AGENT_PORT=19111
AGENT_STATE_DIR=/app/agent-state
AGENT_CONFIG=/app/agent-state/config.json
AGENT_KEY=/app/agent-state/keys/agent.key
AGENT_LOG=/app/agent-state/logs/agent.log
```

Agent 创建逻辑：

```js
if (role === 'VERIFIER') {
  agent = new VerifierAgent({
    agentId,
    focus,
    strictProof: strategy === 'A_PROOF_VALIDATOR',
    organization,
    strategyType: strategy,
    llmBackend
  });
}
```

### 5.2 新增 `remote_agent_client.js`

文件位置：

```text
fabric-chaincode/Relayer/demo/agents/remote_agent_client.js
```

职责：

1. 调用远程 Agent `/descriptor`。
2. 调用远程 Agent `/execute`。
3. 设置超时，例如 10 秒。
4. 把网络错误转换为 Agent timeout/failure。

推荐接口：

```js
class RemoteAgentClient {
  constructor({ endpoint, timeoutMs = 10000 }) {}
  async descriptor() {}
  async execute(task, context) {}
}
```

### 5.3 新增 `remote_agent_registry.js`

文件位置：

```text
fabric-chaincode/Relayer/demo/agents/remote_agent_registry.js
```

职责：

1. 从 JSON 文件读取远程 Agent 列表。
2. 批量拉取 descriptors。
3. 返回与本地 `AgentRegistry` 类似的数据结构。

配置文件示例：

```json
{
  "agents": [
    {
      "agentId": "verifier-proof-01",
      "role": "VERIFIER",
      "endpoint": "http://agent-verifier-proof-01:19111"
    },
    {
      "agentId": "verifier-policy-01",
      "role": "VERIFIER",
      "endpoint": "http://agent-verifier-policy-01:19112"
    },
    {
      "agentId": "verifier-semantic-01",
      "role": "VERIFIER",
      "endpoint": "http://agent-verifier-semantic-01:19113"
    }
  ]
}
```

## 6. 修改 `AgentRuntime`

文件：

```text
fabric-chaincode/Relayer/demo/agents/agent_runtime.js
```

### 6.1 增加运行模式

使用环境变量：

```bash
DEMO_AGENT_MODE=local
DEMO_AGENT_MODE=remote
DEMO_REMOTE_AGENT_CONFIG=/app/config/agents.remote.json
```

默认保持当前行为：

```bash
DEMO_AGENT_MODE=local
```

### 6.2 remote 模式下的 Verifier 调用

当前代码：

```js
const verdict = await verifier.execute(task, context);
```

remote 模式下改为：

```js
const verdict = await remoteClient.execute(task, context);
```

第一阶段只需要让 `getVerifiers()` 返回远程 Verifier 描述符，`evaluateTask()` 中执行远程调用即可。

### 6.3 保留本地回退

建议加一个开关：

```bash
DEMO_AGENT_REMOTE_FALLBACK_LOCAL=true
```

当远程 Agent 不可用时，可以回退到本地 Agent，便于开发调试。但论文实验时应关闭回退：

```bash
DEMO_AGENT_REMOTE_FALLBACK_LOCAL=false
```

## 7. Docker 镜像

新增：

```text
fabric-chaincode/Relayer/Dockerfile.agent
```

建议内容：

```dockerfile
FROM node:20-bookworm-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production
ENV AGENT_PORT=19100

EXPOSE 19100

CMD ["node", "demo/agents/agent_service.js"]
```

如果本机 Node 版本更高也没关系，容器内先固定 Node 20，稳定性更好。

## 8. Docker Compose

新增：

```text
fabric-chaincode/Relayer/docker-compose.agents.yml
```

第一阶段建议启动 5 个 Verifier：

```yaml
services:
  agent-verifier-proof-01:
    build:
      context: .
      dockerfile: Dockerfile.agent
    environment:
      AGENT_ID: verifier-proof-01
      AGENT_ROLE: VERIFIER
      AGENT_FOCUS: proof
      AGENT_STRATEGY: A_PROOF_VALIDATOR
      AGENT_ORG: org-b
      AGENT_PORT: 19111
      AGENT_STATE_DIR: /app/agent-state
    ports:
      - "19111:19111"
    volumes:
      - ../../.demo/agents/verifier-proof-01:/app/agent-state

  agent-verifier-proof-02:
    build:
      context: .
      dockerfile: Dockerfile.agent
    environment:
      AGENT_ID: verifier-proof-02
      AGENT_ROLE: VERIFIER
      AGENT_FOCUS: proof
      AGENT_STRATEGY: A_PROOF_VALIDATOR
      AGENT_ORG: org-d
      AGENT_PORT: 19112
      AGENT_STATE_DIR: /app/agent-state
    ports:
      - "19112:19112"
    volumes:
      - ../../.demo/agents/verifier-proof-02:/app/agent-state

  agent-verifier-policy-01:
    build:
      context: .
      dockerfile: Dockerfile.agent
    environment:
      AGENT_ID: verifier-policy-01
      AGENT_ROLE: VERIFIER
      AGENT_FOCUS: balanced
      AGENT_STRATEGY: B_POLICY_CHECKER
      AGENT_ORG: org-c
      AGENT_PORT: 19113
      AGENT_STATE_DIR: /app/agent-state
    ports:
      - "19113:19113"
    volumes:
      - ../../.demo/agents/verifier-policy-01:/app/agent-state

  agent-verifier-semantic-01:
    build:
      context: .
      dockerfile: Dockerfile.agent
    environment:
      AGENT_ID: verifier-semantic-01
      AGENT_ROLE: VERIFIER
      AGENT_FOCUS: semantic
      AGENT_STRATEGY: C_SEMANTIC_REASONER
      AGENT_ORG: org-f
      AGENT_PORT: 19114
      AGENT_STATE_DIR: /app/agent-state
      AGENT_LLM_BACKEND: semantic-llm-a
    ports:
      - "19114:19114"
    volumes:
      - ../../.demo/agents/verifier-semantic-01:/app/agent-state

  agent-verifier-semantic-02:
    build:
      context: .
      dockerfile: Dockerfile.agent
    environment:
      AGENT_ID: verifier-semantic-02
      AGENT_ROLE: VERIFIER
      AGENT_FOCUS: semantic
      AGENT_STRATEGY: C_SEMANTIC_REASONER
      AGENT_ORG: org-g
      AGENT_PORT: 19115
      AGENT_STATE_DIR: /app/agent-state
      AGENT_LLM_BACKEND: semantic-llm-b
    ports:
      - "19115:19115"
    volumes:
      - ../../.demo/agents/verifier-semantic-02:/app/agent-state
```

后续第二阶段再追加：

```yaml
agent-evidence-01:
agent-evidence-02:
agent-arbitration-01:
agent-submit-01:
```

## 9. 准备 Agent 状态目录

新增脚本可选：

```text
scripts/init-agent-state.sh
```

手工创建也可以：

```bash
mkdir -p .demo/agents/verifier-proof-01/keys .demo/agents/verifier-proof-01/logs
mkdir -p .demo/agents/verifier-proof-02/keys .demo/agents/verifier-proof-02/logs
mkdir -p .demo/agents/verifier-policy-01/keys .demo/agents/verifier-policy-01/logs
mkdir -p .demo/agents/verifier-semantic-01/keys .demo/agents/verifier-semantic-01/logs
mkdir -p .demo/agents/verifier-semantic-02/keys .demo/agents/verifier-semantic-02/logs
```

生成临时密钥：

```bash
openssl rand -hex 32 > .demo/agents/verifier-proof-01/keys/agent.key
openssl rand -hex 32 > .demo/agents/verifier-proof-02/keys/agent.key
openssl rand -hex 32 > .demo/agents/verifier-policy-01/keys/agent.key
openssl rand -hex 32 > .demo/agents/verifier-semantic-01/keys/agent.key
openssl rand -hex 32 > .demo/agents/verifier-semantic-02/keys/agent.key
```

写入配置：

```json
{
  "enabled": true,
  "maxConcurrentTasks": 3,
  "timeoutMs": 10000,
  "organization": "org-b",
  "strategyType": "A_PROOF_VALIDATOR"
}
```

## 10. 启动流程

### 10.1 启动基础链环境

```bash
cd /mnt/fast18/xunuo/qkl/cross-chain
bash start-all.sh
```

### 10.2 启动 Agent 容器

```bash
cd /mnt/fast18/xunuo/qkl/cross-chain/fabric-chaincode/Relayer
docker compose -f docker-compose.agents.yml up -d --build
```

### 10.3 检查 Agent

```bash
curl http://127.0.0.1:19111/health
curl http://127.0.0.1:19111/descriptor
curl http://127.0.0.1:19114/descriptor
```

### 10.4 启动 demo API 和前端

```bash
cd /mnt/fast18/xunuo/qkl/cross-chain
DEMO_AGENT_MODE=remote \
DEMO_REMOTE_AGENT_CONFIG=/mnt/fast18/xunuo/qkl/cross-chain/fabric-chaincode/Relayer/config/agents.remote.json \
bash scripts/start-demo.sh
```

前端：

```text
http://localhost:15173/app-query
```

## 11. 验收标准

### 11.1 容器层验收

```bash
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
```

应看到：

```text
agent-verifier-proof-01      Up ...
agent-verifier-proof-02      Up ...
agent-verifier-policy-01     Up ...
agent-verifier-semantic-01   Up ...
agent-verifier-semantic-02   Up ...
```

### 11.2 API 层验收

每个 Agent：

```bash
curl -s http://127.0.0.1:19111/health
curl -s http://127.0.0.1:19111/descriptor
```

应返回对应 `agentId/role/organization/strategyType`。

### 11.3 Relayer 调用验收

触发 `/app-query` 查询后，`.demo/demo-api.log` 应出现类似信息：

```text
remote verifier-proof-01 committed and revealed APPROVE
remote verifier-policy-01 committed and revealed APPROVE
remote verifier-semantic-01 committed and revealed APPROVE
```

前端 `/app-query` 的最终提案中应看到：

```text
selectedCommittee 包含远程 Agent
weightVector 包含远程 Agent
commitRevealValid = true
acceptRatio >= 0.70
```

### 11.4 隔离性验收

每个 Agent 有独立日志：

```text
.demo/agents/verifier-proof-01/logs/agent.log
.demo/agents/verifier-policy-01/logs/agent.log
.demo/agents/verifier-semantic-01/logs/agent.log
```

停止某个 Agent：

```bash
docker stop relayer-agent-verifier-semantic-01-1
```

系统应表现为：

1. 该 Agent 调用失败。
2. Relayer 记录 timeout/failure。
3. 共识可能降级为 OBSERVE/ARBITRATING，或在有效 reveal 足够时继续完成。

## 12. 测试计划

### 12.1 单元测试

新增测试：

```text
fabric-chaincode/Relayer/__tests__/demo/agents/remote_agent_client.test.js
fabric-chaincode/Relayer/__tests__/demo/agents/agent_service.test.js
```

覆盖：

1. `/descriptor` 正常返回。
2. `/execute` 返回合法 envelope。
3. timeout 被转换为 Agent failure。
4. remote mode 下 `AgentRuntime` 可聚合多个远程 Agent 输出。

### 12.2 集成测试

新增脚本：

```text
scripts/smoke-agent-containers.sh
```

检查：

```bash
curl /health
curl /descriptor
curl /execute
```

### 12.3 E2E 测试

流程：

```bash
bash start-all.sh
cd fabric-chaincode/Relayer
docker compose -f docker-compose.agents.yml up -d --build
cd /mnt/fast18/xunuo/qkl/cross-chain
DEMO_AGENT_MODE=remote bash scripts/start-demo.sh
bash scripts/smoke-demo-api.sh
```

## 13. 日志与审计字段

每个远程 Agent 的响应建议额外包含：

```json
{
  "agentRuntime": {
    "mode": "remote-container",
    "containerName": "agent-verifier-proof-01",
    "endpoint": "http://agent-verifier-proof-01:19111",
    "requestId": "agent_req_...",
    "startedAt": "...",
    "finishedAt": "...",
    "durationMs": 42
  }
}
```

最终 `finalProposal.weightVector` 建议增加：

```json
{
  "agentId": "verifier-proof-01",
  "runtimeMode": "remote-container",
  "endpoint": "http://agent-verifier-proof-01:19111",
  "containerized": true
}
```

这会让前端和论文截图更有说服力。

## 14. 安全注意事项

1. 不要提交 `.demo/agents/*/keys/*`。
2. 第一阶段密钥只用于本地签名占位，不应声称是生产级身份体系。
3. Agent 容器之间目前仍共享同一台宿主机资源，不能声称物理隔离。
4. Docker 网络隔离不是 Byzantine 安全的充分条件，只是进程和配置隔离。
5. 如果要模拟恶意 Agent，建议通过环境变量控制：

```bash
AGENT_BEHAVIOR=honest
AGENT_BEHAVIOR=always_reject
AGENT_BEHAVIOR=always_approve
AGENT_BEHAVIOR=silent_after_commit
AGENT_BEHAVIOR=random
```

## 15. 后续增强

1. 把 EvidenceAgent、ArbitrationAgent、SubmitterAgent 全部容器化。
2. Coordinator 独立成 `coordinator-service`。
3. 增加 Agent 注册中心 API：

```text
POST /agents/register
GET  /agents
POST /agents/heartbeat
```

4. 增加真实响应签名：

```text
signature = Sign(agentPrivateKey, hash(taskId || judgment || confidence || reasonHash || timestamp))
```

5. 接入真实 LLM：

```bash
AGENT_LLM_BACKEND=openai
AGENT_LLM_MODEL=gpt-4.1-mini
```

6. 把 finalProposal 摘要锚定到 FISCO `MA3CCoordinator.sol`。

## 16. 论文中建议写法

可以写：

> 为验证多智能体协商机制的工程可行性，本文在单台主机上构建了容器化多 Agent 原型。每个验证 Agent 被封装为独立 Docker 容器，具有独立端口、配置、密钥和日志，并通过 HTTP API 接收验证任务、返回判断、置信度和审计哈希。协调组件通过远程调用收集各 Agent 判断，并执行 commit-reveal 校验、信誉加权聚合和最终提案生成。

不要写：

> 本实验已经部署在多个物理节点上。

更严谨的表达：

> 该部署提供进程级和容器级隔离，但仍共享同一台物理主机。因此，本文将其作为单机容器化原型实验；多物理节点下的网络故障隔离和性能评估作为后续扩展。

## 17. 验证记录（2026-05-28）：多容器多 Agent 协商已跑通

本节记录"先在多 Docker 容器内实现多 Agent 协商"阶段的根因排查、修复和实测结果。
对应上一次提交信息中"失效原因未排查"的问题已定位并修复。

### 17.1 失效根因（3 个）

1. **Agent 端点用了 Docker 内部主机名，宿主机上的 Relayer 无法解析。**
   `setup-agent-directory.js` / `onchain-state.json` 把端点写成
   `http://agent-verifier-proof-01:19111` 这类 compose 服务名。但 Relayer（demo API）
   是 `node index.js` 跑在**宿主机**上（见 `scripts/start-demo.sh`），不在 Docker 网络里，
   无法解析这些服务名 → 远程调用全部失败。
   单机阶段正确端点应为发布到宿主机的端口 `http://127.0.0.1:191xx`。

2. **`normalizeRemoteAgentSpec` 丢弃了 `sharedSecret`。**
   通过数组 / 环境变量配置远程 Agent 时，HMAC 共享密钥被丢掉，导致 Relayer 调用 Agent
   时无法签名，开启鉴权后会被 401 拒绝。

3. **链下目录路径与 docker-compose 挂载路径不一致。**
   `AgentDirectory` 默认在 `Relayer/.demo/agents/directory`，而
   `docker-compose.agents.yml` 挂载的是仓库根 `../../.demo/agents/directory`。
   两边读到的不是同一个密钥目录。

> 附加坑：旧的 Agent 镜像是 2 周前构建的（194 行 `agent_service.js`），**不含 HMAC
> 鉴权代码**，必须 `--build` 重建镜像才会启用 `verifyAgentAuth`；`docker-compose.agents.yml`
> 里 `agent-verifier-proof-01` 还有重复的 `AGENT_DIRECTORY_PATH` key 导致 compose 解析报错。

### 17.2 修复

| 文件 | 修复 |
|---|---|
| `demo/agents/remote_agent_registry.js` | `normalizeRemoteAgentSpec` 保留 `sharedSecret` 和 `tlsConfig`。 |
| `scripts/setup-agent-directory.js` | 端点改为可配置：默认 `http://127.0.0.1:191xx`；`AGENT_ENDPOINT_HOST` / `AGENT_ENDPOINT_SCHEME` / `<AGENT_ID>_ENDPOINT` 覆盖（为第二阶段多服务器预留）；目录默认写到仓库根 `.demo/agents/directory`（与 compose 挂载一致），`AGENT_DIRECTORY_PATH` 可覆盖。 |
| `docker-compose.agents.yml` | 删除重复的 `AGENT_DIRECTORY_PATH` key。 |
| `scripts/demo-negotiation-containers.js`（新增） | 独立驱动脚本，不依赖在线链即可跑完整协商。 |

### 17.3 复现实测命令

```bash
cd /mnt/fast18/xunuo/qkl/cross-chain/fabric-chaincode/Relayer
unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY no_proxy NO_PROXY

# 1) 生成链下目录（localhost 端点 + 每 Agent 独立 HMAC 密钥）
node scripts/setup-agent-directory.js --regenerate

# 2) 重建并启动 5 个 Agent 容器（首次必须 --build，旧镜像无鉴权代码）
docker compose -f docker-compose.agents.yml up -d --build

# 3) 健康检查
for p in 19111 19112 19113 19114 19115; do curl -s http://127.0.0.1:$p/health; echo; done

# 4) 跑多容器协商（--json 额外落盘审计件）
node scripts/demo-negotiation-containers.js --json
```

容器内 Agent 的 LLM 配置由 `Relayer/.env` 注入（`LLM_BACKEND=openai`、`OPENAI_API_KEY`、
`LLM_MODEL_POLICY=kimi-k2.5`、`LLM_MODEL_SEMANTIC=deepseek-v4-pro`）。`docker compose` 自动读取该 `.env`。

### 17.4 实测结果

**鉴权：** 无签名 `POST /execute` 返回 **401**；带 HMAC 签名返回 **200**。HMAC 强制生效。

**真实 LLM：** semantic（deepseek-v4-pro）/ policy（kimi-k2.5）容器返回结构化
`{judgment, confidence, reasoning}`，单次约 13–40s；proof（规则型）约 1–3ms。

**共识达成（合法记录，COMMIT 路径）：** 5 个容器全部 APPROVE，commit-reveal 全部有效，
`acceptRatio=100% ≥ theta=0.70`，`validReveals=5/5`，最终决策 **COMMIT / READY**。

```text
verifier-proof-01      APPROVE  conf=0.91  [remote http://127.0.0.1:19111] 3ms
verifier-semantic-01   APPROVE  conf=0.98  [remote http://127.0.0.1:19114] 13886ms
verifier-policy-01     APPROVE  conf=0.99  [remote http://127.0.0.1:19113] 33394ms
verifier-proof-02      APPROVE  conf=0.91  [remote http://127.0.0.1:19112] 2ms
verifier-semantic-02   APPROVE  conf=0.95  [remote http://127.0.0.1:19115] 17218ms
FINAL DECISION: COMMIT (acceptRatio=100%, validReveals=5/5)
```

**容错（§11.4 隔离性验收）：** `docker stop agent-verifier-semantic-02` 后再跑，Relayer 探测到该
Agent 不可用并将其移出委员会，委员会降为 4 人，仍满足 `minReveals=4`，达成 COMMIT。停掉的容器
调用失败被记录为不可用，系统优雅降级。

> 注意 LLM 判断依赖 evidenceBundle 字段别名：LLM prompt 读取 `evidence.blockHeight`、
> `evidence.txHash`、`task.query.{type,expected}`；规则型 Agent 读取 `request.txHash`、
> `preVerification.status`、`collectorAttestations` 等。证据要在所有别名上填全，LLM 才会 ACCEPT。

### 17.5 切换到第二阶段（多服务器）的路径

代码已为多服务器部署预留，无需改协商逻辑，只改端点解析：

1. 在每台服务器上跑 Agent 容器（沿用 `docker-compose.agents.yml`，按需拆分到各机）。
2. 在编排端重建链下目录，把端点指向真实主机/IP：
   ```bash
   AGENT_ENDPOINT_HOST=10.0.0.21 node scripts/setup-agent-directory.js --regenerate
   # 或逐个覆盖（含跨机 + TLS）：
   VERIFIER_PROOF_01_ENDPOINT=https://node-a.example.com:19111 \
   AGENT_ENDPOINT_SCHEME=https node scripts/setup-agent-directory.js --regenerate
   ```
3. 把 `.demo/agents/directory/<agentId>.json`（含该 Agent 的 sharedSecret）安全分发到对应服务器，
   容器仍通过只读卷加载自身密钥。
4. `RemoteAgentClient` 已支持 `tlsConfig`、`sharedSecret`，跨机 HMAC 与 TLS 可直接启用。

仍需补的工程项见 `TODO-plan-20260511.md`：跨机真实网络延迟测量、Byzantine 比例实验、
链上信誉回写在多机下的一致性。

## 18. LLM 后端切换为本地 Ollama（2026-05-28）

原中转站 `https://zyapi.tuluo.top:8888/v1` 失效。改为**本机 GPU 上的本地 Ollama**，免费、无需 key、
无需梯子、不再受中转站宕机/限流影响。代码无需改动（`llm_client.js` 已支持 `ollama` 后端），仅改配置。

### 18.1 模型分配（异构 B/C 策略）

| 容器 / Agent | 策略 | 后端 | 模型 |
|---|---|---|---|
| verifier-proof-01 / 02 | A_PROOF_VALIDATOR | 规则 | 无 LLM |
| verifier-policy-01 | B_POLICY_CHECKER | ollama | **llama3.1:8b** |
| verifier-semantic-01 / 02 | C_SEMANTIC_REASONER | ollama | **qwen2.5:14b** |

GPU：NVIDIA RTX 3090 Ti（24GB）。Ollama 0.24.0 用户态安装在 `/mnt/fast18/xunuo/qkl/ollama`，
模型存 `…/ollama/models`，服务监听 `0.0.0.0:11434`。

### 18.2 网络方案与一个关键坑

本机 `ufw` 拦截 docker bridge → host 的 INPUT 流量，且无 root 无法改防火墙，导致 bridge 网络里的容器
**无法访问宿主机的 Ollama**（`172.19.0.1:11434` 从容器 fetch 失败，但宿主机 loopback 正常）。

> 同时 Docker Hub 在本机不可达，`docker pull ollama/ollama`（及 daocloud 镜像）反复失败，
> 所以"把 Ollama 也跑成 bridge 网络里的 sibling 容器"这条路走不通。注意：Ollama 的**模型** blob
> 来自 `registry.ollama.ai`，下载正常；失败的只是 Docker Hub 的镜像层。

最终方案：**5 个 Agent 容器改用 `network_mode: host`**，通过 loopback `http://127.0.0.1:11434` 访问
宿主机 Ollama（ufw 放行 loopback）。host 网络仍保留每容器独立的进程/端口/密钥/日志/HTTP+HMAC 隔离，
只是共享宿主机网络命名空间；这对第二阶段（每台服务器各跑本地 Ollama）也是自然形态。

### 18.3 复现实测

```bash
cd /mnt/fast18/xunuo/qkl/cross-chain/fabric-chaincode/Relayer
bash scripts/start-ollama.sh          # 启动本地 Ollama（GPU），首次需已 pull 模型
# 已配置：Relayer/.env -> LLM_BACKEND=ollama, LLM_BASE_URL=http://127.0.0.1:11434
docker compose -f docker-compose.agents.yml up -d
node scripts/demo-negotiation-containers.js --json
```

模型拉取（一次性）：
```bash
OLLAMA_MODELS=/mnt/fast18/xunuo/qkl/ollama/models \
LD_LIBRARY_PATH=/mnt/fast18/xunuo/qkl/ollama/lib/ollama \
/mnt/fast18/xunuo/qkl/ollama/bin/ollama pull qwen2.5:14b
# ... pull llama3.1:8b
```

### 18.4 实测结果

5 容器全部 APPROVE → `acceptRatio=100% ≥ 0.70` → **COMMIT/READY**：

```text
verifier-proof-01      APPROVE  conf=0.91  [127.0.0.1:19111] 6ms     (规则)
verifier-semantic-01   APPROVE  conf=1.00  [127.0.0.1:19114] 1422ms  (qwen2.5:14b)
verifier-policy-01     APPROVE  conf=0.90  [127.0.0.1:19113] 4013ms  (llama3.1:8b)
verifier-proof-02      APPROVE  conf=0.91  [127.0.0.1:19112] 5ms     (规则)
verifier-semantic-02   APPROVE  conf=1.00  [127.0.0.1:19115] 3667ms  (qwen2.5:14b)
FINAL DECISION: COMMIT (validReveals=5/5)  总协商耗时 9.1s
```

本地模型单次推理约 1.4–4s（warm），整轮协商约 9s——比远程中转站（约 64s）快约 7 倍，且零费用、零外部依赖。
