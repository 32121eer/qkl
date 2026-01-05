#!/bin/bash
# 快速测试脚本

echo "=========================================="
echo "         跨链系统快速测试"
echo "=========================================="

# 1. 检查 FISCO
echo ""
echo "[1/3] 检查 FISCO..."
FISCO_BLOCK=$(curl -s -X POST --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' http://127.0.0.1:8545 | grep -o '"result":"[^"]*"' | cut -d'"' -f4)
if [ -n "$FISCO_BLOCK" ]; then
    echo "  ✓ FISCO RPC 正常，当前区块: $FISCO_BLOCK"
else
    echo "  ✗ FISCO RPC 无响应"
fi

# 2. 检查 Fabric
echo ""
echo "[2/3] 检查 Fabric..."
FABRIC_PEER=$(docker ps | grep peer0.org1 | wc -l)
if [ "$FABRIC_PEER" -gt 0 ]; then
    echo "  ✓ Fabric peer 运行中"
else
    echo "  ✗ Fabric peer 未运行"
fi

# 3. 测试 Fabric -> FISCO
echo ""
echo "[3/3] 测试 Fabric -> FISCO 跨链..."
cd /home/tr/projects/fabric-chaincode/Relayer
node test-crosschain.js

echo ""
echo "=========================================="
echo "如需测试 FISCO -> Fabric，请:"
echo "  1. 启动 Console: cd /home/tr/projects/fisco-bcos/console && ./start.sh"
echo "  2. 执行: call Gateway 0xcceef68c9b4811b32c75df284a1396c7c5509561 send \"FABRIC_NET_01\" \"mychannel/gateway_cc\" \"Receive\" 0x48656c6c6f"
echo "=========================================="

