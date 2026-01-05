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

| 组件 | 路径 |
|------|------|
| FISCO 节点 | `/home/tr/projects/fisco-bcos/nodes/127.0.0.1/` |
| FISCO Console | `/home/tr/projects/fisco-bcos/console/` |
| Fabric 网络 | `/home/tr/fabric-samples/test-network/` |
| Relayer | `/home/tr/projects/fabric-chaincode/Relayer/` |
| Gateway 链码 | `/home/tr/projects/fabric-chaincode/my-chain-code/gateway_cc/` |

## 三、关键配置文件

### 1. Relayer 配置 (`Relayer/config.json`)
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
```bash
#!/bin/bash
set -e

echo "========== 跨链系统启动脚本 =========="

# 1. 修复权限
echo "[1/5] 修复脚本权限..."
chmod -R +x /home/tr/projects/fisco-bcos/nodes/127.0.0.1/*.sh
chmod -R +x /home/tr/projects/fisco-bcos/nodes/127.0.0.1/node*/*.sh
chmod +x /home/tr/projects/fisco-bcos/console/*.sh

# 2. 启动 FISCO 节点
echo "[2/5] 启动 FISCO 节点..."
cd /home/tr/projects/fisco-bcos/nodes/127.0.0.1
./stop_all.sh 2>/dev/null || true
sleep 2
./start_all.sh
sleep 5
echo "  FISCO 节点数量: $(ps aux | grep fisco-bcos | grep -v grep | wc -l)"

# 3. 启动 Fabric 网络
echo "[3/5] 启动 Fabric 网络..."
cd /home/tr/fabric-samples/test-network
./network.sh down 2>/dev/null || true
./network.sh up createChannel -c mychannel
sleep 3

# 4. 部署 Fabric 链码
echo "[4/5] 部署 gateway_cc 链码..."
./network.sh deployCC -ccn gateway_cc -ccp /home/tr/projects/fabric-chaincode/my-chain-code/gateway_cc -ccl go

# 5. 提示启动 Relayer
echo "[5/5] 请在新终端启动 Relayer:"
echo "  cd /home/tr/projects/fabric-chaincode/Relayer && npm start"

echo ""
echo "========== 启动完成 =========="
echo "FISCO RPC: http://127.0.0.1:8545"
echo "FISCO SDK: 127.0.0.1:20203"
echo "Fabric Peer: localhost:7051"
```

### `start-relayer.sh` - 启动 Relayer
```bash
#!/bin/bash
cd /home/tr/projects/fabric-chaincode/Relayer
npm start
```

### `start-console.sh` - 启动 FISCO Console
```bash
#!/bin/bash
cd /home/tr/projects/fisco-bcos/console
/usr/lib/jvm/java-11-openjdk-amd64/bin/java -cp "apps/*:lib/*:conf/" console.Console
```

## 五、快速启动流程

```bash
# 终端 1: 启动区块链
cd /home/tr/projects/fabric-chaincode/Relayer
./start-all.sh

# 终端 2: 启动 Relayer
cd /home/tr/projects/fabric-chaincode/Relayer
npm start

# 终端 3: 启动 FISCO Console (用于测试)
cd /home/tr/projects/fisco-bcos/console
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
fabric-chaincode/
├── Relayer/
│   ├── index.js              # 入口
│   ├── relayer.js            # 核心调度
│   ├── config.json           # 配置
│   ├── monitors/
│   │   ├── fabric_monitor.js # Fabric 事件监听
│   │   └── fisco_bcos_monitor.js # FISCO 事件监听
│   ├── handlers/
│   │   └── message_handler.js # 消息转发
│   ├── abi/
│   │   └── Gateway.json      # FISCO 合约 ABI
│   ├── test-crosschain.js    # 测试脚本 (Fabric→FISCO)
│   └── test-fisco-call.js    # FISCO 调用测试
└── my-chain-code/
    └── gateway_cc/           # Fabric 链码
        └── gateway_cc.go

fisco-bcos/
├── nodes/127.0.0.1/
│   ├── node0-3/              # 4 个节点
│   └── start_all.sh
├── console/
│   ├── conf/config.toml      # Console 配置
│   └── contracts/solidity/
│       └── Gateway.sol       # FISCO 合约
```

---

**最后更新**: 2025-12-25

