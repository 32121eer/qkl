# 跨链项目架构与状态总结 - 2026年2月6日

## 📋 项目概览

**项目名称**: FISCO-BCOS ⇄ Hyperledger Fabric 跨链互通系统  
**当前版本**: v2.0  
**项目路径**: `/home/tr/projects/cross-chain` (WSL Ubuntu)  
**远程仓库**: https://gitee.com/sednatr/cross-chain.git  
**状态**: ✅ 核心功能已实现，双向跨链测试通过

---

## 🏗️ 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                    跨链系统整体架构                          │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────┐         ┌──────────────┐                 │
│  │ FISCO-BCOS   │◄───────►│   Relayer    │◄───────►        │
│  │              │   事件    │   (Node.js)  │   事件          │
│  │ - Gateway    │   监听    │              │   监听          │
│  │ - LightClient│         │ - Monitor     │                 │
│  │ - Registry   │         │ - Handler     │                 │
│  └──────────────┘         │ - Extractor   │                 │
│         ▲                  └──────────────┘                 │
│         │                         │                          │
│         │                         ▼                          │
│         │                  ┌──────────────┐                 │
│         └──────区块头───────│ Hyperledger  │                 │
│           验证             │   Fabric     │                 │
│                            │              │                 │
│                            │ - gateway_cc │                 │
│                            │ - peer/orderer│                 │
│                            └──────────────┘                 │
└─────────────────────────────────────────────────────────────┘
```

### 核心组件

1. **FISCO-BCOS 侧**
   - 智能合约：GatewayAir, LightClientAir, ChainRegistryAir
   - Console：部署和调用合约的命令行工具
   - 节点：4 节点 PBFT 共识网络

2. **Hyperledger Fabric 侧**
   - Chaincode：gateway_cc (JavaScript)
   - 网络：test-network (2 Org, 1 Orderer, CouchDB)
   - 通道：mychannel

3. **Relayer 中继服务**
   - 监听器：监听两条链的事件
   - 提取器：标准化区块头
   - 处理器：转发跨链消息

---

## 📂 目录结构

```
/home/tr/projects/cross-chain/
├── fisco-bcos/                          # FISCO-BCOS 相关
│   └── console/                         # FISCO 控制台
│       ├── console.sh                   # 控制台脚本
│       ├── deploylog.txt                # 部署记录
│       └── contracts/
│           └── solidity/
│               ├── GatewayAir.sol       # 网关合约 ★
│               ├── LightClientAir.sol   # 轻客户端合约 ★
│               ├── ChainRegistryAir.sol # 链注册表合约 ★
│               ├── IChainRegistry.sol   # 接口 ★
│               └── ILightClient.sol     # 接口 ★
│
├── fabric-chaincode/                    # Fabric 相关
│   ├── gateway_cc/                      # Gateway Chaincode ★
│   │   ├── index.js
│   │   ├── lib/gateway.js
│   │   └── package.json
│   │
│   ├── Relayer/                         # 中继服务 ★
│   │   ├── index.js                     # 入口
│   │   ├── config.json                  # 配置文件
│   │   ├── relayer.js                   # 核心逻辑 ★
│   │   ├── monitors/                    # 监听器
│   │   │   ├── fisco_bcos_monitor.js   # FISCO 监听器 ★
│   │   │   └── fabric_monitor.js       # Fabric 监听器 ★
│   │   ├── handlers/
│   │   │   └── message_handler.js      # 消息处理器 ★
│   │   ├── extractors/
│   │   │   └── block_header_extractor.js # 区块头提取器 ★
│   │   └── abi/
│   │       └── Gateway.json             # GatewayAir ABI
│   │
│   └── fisco-bcos/                      # FISCO 合约副本
│       └── console/contracts/solidity/  # 与上面相同
│
├── fabric-samples/                      # Fabric 测试网络
│   └── test-network/
│       ├── network.sh                   # 网络管理脚本
│       └── organizations/               # 证书和配置
│
├── bootstrap.sh                         # 自动化部署脚本 ★
├── start-all.sh                         # 启动脚本 ★
├── CHANGELOG_2026-02-06.md             # 更新日志 ★
├── PROJECT_STATUS_2026-02-06.md        # 本文档 ★
└── README.md

★ = 本次更新的核心文件
```

---

## 🔑 核心功能实现

### 1. LightClient 验证机制

**实现状态**: ✅ 完成

**工作原理**:
1. Relayer 监听源链新区块
2. 提取标准化区块头（chainId, blockNumber, timestamp, previousHash, transactionsRoot, stateRoot）
3. 提交到目标链的 LightClientAir 合约
4. LightClient 验证区块连续性（序号和哈希链）
5. 存储已验证的区块哈希

**关键方法**:
```solidity
// LightClientAir.sol
function submitBlockHeader(
    string chainId,
    uint64 blockNumber,
    uint256 timestamp,
    bytes32 previousHash,
    bytes32 transactionsRoot,
    bytes32 stateRoot,
    string consensusType,
    bytes extraData
) returns (bytes32)

function verifyBlockHeader(
    string chainId,
    uint256 blockNumber,
    bytes blockHeader
) returns (bool)
```

**文件位置**:
- 合约：`fisco-bcos/console/contracts/solidity/LightClientAir.sol`
- 提交逻辑：`fabric-chaincode/Relayer/monitors/fisco_bcos_monitor.js` 第 258-332 行
- 序列验证：`fabric-chaincode/Relayer/relayer.js` 第 207-252 行

---

### 2. 双向跨链消息转发

**实现状态**: ✅ 完成

#### FISCO → Fabric

**流程**:
1. FISCO 用户调用 `GatewayAir.send(targetChain, targetContract, method, data)`
2. 触发 `CrossChainCall` 事件
3. Relayer 的 `FiscoBcosMonitor` 捕获事件
4. `MessageHandler.relayToFabric()` 调用 Fabric Gateway SDK
5. 执行 `gateway_cc.Receive()` chaincode
6. Fabric 触发 `CrossChainReceived` 事件

**关键代码**:
- 事件监听：`fabric-chaincode/Relayer/monitors/fisco_bcos_monitor.js` 第 211-244 行
- 消息转发：`fabric-chaincode/Relayer/handlers/message_handler.js` 第 263-327 行

#### Fabric → FISCO

**流程**:
1. Fabric 用户调用 `gateway_cc.Send(targetChain, targetContract, method, data)`
2. 触发 `CrossChainCall` 事件
3. Relayer 的 `FabricMonitor` 捕获事件
4. Relayer 先确保 Fabric 区块头已提交到 FISCO LightClient
5. `MessageHandler.relayToFiscoBcos()` 通过 `console.sh` 调用 FISCO 合约
6. 执行 `GatewayAir.receiveLite()` 或 `receiveMessage()`
7. FISCO 触发 `CrossChainReceived` 事件

**关键代码**:
- 事件监听：`fabric-chaincode/Relayer/monitors/fabric_monitor.js` 第 73-114 行
- 消息转发：`fabric-chaincode/Relayer/handlers/message_handler.js` 第 151-258 行

---

### 3. receiveLite 轻量级验证

**实现状态**: ✅ 完成

**背景**: Fabric 的交易结构复杂，难以生成标准 Merkle Proof

**解决方案**: receiveLite 模式
- 仅验证区块头存在性
- 跳过 Merkle Proof 验证
- 适用于信任度较高的联盟链场景

**对比**:
```
receiveMessage (完整验证):
  require(lightClient.verifyBlockHeader(...))  ✓
  require(merkleProof.length > 0)              ✓
  // 验证 Merkle Proof (TODO)

receiveLite (轻量级):
  require(lightClient.verifyBlockHeader(...))  ✓
  // 跳过 Merkle Proof
```

**配置**:
```json
// fabric-chaincode/Relayer/config.json
{
  "chains": [{
    "chainId": "FISCO_NET_01",
    "receiveMethod": "receiveLite"  // 或 "receive"
  }]
}
```

---

### 4. 自动化部署

**实现状态**: ✅ 完成

**bootstrap.sh 功能**:
1. 部署 FISCO 合约（按依赖顺序）
   - ChainRegistryAir
   - LightClientAir（传入 ChainRegistry 地址）
   - GatewayAir（传入 ChainRegistry 和 LightClient 地址）
2. 自动注册链到 ChainRegistryAir
   - FABRIC_NET_01
   - FISCO_NET_01
3. 部署 Fabric Chaincode（gateway_cc）
4. 自动更新 `config.json` 中的合约地址

**使用**:
```bash
# 完整部署
./bootstrap.sh

# 重新部署 FISCO 合约
./bootstrap.sh --redeploy-fisco --receive-method receiveLite

# 只部署 FISCO
./bootstrap.sh --skip-fabric-cc
```

---

## 📊 当前部署信息

### FISCO 合约地址（最新）

```
ChainRegistryAir: 0x4532bbeb41b4e1ff0ae2742729156042976fbd53
LightClientAir:   0x73fac4d3107689125edda50beb4ab3dbd0d9fdd0
GatewayAir:       0xbf6d5dadd2f5dfce31faf6aad27b5d3e372b9a17
```

**查看方式**:
```bash
tail -5 /home/tr/projects/cross-chain/fisco-bcos/console/deploylog.txt
```

### Fabric Chaincode

```
Chaincode: gateway_cc
Channel:   mychannel
语言:      JavaScript
版本:      动态（每次部署递增）
```

**查看方式**:
```bash
cd /home/tr/fabric-samples/test-network
./network.sh queryCommitted mychannel
```

### Relayer 配置

```json
{
  "relayer": {
    "privateKey": "0xc85f4d8bb7b633cd48c2a7a8e4d62a4cf2a82404466d862a17d4692ff89744cf",
    "blockConfirmations": 1
  },
  "chains": [
    {
      "chainId": "FABRIC_NET_01",
      "type": "FABRIC",
      "connection": {
        "cryptoPath": "/home/tr/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com",
        "channelName": "mychannel",
        "peerEndpoint": "localhost:7051"
      }
    },
    {
      "chainId": "FISCO_NET_01",
      "type": "FISCO_BCOS",
      "rpc": {
        "endpoint": "http://127.0.0.1:8545"
      },
      "contracts": {
        "gateway": "0xbf6d5dadd2f5dfce31faf6aad27b5d3e372b9a17",
        "lightClient": "0x73fac4d3107689125edda50beb4ab3dbd0d9fdd0",
        "registry": "0x4532bbeb41b4e1ff0ae2742729156042976fbd53"
      },
      "receiveMethod": "receiveLite"
    }
  ]
}
```

---

## 🚀 操作指南

### 完整启动流程

```bash
# 1. 启动区块链网络和部署合约（首次或重置）
cd /home/tr/projects/cross-chain
./start-all.sh

# 2. 快速启动（跳过网络重启）
./start-all.sh --fast

# 3. 启动 Relayer（保持运行）
cd fabric-chaincode/Relayer
rm -f ~/relayer.log
unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY no_proxy NO_PROXY
npm start 2>&1 | tee ~/relayer.log

# 4. 在新终端测试跨链（见下文）
```

### 测试 FISCO → Fabric

```bash
cd /home/tr/projects/cross-chain/fisco-bcos/console

# 获取 Gateway 地址
grep '"gateway"' ../fabric-chaincode/Relayer/config.json | grep "0x"

# 发起跨链调用
./console.sh call GatewayAir <Gateway地址> send '"FABRIC_NET_01"' '"mychannel/gateway_cc"' '"Receive"' 0x48656c6c6f

# 查看 Relayer 日志
grep -E "CrossChainCall|Fabric transaction" ~/relayer.log | tail -10
```

### 测试 Fabric → FISCO

```bash
cd /home/tr/projects/cross-chain/fabric-chaincode/Relayer
unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY no_proxy NO_PROXY
node test-crosschain.js

# 查看 Relayer 日志
grep -E "crossChainEvent|receiveLite|FISCO transaction" ~/relayer.log | tail -10
```

---

## 🐛 已知问题和解决方案

### 1. Docker 代理问题

**现象**: Docker pull 镜像失败，`proxyconnect tcp: dial tcp 172.27.112.1:7890: connect: connection refused`

**解决方案**:
1. 打开 Docker Desktop
2. 进入 Settings → Resources → Proxies
3. 启用 "Manual proxy configuration"
4. 在 "Bypass proxy settings" 中添加：
   ```
   registry-1.docker.io,*.docker.io,docker.com,*.docker.com,localhost,127.0.0.1
   ```
5. Apply & Restart

### 2. Git/npm 代理问题

**现象**: Git push 或 npm install 失败，连接不到 `172.27.112.1:7890`

**解决方案**:
```bash
# 取消环境变量
unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY

# 取消 Git 代理
git config --global --unset http.proxy
git config --global --unset https.proxy

# 取消 npm 代理
npm config delete proxy
npm config delete https-proxy
```

### 3. Fabric 证书问题

**现象**: Relayer 启动报错 `ENOENT: no such file or directory, open '.../User1@org1.example.com/...'`

**解决方案**:
- `fabric_monitor.js` 已改为使用 `Admin@org1.example.com`
- 使用 cryptogen（不是 CA）生成证书：`./network.sh up createChannel -s couchdb`（不加 `-ca`）

### 4. FISCO console "Abi is empty"

**现象**: 调用合约报错 `Abi is empty, please check contract abi exists.`

**原因**: 使用的合约地址与 console 编译缓存中的 ABI 不匹配

**解决方案**:
```bash
# 重新部署合约
./bootstrap.sh --redeploy-fisco --receive-method receiveLite

# 或者复制正确的 ABI
cp fisco-bcos/console/contracts/.compiled/group0/GatewayAir/<地址>/GatewayAir.abi \
   fabric-chaincode/Relayer/abi/Gateway.json
```

---

## 📝 待实现功能

### 高优先级

1. **Fabric 侧 LightClient**
   - 当前：FISCO 区块头无法提交到 Fabric 验证
   - 需要：实现 Fabric chaincode 版本的 LightClient

2. **Merkle Proof 生成（Fabric）**
   - 当前：Fabric 侧只能使用 receiveLite
   - 需要：实现 Fabric 交易的 Merkle Proof 生成逻辑

3. **错误重试机制**
   - 当前：消息转发失败后不重试
   - 需要：实现失败消息队列和重试逻辑

### 中优先级

4. **批量区块头提交**
   - 当前：逐个提交区块头
   - 优化：批量提交提高性能

5. **监控和告警**
   - 增加 Prometheus metrics 暴露
   - 增加日志分级和告警机制
   - 增加健康检查接口

6. **测试覆盖**
   - 单元测试
   - 集成测试
   - 压力测试

### 低优先级

7. **多 Relayer 支持**
   - 当前：单点 Relayer
   - 优化：多 Relayer 竞争机制

8. **前端界面**
   - 跨链交易查询
   - 状态监控仪表盘

---

## 🔧 开发环境

### 系统环境

```
操作系统: Windows 11 + WSL2 Ubuntu
Docker:   Docker Desktop for Windows
Node.js:  v16+ (Relayer)
Go:       1.20+ (Fabric)
Java:     11+ (FISCO Console)
Python:   3.x (部署脚本)
```

### 依赖管理

**Relayer (npm)**:
```bash
cd fabric-chaincode/Relayer
npm install
```

主要依赖：
- `@hyperledger/fabric-gateway`: Fabric SDK
- `ethers`: FISCO-BCOS 交互
- `fabric-protos`: Fabric 区块解析

**Fabric Chaincode (npm)**:
```bash
cd fabric-chaincode/gateway_cc
npm install
```

### 端口使用

```
FISCO-BCOS:
  - 20200: P2P 端口
  - 8545:  RPC 端口

Fabric:
  - 7051:  Peer0.Org1 (Peer)
  - 9051:  Peer0.Org2 (Peer)
  - 7050:  Orderer (Orderer)
  - 5984:  CouchDB (State DB)

Relayer:
  - 8080:  API 端口（可选，当前禁用）
```

---

## 📚 相关文档

1. **CHANGELOG_2026-02-06.md** - 本次更新的详细改动日志
2. **CROSSCHAIN_GUIDE.md** - 跨链使用指南（如果存在）
3. **CROSSCHAIN_HANDOVER.md** - 交接文档（如果存在）

---

## 🎯 后续开发建议

### 给新 Agent 的提示

1. **理解架构优先**
   - 先运行一遍完整流程，理解数据流向
   - 查看 Relayer 日志，了解事件触发顺序

2. **阅读核心代码**
   - `relayer.js` - 理解整体流程
   - `fisco_bcos_monitor.js` 和 `fabric_monitor.js` - 理解事件监听
   - `message_handler.js` - 理解消息转发

3. **本地测试环境**
   - 确保 Docker Desktop 代理配置正确
   - 确保环境变量中无代理设置
   - 使用 `tail -f ~/relayer.log` 实时查看日志

4. **调试技巧**
   - FISCO 交易状态：通过 `console.sh` 查看
   - Fabric 交易状态：通过 `peer chaincode query` 查看
   - Relayer 状态：通过日志文件 grep 过滤

5. **常见坑点**
   - 合约地址必须与 ABI 匹配
   - 链必须在 ChainRegistry 中注册
   - 区块头必须按顺序提交到 LightClient
   - 事件参数名必须与合约定义完全一致

---

## 📞 联系信息

**项目维护者**: tr  
**最后更新**: 2026年2月6日  
**文档版本**: v1.0

---

## ✅ 交接清单

在开始后续开发前，请确认：

- [ ] 能够成功启动 FISCO-BCOS 网络
- [ ] 能够成功启动 Fabric 网络
- [ ] 能够成功部署所有合约和 chaincode
- [ ] 能够成功启动 Relayer
- [ ] 能够成功执行 FISCO → Fabric 测试
- [ ] 能够成功执行 Fabric → FISCO 测试
- [ ] 理解 LightClient 验证流程
- [ ] 理解 receiveLite 和 receiveMessage 的区别
- [ ] 知道如何查看部署日志和 Relayer 日志
- [ ] 知道如何处理常见错误（代理、证书、ABI）

**如有疑问，请参考 CHANGELOG_2026-02-06.md 获取详细的技术细节。**

