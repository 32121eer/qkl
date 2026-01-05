# 跨链系统操作指南

## 一、系统架构

```
┌─────────────────┐         ┌─────────────────┐         ┌─────────────────┐
│   FISCO-BCOS    │         │     Relayer     │         │    Fabric       │
│   (4 nodes)     │ <-----> │   (Node.js)     │ <-----> │  (test-network) │
│   Port: 8545    │         │                 │         │   Port: 7051    │
└─────────────────┘         └─────────────────┘         └─────────────────┘
```

## 二、关键路径

> **注意**：以下路径假设项目克隆在 `/home/tr/projects/cross-chain/`，请根据实际情况调整。

| 组件 | 路径 | 说明 |
|------|------|------|
| **项目根目录** | `/home/tr/projects/cross-chain/` | 可配置 |
| FISCO 节点 | `<项目根目录>/fisco-bcos/nodes/127.0.0.1/` | 项目内部 |
| FISCO Console | `<项目根目录>/fisco-bcos/console/` | 项目内部 |
| Relayer | `<项目根目录>/fabric-chaincode/Relayer/` | 项目内部 |
| Gateway 链码 | `<项目根目录>/fabric-chaincode/my-chain-code/gateway_cc/` | 项目内部 |
| **Fabric 网络** | `/home/tr/fabric-samples/test-network/` | 外部依赖，需单独配置 |

## 三、关键配置文件

### 1. Relayer 配置 (`Relayer/config.json`) 【需要配置】

> ⚠️ **重要配置文件**：需根据实际环境修改 `cryptoPath` 和 FISCO 合约地址

```json
{
  "relayer": {
    "privateKey": "0xc85f4d8bb7b633cd48c2a7a8e4d62a4cf2a82404466d862a17d4692ff89744cf"
  },
  "chains": [
    {
      "chainId": "FABRIC_NET_01",
      "type": "FABRIC",
      "connection": {
        "cryptoPath": "/home/tr/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com",
        "peerEndpoint": "localhost:7051"
      },
      "contracts": { "gateway": "gateway_cc" }
    },
    {
      "chainId": "FISCO_NET_01",
      "type": "FISCO_BCOS",
      "rpc": { "endpoint": "http://127.0.0.1:8545" },
      "contracts": { "gateway": "0xcceef68c9b4811b32c75df284a1396c7c5509561" }
    }
  ]
}
```

**需要根据实际环境修改的字段：**
- `chains[0].connection.cryptoPath` - Fabric 证书路径
- `chains[1].contracts.gateway` - FISCO Gateway 合约地址（每次部署会变化）

### 2. FISCO Console 配置 (`console/conf/config.toml`)
```toml
[cryptoMaterial]
disableSsl = "true"

[network]
peers=["127.0.0.1:20203"]
```

### 3. FISCO 节点配置要点 (`node*/config.ini`)
- `[rpc] disable_ssl=true` - 禁用 SSL
- `[web3_rpc] enable=true` (仅 node3)
- 各节点端口不同（避免冲突）

## 四、一键启动脚本

### `start-all.sh` - 启动所有服务

> 该脚本已改用相对路径，会自动检测项目根目录。  
> 如需修改 fabric-samples 位置，可设置环境变量 `FABRIC_SAMPLES_DIR`

```bash
# 使用方式（在 Relayer 目录下执行）：
cd <项目根目录>/fabric-chaincode/Relayer
./start-all.sh

# 或者指定 fabric-samples 路径：
FABRIC_SAMPLES_DIR=/your/path/fabric-samples ./start-all.sh
```

### `start-relayer.sh` - 启动 Relayer
```bash
#!/bin/bash
# 进入 Relayer 目录并启动
cd "$(dirname "$0")"
npm start
```

### `start-console.sh` - 启动 FISCO Console
```bash
#!/bin/bash
# 进入 console 目录并启动
cd "$(dirname "$0")/../../fisco-bcos/console"
./start.sh
# 如果 start.sh 报错，可尝试直接使用 Java 11：
# /usr/lib/jvm/java-11-openjdk-amd64/bin/java -cp "apps/*:lib/*:conf/" console.Console
```

## 五、快速启动流程

> 假设项目根目录为 `~/projects/cross-chain`

```bash
# 终端 1: 启动区块链（FISCO + Fabric + 部署链码）
cd ~/projects/cross-chain/fabric-chaincode/Relayer
./start-all.sh

# 终端 2: 启动 Relayer
cd ~/projects/cross-chain/fabric-chaincode/Relayer
npm start

# 终端 3: 启动 FISCO Console (用于测试)
cd ~/projects/cross-chain/fisco-bcos/console
./start.sh
# 如果报错用 Java 11:
# /usr/lib/jvm/java-11-openjdk-amd64/bin/java -cp "apps/*:lib/*:conf/" console.Console
```

## 六、测试跨链

### 方向 1: Fabric → FISCO

```bash
# 在 Relayer 目录执行
node test-crosschain.js
```

### 方向 2: FISCO → Fabric

在 FISCO Console 中执行：
```
call Gateway 0xcceef68c9b4811b32c75df284a1396c7c5509561 send "FABRIC_NET_01" "mychannel/gateway_cc" "Receive" 0x48656c6c6f
```

### 验证成功
观察 Relayer 日志：
- `[FiscoBcosMonitor] 🎯 CrossChainCall event detected!`
- `[MessageHandler] ✅ Fabric transaction success`

## 七、常见问题排查

| 问题 | 解决方案 |
|------|----------|
| 权限错误 | `chmod -R +x /home/tr/projects/fisco-bcos/nodes/127.0.0.1/*.sh` |
| 端口冲突 | 确保各 node 的 web3_rpc 端口不同（或只启用 node3 的） |
| Console 连接失败 | 检查 `config.toml` 中 peers 端口与 node 配置一致 |
| FISCO 写入超时 | 需要至少 3 个节点运行（PBFT 共识） |
| Fabric 连接失败 | 检查 Docker 容器状态，peer 端口映射 |

## 八、下一步：绕过 Console 自动调用 FISCO

### 当前限制
- ethers.js 发送交易不兼容 FISCO-BCOS（nonce 格式不同）
- 必须通过 Console 手动执行写入操作

### 解决方案选项

#### 方案 A: 使用 FISCO Python SDK
```python
from bcos3sdk.bcos3client import Bcos3Client
client = Bcos3Client()
result = client.call("Gateway", "receive", [...])
```

#### 方案 B: 使用 FISCO Java SDK（推荐）
参考 `D:\myproject\fisco\fisco\relay\` 中的 Java 实现

#### 方案 C: 通过 Console 子进程调用
```javascript
const { execSync } = require('child_process');
const cmd = `cd /home/tr/projects/fisco-bcos/console && echo 'call Gateway ${address} receive ...' | java -cp "apps/*:lib/*:conf/" console.Console`;
execSync(cmd);
```

## 九、合约地址

| 链 | 合约 | 地址 |
|----|------|------|
| FISCO | Gateway | `0xcceef68c9b4811b32c75df284a1396c7c5509561` |
| FISCO | Registry | `0x31ed5233b81c79d5adddeef991f531a9bbc2ad01` |
| Fabric | gateway_cc | `gateway_cc` (链码名) |

## 十、文件结构

```
cross-chain/                        # 项目根目录
├── CROSSCHAIN_GUIDE.md             # 操作指南（本文档）
├── CROSSCHAIN_HANDOVER.md          # 对接文档
├── fabric-chaincode/
│   ├── Relayer/
│   │   ├── index.js                # 入口
│   │   ├── relayer.js              # 核心调度
│   │   ├── config.json             # 【需配置】主配置文件
│   │   ├── monitors/
│   │   │   ├── fabric_monitor.js   # Fabric 事件监听
│   │   │   └── fisco_bcos_monitor.js # FISCO 事件监听
│   │   ├── handlers/
│   │   │   └── message_handler.js  # 消息转发
│   │   ├── abi/
│   │   │   └── Gateway.json        # FISCO 合约 ABI
│   │   ├── start-all.sh            # 一键启动脚本
│   │   ├── test-crosschain.js      # 测试脚本 (Fabric→FISCO)
│   │   └── test-fisco-call.js      # FISCO 调用测试
│   └── my-chain-code/
│       └── gateway_cc/             # Fabric 链码
│           └── gateway_cc.go
└── fisco-bcos/
    ├── nodes/127.0.0.1/
    │   ├── node0-3/                # 4 个节点
    │   └── start_all.sh
    └── console/
        ├── conf/config.toml        # Console 配置
        └── contracts/solidity/
            └── Gateway.sol         # FISCO 合约
```

## 十一、配置文件汇总

| 文件 | 位置 | 需要配置的内容 |
|------|------|----------------|
| `config.json` | `fabric-chaincode/Relayer/` | Fabric 证书路径、FISCO 合约地址 |
| `config.toml` | `fisco-bcos/console/conf/` | FISCO 节点连接端口 |
| 环境变量 | 启动脚本 | `FABRIC_SAMPLES_DIR`（可选） |

---

**最后更新**: 2026-01-05

