#!/bin/bash
set -e

echo "=========================================="
echo "       跨链系统一键启动脚本"
echo "=========================================="

# 1. 修复权限
echo ""
echo "[1/5] 修复脚本权限..."
chmod -R +x /home/tr/projects/fisco-bcos/nodes/127.0.0.1/*.sh 2>/dev/null || true
chmod -R +x /home/tr/projects/fisco-bcos/nodes/127.0.0.1/node*/*.sh 2>/dev/null || true
chmod +x /home/tr/projects/fisco-bcos/console/*.sh 2>/dev/null || true
echo "  ✓ 权限已修复"

# 2. 启动 FISCO 节点
echo ""
echo "[2/5] 启动 FISCO-BCOS 节点..."
cd /home/tr/projects/fisco-bcos/nodes/127.0.0.1
./stop_all.sh 2>/dev/null || true
sleep 2
./start_all.sh
sleep 5
FISCO_COUNT=$(ps aux | grep fisco-bcos | grep -v grep | wc -l)
echo "  ✓ FISCO 节点启动: $FISCO_COUNT 个"

# 检查 RPC 端口
if nc -z localhost 8545 2>/dev/null; then
    echo "  ✓ RPC 端口 8545 已监听"
else
    echo "  ✗ 警告: RPC 端口 8545 未监听"
fi

# 3. 启动 Fabric 网络
echo ""
echo "[3/5] 启动 Fabric 网络..."
cd /home/tr/fabric-samples/test-network
./network.sh down 2>/dev/null || true
sleep 2
./network.sh up createChannel -c mychannel -ca
sleep 5
FABRIC_COUNT=$(docker ps | grep hyperledger | wc -l)
echo "  ✓ Fabric 容器启动: $FABRIC_COUNT 个"

# 4. 部署 Fabric 链码
echo ""
echo "[4/5] 部署 gateway_cc 链码..."
./network.sh deployCC -ccn gateway_cc -ccp /home/tr/projects/fabric-chaincode/my-chain-code/gateway_cc -ccl go
echo "  ✓ 链码部署完成"

# 5. 完成
echo ""
echo "[5/5] 启动完成!"
echo ""
echo "=========================================="
echo "              启动摘要"
echo "=========================================="
echo "FISCO 节点: $FISCO_COUNT 个运行中"
echo "FISCO RPC:  http://127.0.0.1:8545"
echo "FISCO SDK:  127.0.0.1:20203"
echo "Fabric:     localhost:7051"
echo ""
echo "下一步:"
echo "  1. 新终端启动 Relayer:"
echo "     cd /home/tr/projects/fabric-chaincode/Relayer && npm start"
echo ""
echo "  2. 新终端启动 FISCO Console (可选):"
echo "     cd /home/tr/projects/fisco-bcos/console && ./start.sh"
echo "=========================================="

