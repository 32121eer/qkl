# 跨链项目交接文档

## 项目背景

本项目实现了 **Hyperledger Fabric** 和 **FISCO-BCOS** 两条区块链之间的跨链互操作性。通过 Relayer 中继服务，实现了两条链之间的消息自动转发和验证。

**开发时间：** 2026年2月  
**当前状态：** 基础功能已完成，可实现双向跨链调用

---

## 技术栈

### 区块链平台
- **Hyperledger Fabric**: v2.5+, Chaincode (JavaScript)
- **FISCO-BCOS**: v3.x, Solidity 智能合约

### Relayer 服务
- **运行环境**: Node.js v18+
- **核心库**:
  - `@hyperledger/fabric-gateway`: Fabric SDK
  - `fabric-protos`: Fabric 区块解析
  - `ethers.js`: FISCO-BCOS 交互
  - `@grpc/grpc-js`: gRPC 通信

---

## 核心组件

### 1. FISCO-BCOS 智能合约

#### ChainRegistryAir.sol
- **功能**: 注册和管理跨链网络
- **位置**: `fisco-bcos/console/contracts/solidity/ChainRegistryAir.sol`

#### LightClientAir.sol
- **功能**: 存储和验证其他链的区块头
- **关键方法**:
  - `submitBlockHeader()`: 提交区块头
  - `verifyBlockHeader()`: 验证区块头
  - `getLatestBlockNumber()`: 获取最新区块号

#### GatewayAir.sol
- **功能**: 跨链消息网关
- **关键方法**:
  - `send()`: 发起跨链调用（触发 `CrossChainCall` 事件）
  - `receive()`: 接收跨链消息（完整验证，包含 Merkle Proof）
  - `receiveLite()`: 接收跨链消息（轻量级验证，仅验证区块头）

**当前使用**: `receiveLite` (Fabric 难以提供 Merkle Proof)

---

### 2. Fabric Chaincode

#### gateway_cc
- **语言**: JavaScript
- **位置**: `fabric-chaincode/gateway_cc/`
- **关键方法**:
  - `Send()`: 发起跨链调用（触发 `CrossChainCall` 事件）
  - `Receive()`: 接收来自其他链的消息

---

### 3. Relayer 服务

#### 核心文件

| 文件 | 功能 |
|------|------|
| `relayer.js` | 主程序，协调监控器和处理器 |
| `config.json` | 配置文件（合约地址、RPC 端点等）|
| `monitors/fabric_monitor.js` | 监控 Fabric 链的事件和区块 |
| `monitors/fisco_bcos_monitor.js` | 监控 FISCO 链的事件和区块 |
| `handlers/message_handler.js` | 处理跨链消息转发 |
| `extractors/block_header_extractor.js` | 提取和标准化区块头 |
| `test-crosschain.js` | 测试脚本（发起 Fabric→FISCO 调用）|

---

## 工作流程

### Fabric → FISCO

```
1. 用户调用 Fabric Chaincode: gateway_cc.Send()
   ↓
2. Fabric 触发 CrossChainCall 事件
   ↓
3. FabricMonitor 捕获事件
   ↓
4. Relayer 提取 Fabric 区块头
   ↓
5. Relayer 提交区块头到 FISCO LightClientAir
   ↓
6. MessageHandler 调用 GatewayAir.receiveLite()
   ↓
7. FISCO 验证区块头并执行
```

### FISCO → Fabric

```
1. 用户调用 FISCO 合约: GatewayAir.send()
   ↓
2. FISCO 触发 CrossChainCall 事件
   ↓
3. FiscoBcosMonitor 捕获事件
   ↓
4. Relayer 提取 FISCO 区块头
   ↓
5. Relayer 提交区块头到 Fabric Chaincode
   ↓
6. MessageHandler 调用 gateway_cc.Receive()
   ↓
7. Fabric 验证并执行
```

---

## 关键实现细节

### 1. 区块头顺序性

**问题**: LightClient 要求区块头按顺序提交（n, n+1, n+2...）

**解决方案**:
- `relayer.js` 中的 `handleCrossChainEvent()` 检查目标链的 LightClient 当前最新区块号
- 如果有缺失的中间区块，自动补齐提交

**代码位置**: `relayer.js` 第 80-120 行

---

### 2. Fabric 区块号处理

**问题**: Fabric 区块号可能是 `Long` 类型，直接转换会导致 `NaN`

**解决方案**:
```javascript
// extractors/block_header_extractor.js
let blockNumber;
if (typeof block.header.number === 'object' && block.header.number.toNumber) {
    blockNumber = block.header.number.toNumber();
} else if (typeof block.header.number === 'bigint') {
    blockNumber = Number(block.header.number);
} else {
    blockNumber = parseInt(block.header.number);
}
```

---

### 3. FISCO 合约调用

**问题**: `ethers.js` 无法直接调用 FISCO 合约（与标准 Ethereum 不完全兼容）

**解决方案**: 使用 `console.sh` 命令行工具调用
```javascript
// handlers/message_handler.js
const { execFile } = require('child_process');
await execFile('./console.sh', [
    'call', 'GatewayAir', gatewayAddress, 'receiveLite',
    sourceChain, blockNumber.toString(), txId, blockHeaderHex
]);
```

---

### 4. 验证方式选择

**完整验证 (`receive`)**:
- 验证区块头 + Merkle Proof
- 安全性高
- Fabric 难以提供 Merkle Proof（区块结构复杂）

**轻量级验证 (`receiveLite`)**:
- 仅验证区块头
- 安全性中等（依赖 LightClient 的区块链历史）
- 适合 Fabric

**配置位置**: `config.json` → `fisco.receiveMethod`

---

## 部署流程

### 1. 环境准备

**FISCO-BCOS**:
```bash
cd fisco-bcos
bash start_all.sh
```

**Fabric**:
```bash
cd fabric-test-network
./network.sh up createChannel -ca -s couchdb
```

---

### 2. 自动部署（推荐）

```bash
cd /home/tr/projects/cross-chain
bash ./start-all.sh
```

**功能**:
- 启动 FISCO 和 Fabric 网络
- 自动部署所有合约和 Chaincode
- 自动更新 `config.json`

---

### 3. 手动部署（仅开发调试）

#### FISCO 合约

```bash
cd fisco-bcos/console
./console.sh deploy ChainRegistryAir
./console.sh deploy LightClientAir
./console.sh deploy GatewayAir <ChainRegistry地址> <LightClient地址>
```

#### Fabric Chaincode

```bash
cd fabric-test-network
./network.sh deployCC -ccn gateway_cc -ccp ../fabric-chaincode -ccl javascript
```

#### 更新配置

手动编辑 `fabric-chaincode/Relayer/config.json`，填入合约地址。

---

### 4. 启动 Relayer

```bash
cd fabric-chaincode/Relayer
npm install
npm start | tee ~/relayer.log
```

---

## 测试验证

### Fabric → FISCO

```bash
cd fabric-chaincode/Relayer
node test-crosschain.js

# 查看日志
grep "CrossChainCall event detected" ~/relayer.log
grep "GatewayAir.receiveLite" ~/relayer.log
```

### FISCO → Fabric

```bash
cd fisco-bcos/console

# 读取 Gateway 地址
GATEWAY=$(cat ../../fabric-chaincode/Relayer/config.json | jq -r '.fisco.contracts.gateway')

# 发起调用
./console.sh call GatewayAir $GATEWAY send \
  "FABRIC_NET_01" \
  "mychannel/gateway_cc" \
  "Receive" \
  0x48656c6c6f

# 查看日志
grep "FISCO.*CrossChainCall" ~/relayer.log
```

---

## 已知问题与限制

### 1. Merkle Proof 未实现
- **影响**: 无法使用 `receive()` 方法进行完整验证
- **当前方案**: 使用 `receiveLite()` 仅验证区块头
- **TODO**: 实现 Fabric 区块的 Merkle Proof 生成

### 2. LightClient 区块清理
- **问题**: LightClient 会无限累积区块头
- **影响**: 长期运行后存储膨胀
- **TODO**: 实现区块头定期清理机制

### 3. 错误恢复
- **问题**: Relayer 异常退出后，可能丢失未处理的事件
- **当前方案**: 手动重启 Relayer
- **TODO**: 实现断点续传机制

### 4. 性能优化
- **问题**: 每次跨链调用都需要提交区块头（较慢）
- **TODO**: 实现区块头批量提交

---

## 配置说明

### config.json 关键字段

```json
{
  "fisco": {
    "rpcUrl": "http://127.0.0.1:8545",       // FISCO JSON-RPC 端点
    "groupId": "group0",                     // FISCO 群组 ID
    "chainId": "chain0",                     // FISCO 链 ID
    "receiveMethod": "receiveLite",          // 验证方式: receive | receiveLite
    "contracts": {
      "chainRegistry": "0x...",              // ChainRegistryAir 地址
      "lightClient": "0x...",                // LightClientAir 地址
      "gateway": "0x..."                     // GatewayAir 地址
    }
  },
  "fabric": {
    "channelName": "mychannel",              // Fabric 通道名
    "chaincodeName": "gateway_cc",           // Chaincode 名称
    "mspId": "Org1MSP",                      // MSP ID
    "peerEndpoint": "grpcs://localhost:7051", // Peer 端点
    "certPath": "...",                       // 证书路径
    "keyPath": "...",                        // 私钥路径
    "tlsCertPath": "..."                     // TLS 证书路径
  }
}
```

---

## 目录结构

```
cross-chain/
├── start-all.sh                    # 一键启动脚本
├── bootstrap.sh                    # 合约自动部署脚本
├── CROSSCHAIN_GUIDE.md             # 操作指南
├── CROSSCHAIN_HANDOVER.md          # 本文档
├── fisco-bcos/                     # FISCO-BCOS 节点
│   ├── start_all.sh
│   ├── stop_all.sh
│   └── console/
│       ├── console.sh
│       └── contracts/solidity/
│           ├── ChainRegistryAir.sol
│           ├── LightClientAir.sol
│           ├── GatewayAir.sol
│           ├── IChainRegistry.sol
│           └── ILightClient.sol
├── fabric-test-network/            # Fabric 测试网络
│   ├── network.sh
│   └── organizations/
└── fabric-chaincode/
    ├── gateway_cc/                 # Fabric Chaincode
    │   ├── index.js
    │   └── lib/
    │       └── gateway.js
    ├── fisco-bcos/                 # FISCO 合约副本（用于 Relayer）
    │   └── console/contracts/solidity/
    └── Relayer/                    # Relayer 服务
        ├── package.json
        ├── config.json
        ├── config.example.json
        ├── relayer.js
        ├── test-crosschain.js
        ├── monitors/
        │   ├── fabric_monitor.js
        │   └── fisco_bcos_monitor.js
        ├── handlers/
        │   └── message_handler.js
        └── extractors/
            └── block_header_extractor.js
```

---

## 维护建议

### 日常运行

1. **定期检查日志**:
```bash
tail -f ~/relayer.log
```

2. **监控 Relayer 进程**:
```bash
ps aux | grep "node.*relayer"
```

3. **重启网络后重新部署**:
```bash
bash ./start-all.sh
```

---

### 开发调试

1. **修改合约后重新部署**:
```bash
bash ./bootstrap.sh --redeploy-fisco --receive-method receiveLite
```

2. **查看 FISCO 合约调用详情**:
```bash
cd fisco-bcos/console
./console.sh call GatewayAir <地址> processedCalls <callId>
```

3. **查看 Fabric Chaincode 日志**:
```bash
docker logs peer0.org1.example.com 2>&1 | grep "gateway_cc"
```

---

## 扩展方向

### 短期优化
1. 实现 Fabric Merkle Proof 生成（启用完整验证）
2. 添加 Relayer 健康检查接口
3. 实现配置热更新

### 长期规划
1. 支持更多区块链平台（Ethereum, Cosmos 等）
2. 实现去中心化 Relayer 网络
3. 添加跨链交易手续费机制
4. 实现跨链资产转移（不仅是消息）

---

## 联系与支持

**项目文档**:
- 操作指南: `CROSSCHAIN_GUIDE.md`
- 本交接文档: `CROSSCHAIN_HANDOVER.md`

**日志文件**:
- Relayer: `~/relayer.log`
- FISCO: `fisco-bcos/nodes/127.0.0.1/node0/log/`
- Fabric: Docker 容器日志

**关键命令**:
```bash
# 完整启动
bash ./start-all.sh

# 重新部署合约
bash ./bootstrap.sh --redeploy-fisco --receive-method receiveLite

# 启动 Relayer（日志模式）
cd fabric-chaincode/Relayer && npm start | tee ~/relayer.log

# 测试 Fabric → FISCO
cd fabric-chaincode/Relayer && node test-crosschain.js

# 查看日志
grep "MessageHandler" ~/relayer.log
```

---

## 版本历史

- **v0.1** (2026-02-06): 初始版本，实现基础跨链互通
- 实现 `receiveLite` 轻量级验证
- 自动化部署脚本 (`start-all.sh`, `bootstrap.sh`)
- 日志模式运行

---

**祝工作顺利！如有问题，请参考本文档和 `CROSSCHAIN_GUIDE.md`。**

