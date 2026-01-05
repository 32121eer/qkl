#!/bin/bash

# FISCO-BCOS JSON-RPC 调用脚本
# 使用 eth_call 来测试合约调用

RPC_URL="http://127.0.0.1:8545"

# 测试连接
echo "1. 测试 RPC 连接..."
BLOCK=$(curl -s -X POST --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' $RPC_URL)
echo "   当前区块: $BLOCK"

# 获取合约代码，确认合约存在
echo ""
echo "2. 检查 Gateway 合约..."
CODE=$(curl -s -X POST --data '{
  "jsonrpc":"2.0",
  "method":"eth_getCode",
  "params":["0xcceef68c9b4811b32c75df284a1396c7c5509561", "latest"],
  "id":1
}' $RPC_URL)
echo "   合约代码长度: ${#CODE} 字符"

# 尝试调用 isMessageProcessed (只读)
echo ""
echo "3. 测试只读调用 (isMessageProcessed)..."

# 注意：FISCO-BCOS 的 eth_call 可能有不同的格式
# 我们先测试基础的 eth_call

echo "   暂时跳过复杂调用测试..."
echo ""
echo "=== 建议 ==="
echo "FISCO-BCOS 的写入交易需要通过 SDK 发送。"
echo "建议选项:"
echo "1. 启动更多 FISCO 节点并开启 SDK 端口 (20200)"
echo "2. 使用 FISCO Python SDK"
echo "3. 简化测试：先验证 Relayer 能检测事件，手动在 console 完成调用"

