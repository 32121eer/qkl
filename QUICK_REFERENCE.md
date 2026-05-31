# 快速参考 - 跨链系统

## 🚀 5分钟快速启动

```bash
# 1. 启动系统
cd /home/tr/projects/cross-chain
./start-all.sh --fast

# 2. 启动 Relayer（新终端，保持运行）
cd fabric-chaincode/Relayer
unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY
npm start 2>&1 | tee ~/relayer.log

# 3. 测试 FISCO → Fabric（新终端）
cd fisco-bcos/console
./console.sh call GatewayAir 0xbf6d5dadd2f5dfce31faf6aad27b5d3e372b9a17 send '"FABRIC_NET_01"' '"mychannel/gateway_cc"' '"Receive"' 0x48656c6c6f

# 4. 测试 Fabric → FISCO
cd fabric-chaincode/Relayer
unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY
node test-crosschain.js
```

---

## 📍 关键路径

| 组件 | 路径 |
|------|------|
| **项目根目录** | `/home/tr/projects/cross-chain` |
| **FISCO 合约** | `fisco-bcos/console/contracts/solidity/` |
| **Fabric Chaincode** | `fabric-chaincode/gateway_cc/` |
| **Relayer** | `fabric-chaincode/Relayer/` |
| **配置文件** | `fabric-chaincode/Relayer/config.json` |
| **日志文件** | `~/relayer.log` |

---

## 🔑 当前合约地址

```
ChainRegistryAir: 0x4532bbeb41b4e1ff0ae2742729156042976fbd53
LightClientAir:   0x73fac4d3107689125edda50beb4ab3dbd0d9fdd0
GatewayAir:       0xbf6d5dadd2f5dfce31faf6aad27b5d3e372b9a17
```

查看最新地址：
```bash
tail -5 fisco-bcos/console/deploylog.txt
grep '"gateway"' fabric-chaincode/Relayer/config.json | grep "0x"
```

---

## 🔧 常用命令

### FISCO 操作

```bash
cd fisco-bcos/console

# 查看区块高度
./console.sh getBlockNumber

# 查看合约信息
./console.sh call GatewayAir <地址> chainRegistry

# 查看链是否注册
./console.sh call ChainRegistryAir <地址> isRegistered '"FABRIC_NET_01"'

# 部署新合约
./console.sh deploy GatewayAir <Registry地址> <LightClient地址>
```

### Fabric 操作

```bash
cd /home/tr/fabric-samples/test-network

# 启动网络
./network.sh up createChannel -s couchdb

# 部署 chaincode
./network.sh deployCC -ccn gateway_cc -ccp /home/tr/projects/cross-chain/fabric-chaincode/gateway_cc -ccl javascript

# 查看已部署的 chaincode
./network.sh queryCommitted mychannel

# 停止网络
./network.sh down
```

### Relayer 操作

```bash
cd fabric-chaincode/Relayer

# 查看配置
cat config.json | jq '.chains[] | {chainId, type, contracts}'

# 查看日志（实时）
tail -f ~/relayer.log

# 查看特定事件
grep "CrossChainCall" ~/relayer.log
grep "transaction status" ~/relayer.log
grep "Message relayed successfully" ~/relayer.log

# 重启 Relayer
pkill -f "npm start"
npm start 2>&1 | tee ~/relayer.log
```

---

## 🐛 常见问题速查

| 问题 | 解决方案 |
|------|---------|
| **Docker 拉取失败** | Docker Desktop → Settings → Proxies → 添加 bypass: `registry-1.docker.io,*.docker.io,localhost,127.0.0.1` |
| **Git push 失败（代理）** | `git config --global --unset http.proxy && git config --global --unset https.proxy` |
| **npm 连接失败（代理）** | `unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY` |
| **Abi is empty** | 合约地址与 ABI 不匹配，重新部署：`./bootstrap.sh --redeploy-fisco` |
| **Target chain not registered** | 链未注册，运行 `bootstrap.sh` 或手动注册 |
| **Block number must be sequential** | LightClient 区块不连续，用 `--redeploy-fisco` 重置 |
| **Relayer 卡住不动** | `fabric_monitor.js` 阻塞，已修复，确保使用最新代码 |

---

## 📊 调试技巧

### 查看 FISCO 交易状态

```bash
# 交易成功：transaction status: 0
# 交易失败：transaction status: 16（Revert）

# 查看失败原因
./console.sh call <合约> <地址> <方法> <参数>
# 看输出中的 "Receipt message"
```

### 查看 Relayer 日志

```bash
# 查看最近的跨链事件
grep -A 10 "CrossChainCall event detected" ~/relayer.log | tail -30

# 查看消息转发情况
grep -E "relayToFabric|relayToFiscoBcos" ~/relayer.log | tail -20

# 查看所有错误
grep -i "error\|failed\|revert" ~/relayer.log | tail -30

# 查看成功的交易
grep "Message relayed successfully" ~/relayer.log
```

### 验证系统状态

```bash
# 1. 检查 FISCO 节点
cd fisco-bcos/console
./console.sh getBlockNumber  # 应该返回当前区块号

# 2. 检查 Fabric 节点
docker ps | grep hyperledger  # 应该看到 peer, orderer, couchdb

# 3. 检查 Relayer
ps aux | grep "node index.js"  # 应该有进程在运行
tail -5 ~/relayer.log  # 应该有日志输出

# 4. 检查合约配置
grep '"gateway"' fabric-chaincode/Relayer/config.json
```

---

## 📦 重新部署

### 完整重置（慎用）

```bash
# 1. 停止所有服务
pkill -f "npm start"
cd /home/tr/fabric-samples/test-network
./network.sh down

# 2. 清理 FISCO（可选）
cd /home/tr/projects/cross-chain/fisco-bcos/console
rm -rf contracts/.compiled/group0/*

# 3. 重新启动
cd /home/tr/projects/cross-chain
./start-all.sh

# 4. 验证
tail -30 ~/relayer.log
```

### 只重新部署合约

```bash
cd /home/tr/projects/cross-chain
./bootstrap.sh --redeploy-fisco --receive-method receiveLite --skip-fabric-cc
```

---

## 🎯 核心概念

### LightClient 验证

```
源链发送消息 → 触发事件
     ↓
Relayer 捕获
     ↓
提交区块头到目标链 LightClient
     ↓
LightClient 验证区块连续性
     ↓
调用目标链 Gateway.receiveLite()
     ↓
Gateway 查询 LightClient 验证区块
     ↓
验证通过 → 触发 CrossChainReceived
```

### receiveLite vs receive

| 特性 | receiveLite | receive |
|------|------------|---------|
| 区块头验证 | ✓ | ✓ |
| Merkle Proof | ✗ | ✓ |
| 安全性 | 中 | 高 |
| 适用场景 | Fabric 等 | 标准区块链 |

---

## 📞 需要帮助？

1. **查看详细文档**: `PROJECT_STATUS_2026-02-06.md`
2. **查看更新日志**: `CHANGELOG_2026-02-06.md`
3. **查看测试脚本**: `fabric-chaincode/Relayer/test-crosschain.js`
4. **查看部署脚本**: `bootstrap.sh`

---

**最后更新**: 2026年2月6日  
**系统状态**: ✅ 生产就绪，双向跨链测试通过

