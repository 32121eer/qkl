# 跨链项目对接文档

## 一、项目概述

本项目实现 **Hyperledger Fabric ↔ FISCO BCOS** 的跨链通信。

### 架构图

```
┌─────────────┐                              ┌─────────────┐
│   Fabric    │                              │ FISCO BCOS  │
│             │                              │             │
│ gateway_cc  │◄─────── Relayer ───────────►│  Gateway    │
│ registry_cc │        (Node.js)            │  合约       │
└─────────────┘                              └─────────────┘
```

---

## 二、Fabric 端已完成功能

| 组件 | 功能 | 状态 |
|------|------|------|
| `registry_cc` | 链注册表 - 注册/查询/管理参与跨链的链信息 | ✅ 完成 |
| `gateway_cc` | 跨链网关 - 发送/接收跨链消息 | ✅ 完成 |
| `Relayer` | 中继服务 - 监听 Fabric 事件并转发 | ✅ 完成 |

---

## 三、已通过的测试

### 3.1 链码功能测试

```bash
# 注册链
peer chaincode invoke ... -c '{"function":"RegisterChain","Args":[...]}'  ✅

# 发起跨链调用
peer chaincode invoke ... -c '{"function":"Send","Args":[...]}'  ✅
```

### 3.2 Relayer 事件监听测试

```
[FabricMonitor] 🎯 CrossChainCall event detected!
  - Target Chain: FISCO_NET_01
  - Target Contract: 0x1234567890abcdef
  - Target Function: transfer
  - Nonce: 7739cef...

[MessageHandler] Relaying message from FABRIC_NET_01 to FISCO_NET_01
```

---

## 四、FISCO 端需要实现的功能

### 4.1 需要实现的合约

| 合约 | 功能 |
|------|------|
| **Gateway 合约** | 接收跨链消息、发起跨链调用 |
| **Registry 合约** | 注册 Fabric 链信息（可选） |

### 4.2 Gateway 合约核心接口

```solidity
// 接收来自 Fabric 的跨链消息
function receive(
    string memory sourceChainId,    // 源链ID，如 "FABRIC_NET_01"
    string memory sourceTxHash,     // Fabric 交易哈希
    uint256 sourceBlockNumber,      // Fabric 区块号
    bytes memory payload,           // 消息内容
    bytes memory merkleProof        // Merkle 证明（可选，用于验证）
) external;

// 发起到 Fabric 的跨链调用
function send(
    string memory targetChainId,    // 目标链ID，如 "FABRIC_NET_01"
    string memory targetContract,   // 目标链码名称
    string memory targetFunction,   // 目标函数名
    bytes memory payload            // 调用参数
) external returns (bytes32 nonce);
```

### 4.3 需要触发的事件

```solidity
// 发起跨链调用时触发，Relayer 会监听此事件
event CrossChainCall(
    string targetChainId,
    string targetContract,
    string targetFunction,
    bytes payload,
    bytes32 nonce
);

// 收到跨链消息时触发
event MessageReceived(
    string sourceChainId,
    string sourceTxHash,
    bytes payload
);
```

---

## 五、Relayer 对接说明

### 5.1 配置 FISCO 链

编辑 `Relayer/config.json`，添加 FISCO 链配置：

```json
{
  "chains": [
    {
      "chainId": "FABRIC_NET_01",
      "type": "FABRIC",
      ...
    },
    {
      "chainId": "FISCO_NET_01",
      "type": "FISCO_BCOS",
      "enabled": true,
      "rpc": {
        "endpoint": "http://127.0.0.1:8545"
      },
      "contracts": {
        "gateway": "0x..."
      },
      "monitoring": {
        "startBlock": "latest",
        "pollInterval": 3000,
        "events": ["CrossChainCall"]
      }
    }
  ]
}
```

### 5.2 实现 FISCO 监听器

需要完善 `Relayer/monitors/fisco_bcos_monitor.js`：

```javascript
// 核心方法需要实现：
async initialize()           // 连接 FISCO 节点
async poll()                 // 轮询新区块
async parseBlockEvents()     // 解析 CrossChainCall 事件
async submitBlockHeader()    // 提交区块头（可选）
```

### 5.3 实现消息转发

完善 `Relayer/handlers/message_handler.js` 中的：

```javascript
async relayToFiscoBcos(targetChain, message) {
    // 调用 FISCO Gateway 合约的 receive 方法
}
```

---

## 六、消息格式规范

### 6.1 CrossChainCall 事件 Payload

```json
{
  "targetChainId": "FISCO_NET_01",
  "targetContract": "0x1234567890abcdef",
  "targetFunction": "transfer",
  "payload": "base64编码的调用参数",
  "nonce": "唯一标识符，用于防重放"
}
```

### 6.2 Relayer 转发的消息结构

```json
{
  "sourceChainId": "FABRIC_NET_01",
  "targetChainId": "FISCO_NET_01",
  "sourceTxHash": "交易哈希",
  "sourceBlockNumber": 123,
  "targetContract": "0x...",
  "targetFunction": "transfer",
  "payload": "...",
  "merkleProof": [],
  "blockHeader": {}
}
```

---

## 七、测试环境

### 7.1 Fabric 环境

- 网络：fabric-samples test-network
- Channel：mychannel
- 链码：registry_cc, gateway_cc
- Peer 端口：7051 (Org1), 9051 (Org2)

### 7.2 运行 Relayer

```bash
cd <项目根目录>/fabric-chaincode/Relayer
unset http_proxy https_proxy  # 清除代理（避免连接本地服务时走代理）
npm install
npm start
```

> **注意**：运行前请确保 `config.json` 中的配置正确，特别是 Fabric 证书路径和 FISCO 合约地址。

---

## 八、待完成事项

### 当前状态

| 组件 | 状态 |
|------|------|
| Fabric 链码 (registry_cc, gateway_cc) | ✅ 已完成 |
| Fabric 监听器 (fabric_monitor.js) | ✅ 已完成 |
| FISCO 合约 | ✅ 已完成 |
| FISCO 监听器 (fisco_bcos_monitor.js) | ✅ 已完成 |
| 消息转发到 FISCO (message_handler.js) | ✅ 已完成（需通过 Console 手动确认） |
| 消息转发到 Fabric (message_handler.js) | ✅ 已完成 |

### 已完成的核心功能

- ✅ FISCO 监听器：使用 ethers.js 连接 FISCO-BCOS 节点，轮询新区块并解析 CrossChainCall 事件
- ✅ Fabric 监听器：使用 fabric-gateway 和 fabric-protos 解析区块事件
- ✅ 双向消息转发：Fabric → FISCO 和 FISCO → Fabric
- ⚠️ FISCO 写入限制：由于 ethers.js 与 FISCO-BCOS 的 nonce 格式不完全兼容，写入交易需要通过 FISCO Console 手动执行

### 后续优化（可选）

| 事项 | 说明 |
|------|------|
| LightClient 验证 | 实现区块头验证 |
| Merkle 证明 | 实现交易存在性证明 |
| FISCO 自动写入 | 集成 FISCO Java SDK 或 Python SDK 实现自动写入 |

---

## 九、联调步骤

1. FISCO 端部署 Gateway 合约
2. 更新 Relayer 配置，填入合约地址
3. 完善 fisco_bcos_monitor.js
4. 启动 Relayer
5. 从 Fabric 发起跨链调用，验证 FISCO 端能收到
6. 从 FISCO 发起跨链调用，验证 Fabric 端能收到

---

## 十、代码位置

> 项目根目录：`/home/tr/projects/cross-chain/`（可根据实际克隆位置调整）

```
cross-chain/                        # 项目根目录
├── CROSSCHAIN_GUIDE.md             # 操作指南
├── CROSSCHAIN_HANDOVER.md          # 本文档
├── fabric-chaincode/
│   ├── my-chain-code/
│   │   ├── registry_cc/            # 链注册表链码
│   │   ├── gateway_cc/             # 跨链网关链码
│   │   └── deploy-chaincode.sh
│   └── Relayer/
│       ├── index.js                # 入口
│       ├── relayer.js              # 核心服务
│       ├── config.json             # 【需配置】主配置文件
│       ├── start-all.sh            # 一键启动脚本
│       ├── monitors/
│       │   ├── fabric_monitor.js   # Fabric 监听器 ✅
│       │   └── fisco_bcos_monitor.js  # FISCO 监听器 ✅
│       └── handlers/
│           └── message_handler.js  # 消息处理 ✅
└── fisco-bcos/
    ├── nodes/127.0.0.1/            # FISCO 节点
    └── console/                    # FISCO Console
```

