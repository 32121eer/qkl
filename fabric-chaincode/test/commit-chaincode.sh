#!/bin/bash
# 提交 crosschain_cc 链码到通道

export PATH=/root/czs/fabric/fabric-samples-main/bin:$PATH
export FABRIC_CFG_PATH=/root/czs/fabric/fabric-samples-main/config/

NETWORK_DIR="/root/czs/fabric/fabric-samples-main/test-network"
CHAINCODE_NAME="crosschain_cc"

echo "=== 提交链码 ${CHAINCODE_NAME} 到通道 mychannel ==="
echo ""

# 1. 检查链码是否已安装
echo "1. 检查链码安装状态..."
export CORE_PEER_TLS_ENABLED=true
export CORE_PEER_LOCALMSPID="Org1MSP"
export CORE_PEER_TLS_ROOTCERT_FILE=${NETWORK_DIR}/organizations/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/ca.crt
export CORE_PEER_MSPCONFIGPATH=${NETWORK_DIR}/organizations/peerOrganizations/org1.example.com/users/Admin@org1.example.com/msp
export CORE_PEER_ADDRESS=localhost:7051

PACKAGE_ID=$(peer lifecycle chaincode queryinstalled 2>/dev/null | grep "crosschain_cc_cc_1" | cut -d ' ' -f 3 | cut -d ',' -f 1)

if [ -z "$PACKAGE_ID" ]; then
    echo "错误: 链码 ${CHAINCODE_NAME} 未安装，请先运行部署脚本"
    exit 1
fi

echo "   找到 Package ID: ${PACKAGE_ID}"
echo ""

# 2. 检查提交就绪状态
echo "2. 检查提交就绪状态..."
peer lifecycle chaincode checkcommitreadiness \
    --channelID mychannel \
    --name ${CHAINCODE_NAME} \
    --version 1.0 \
    --sequence 1 \
    --tls \
    --cafile "${NETWORK_DIR}/organizations/ordererOrganizations/example.com/orderers/orderer.example.com/msp/tlscacerts/tlsca.example.com-cert.pem" \
    --output json | jq .

echo ""

# 3. 批准链码（如果需要）
echo "3. 批准链码..."
export CORE_PEER_LOCALMSPID="Org1MSP"
export CORE_PEER_TLS_ROOTCERT_FILE=${NETWORK_DIR}/organizations/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/ca.crt
export CORE_PEER_MSPCONFIGPATH=${NETWORK_DIR}/organizations/peerOrganizations/org1.example.com/users/Admin@org1.example.com/msp
export CORE_PEER_ADDRESS=localhost:7051

peer lifecycle chaincode approveformyorg \
    -o localhost:7050 \
    --ordererTLSHostnameOverride orderer.example.com \
    --tls \
    --cafile "${NETWORK_DIR}/organizations/ordererOrganizations/example.com/orderers/orderer.example.com/msp/tlscacerts/tlsca.example.com-cert.pem" \
    --channelID mychannel \
    --name ${CHAINCODE_NAME} \
    --version 1.0 \
    --package-id ${PACKAGE_ID} \
    --sequence 1

echo ""

# 4. 提交链码到通道
echo "4. 提交链码到通道..."
peer lifecycle chaincode commit \
    -o localhost:7050 \
    --ordererTLSHostnameOverride orderer.example.com \
    --channelID mychannel \
    --name ${CHAINCODE_NAME} \
    --version 1.0 \
    --sequence 1 \
    --tls \
    --cafile "${NETWORK_DIR}/organizations/ordererOrganizations/example.com/orderers/orderer.example.com/msp/tlscacerts/tlsca.example.com-cert.pem" \
    --peerAddresses localhost:7051 \
    --tlsRootCertFiles "${NETWORK_DIR}/organizations/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/ca.crt" \
    --peerAddresses localhost:9051 \
    --tlsRootCertFiles "${NETWORK_DIR}/organizations/peerOrganizations/org2.example.com/peers/peer0.org2.example.com/tls/ca.crt"

if [ $? -eq 0 ]; then
    echo ""
    echo "✓ 链码提交成功！"
    echo ""
    
    # 5. 验证提交
    echo "5. 验证链码提交状态..."
    peer lifecycle chaincode querycommitted \
        --channelID mychannel \
        --name ${CHAINCODE_NAME} \
        --tls \
        --cafile "${NETWORK_DIR}/organizations/ordererOrganizations/example.com/orderers/orderer.example.com/msp/tlscacerts/tlsca.example.com-cert.pem"
else
    echo ""
    echo "✗ 链码提交失败"
    exit 1
fi

echo ""
echo "=== 完成 ==="

