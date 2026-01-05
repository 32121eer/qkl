#!/bin/bash

echo "=== 检查 Fabric 网络状态 ==="
echo ""

# 检查 Docker 容器是否运行
echo "1. 检查 Docker 容器状态:"
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | grep -E "peer|orderer|NAME"
echo ""

# 检查端口是否监听
echo "2. 检查端口监听状态:"
echo "   Peer0.org1 (7051):"
netstat -tln | grep 7051 || ss -tln | grep 7051 || echo "   端口 7051 未监听"
echo "   Orderer (7050):"
netstat -tln | grep 7050 || ss -tln | grep 7050 || echo "   端口 7050 未监听"
echo ""

# 检查证书文件是否存在
echo "3. 检查证书文件:"
PEER_CERT="/root/czs/fabric/fabric-samples-main/test-network/organizations/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/ca.crt"
ORDERER_CERT="/root/czs/fabric/fabric-samples-main/test-network/organizations/ordererOrganizations/example.com/orderers/orderer.example.com/msp/tlscacerts/tlsca.example.com-cert.pem"
MSP_PATH="/root/czs/fabric/fabric-samples-main/test-network/organizations/peerOrganizations/org1.example.com/users/Admin@org1.example.com/msp"

if [ -f "$PEER_CERT" ]; then
    echo "   ✓ Peer TLS 证书存在: $PEER_CERT"
else
    echo "   ✗ Peer TLS 证书不存在: $PEER_CERT"
fi

if [ -f "$ORDERER_CERT" ]; then
    echo "   ✓ Orderer TLS 证书存在: $ORDERER_CERT"
else
    echo "   ✗ Orderer TLS 证书不存在: $ORDERER_CERT"
fi

if [ -d "$MSP_PATH" ]; then
    echo "   ✓ MSP 配置路径存在: $MSP_PATH"
else
    echo "   ✗ MSP 配置路径不存在: $MSP_PATH"
fi
echo ""

# 测试连接
echo "4. 测试网络连接:"
if command -v nc &> /dev/null; then
    if nc -z localhost 7051 2>/dev/null; then
        echo "   ✓ localhost:7051 可连接"
    else
        echo "   ✗ localhost:7051 无法连接"
    fi
    
    if nc -z localhost 7050 2>/dev/null; then
        echo "   ✓ localhost:7050 可连接"
    else
        echo "   ✗ localhost:7050 无法连接"
    fi
else
    echo "   (需要安装 nc 命令进行连接测试)"
fi
echo ""

# 检查链码是否已安装
echo "5. 检查链码安装状态:"
export PATH=/root/czs/fabric/fabric-samples-main/bin:$PATH
export FABRIC_CFG_PATH=/root/czs/fabric/fabric-samples-main/config/
export CORE_PEER_TLS_ENABLED=true
export CORE_PEER_LOCALMSPID="Org1MSP"
export CORE_PEER_TLS_ROOTCERT_FILE=/root/czs/fabric/fabric-samples-main/test-network/organizations/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/ca.crt
export CORE_PEER_MSPCONFIGPATH=/root/czs/fabric/fabric-samples-main/test-network/organizations/peerOrganizations/org1.example.com/users/Admin@org1.example.com/msp
export CORE_PEER_ADDRESS=localhost:7051

if peer lifecycle chaincode queryinstalled 2>/dev/null | grep -q "crosschain_cc"; then
    echo "   ✓ crosschain_cc 链码已安装"
    peer lifecycle chaincode queryinstalled | grep "crosschain_cc"
else
    echo "   ✗ crosschain_cc 链码未安装或无法查询"
fi
echo ""

# 检查链码是否已提交到通道
echo "6. 检查链码提交状态:"
if peer lifecycle chaincode querycommitted \
    --channelID mychannel \
    --name crosschain_cc \
    --tls \
    --cafile /root/czs/fabric/fabric-samples-main/test-network/organizations/ordererOrganizations/example.com/orderers/orderer.example.com/msp/tlscacerts/tlsca.example.com-cert.pem 2>/dev/null | grep -q "crosschain_cc"; then
    echo "   ✓ crosschain_cc 链码已提交到通道 mychannel"
    peer lifecycle chaincode querycommitted \
        --channelID mychannel \
        --name crosschain_cc \
        --tls \
        --cafile /root/czs/fabric/fabric-samples-main/test-network/organizations/ordererOrganizations/example.com/orderers/orderer.example.com/msp/tlscacerts/tlsca.example.com-cert.pem 2>/dev/null | head -5
else
    echo "   ✗ crosschain_cc 链码未提交到通道 mychannel"
    echo "   提示: 运行 ./commit-chaincode.sh 来提交链码"
fi
echo ""

echo "=== 检查完成 ==="

