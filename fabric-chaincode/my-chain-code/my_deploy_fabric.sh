#!/bin/bash

export PATH=/root/czs/fabric/fabric-samples-main/bin:$PATH
export FABRIC_CFG_PATH=/root/czs/fabric/fabric-samples-main/config/

NETWORK_DIR="/root/czs/fabric/fabric-samples-main/test-network"
ORDERER_CA="/root/czs/fabric/fabric-samples-main/test-network/organizations/ordererOrganizations/example.com/tlsca/tlsca.example.com-cert.pem"
ORG1_PEER0_CA="/root/czs/fabric/fabric-samples-main/test-network/organizations/"
ORG2_PEER0_CA="/root/czs/fabric/fabric-samples-main/test-network/organizations/"


set -e
CURRENT_DIR=${PWD}
# 关闭网络
echo "shutdown network..."
cd ${NETWORK_DIR}
./network.sh down
# 启动网络
echo "up network..."
./network.sh up

# 创建通道
echo "create channel..."
./network.sh createChannel

cd ${CURRENT_DIR}

echo "Deploying chaincodes to Hyperledger Fabric..."
# 1. 创建链码包
echo ""
echo "1. Packaging registry_cc..."
peer lifecycle chaincode package registry_cc.tar.gz \
    --path /root/czs/fabric/my-cross-chain/registry_cc/ \
    --lang golang \
    --label registry_cc_1

# 2. 安装Registry链码
echo ""
echo "2. Installing registry_cc..."
#设置环境变量进入org1中
export CORE_PEER_TLS_ENABLED=true
export CORE_PEER_LOCALMSPID="Org1MSP"
export CORE_PEER_TLS_ROOTCERT_FILE=${NETWORK_DIR}/organizations/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/ca.crt
export CORE_PEER_MSPCONFIGPATH=${NETWORK_DIR}/organizations/peerOrganizations/org1.example.com/users/Admin@org1.example.com/msp
export CORE_PEER_ADDRESS=localhost:7051
peer lifecycle chaincode install registry_cc.tar.gz
# 获取package ID
ORG1_REGISTRY_PACKAGE_ID=$(peer lifecycle chaincode queryinstalled | grep registry_cc_1 | cut -d ' ' -f 3 | cut -d ',' -f 1)
echo "org1 Registry Package ID: ${ORG1_REGISTRY_PACKAGE_ID}"

# 进入org2
export CORE_PEER_LOCALMSPID="Org2MSP"
export CORE_PEER_TLS_ROOTCERT_FILE=${NETWORK_DIR}/organizations/peerOrganizations/org2.example.com/peers/peer0.org2.example.com/tls/ca.crt
export CORE_PEER_MSPCONFIGPATH=${NETWORK_DIR}/organizations/peerOrganizations/org2.example.com/users/Admin@org2.example.com/msp
export CORE_PEER_ADDRESS=localhost:9051
# org2中peer0下载链码
peer lifecycle chaincode install registry_cc.tar.gz
# 获取package ID
ORG2_REGISTRY_PACKAGE_ID=$(peer lifecycle chaincode queryinstalled | grep registry_cc_1 | cut -d ' ' -f 3 | cut -d ',' -f 1)
echo "orh2 Registry Package ID: ${ORG2_REGISTRY_PACKAGE_ID}"

# 3. 批准Registry链码
echo ""
echo "3. Approving registry_cc..."
# 批准org2

peer lifecycle chaincode approveformyorg \
    -o localhost:7050 \
    --ordererTLSHostnameOverride orderer.example.com \
    --tls --cafile $NETWORK_DIR/organizations/ordererOrganizations/example.com/orderers/orderer.example.com/msp/tlscacerts/tlsca.example.com-cert.pem \
    --channelID mychannel \
    --name registry_cc \
    --version 1.0 \
    --package-id $ORG2_REGISTRY_PACKAGE_ID \
    --sequence 1
# 进入org1
export CORE_PEER_TLS_ENABLED=true
export CORE_PEER_LOCALMSPID="Org1MSP"
export CORE_PEER_TLS_ROOTCERT_FILE=${NETWORK_DIR}/organizations/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/ca.crt
export CORE_PEER_MSPCONFIGPATH=${NETWORK_DIR}/organizations/peerOrganizations/org1.example.com/users/Admin@org1.example.com/msp
export CORE_PEER_ADDRESS=localhost:7051

peer lifecycle chaincode approveformyorg \
    -o localhost:7050 \
    --ordererTLSHostnameOverride orderer.example.com \
    --tls --cafile "$NETWORK_DIR/organizations/ordererOrganizations/example.com/orderers/orderer.example.com/msp/tlscacerts/tlsca.example.com-cert.pem"\
    --channelID mychannel \
    --name registry_cc \
    --version 1.0 \
    --package-id $ORG1_REGISTRY_PACKAGE_ID \
    --sequence 1 \


# 4. 提交Registry链码
echo ""
echo "4. Committing registry_cc..."
peer lifecycle chaincode checkcommitreadiness \
    --channelID mychannel \
    --name registry_cc \
    --version 1.0 \
    --sequence 1 \
    --tls --cafile "${NETWORK_DIR}/organizations/ordererOrganizations/example.com/orderers/orderer.example.com/msp/tlscacerts/tlsca.example.com-cert.pem" \
    --output json
# 向channel提交
peer lifecycle chaincode commit \
    -o localhost:7050 \
    --ordererTLSHostnameOverride orderer.example.com \
    --channelID mychannel \
    --name registry_cc \
    --version 1.0 \
    --sequence 1 \
    --tls --cafile "${NETWORK_DIR}/organizations/ordererOrganizations/example.com/orderers/orderer.example.com/msp/tlscacerts/tlsca.example.com-cert.pem" \
    --peerAddresses localhost:7051 \
    --tlsRootCertFiles "${NETWORK_DIR}/organizations/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/ca.crt" \
    --peerAddresses localhost:9051 \
    --tlsRootCertFiles "${NETWORK_DIR}/organizations/peerOrganizations/org2.example.com/peers/peer0.org2.example.com/tls/ca.crt"
# 验证已经提交到channel
peer lifecycle chaincode querycommitted \
    --channelID mychannel \
    --name registry_cc \
    --cafile "${NETWORK_DIR}/organizations/ordererOrganizations/example.com/orderers/orderer.example.com/msp/tlscacerts/tlsca.example.com-cert.pem"






