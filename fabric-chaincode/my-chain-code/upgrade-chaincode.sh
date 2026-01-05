#!/bin/bash

export PATH=/home/tr/fabric-samples/bin:$PATH
export FABRIC_CFG_PATH=/home/tr/fabric-samples/config/

NETWORK_DIR="/home/tr/fabric-samples/test-network"
ORDERER_CA="/home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/tlsca/tlsca.example.com-cert.pem"

CODE_DIR=$1
CODE_NAME=$2
SEQUENCE=$3

CURRENT_DIR=${PWD}

# 更新 vendor
cd ${CODE_DIR}
go mod tidy
GO111MODULE=on go mod vendor

set -e

cd ${CURRENT_DIR}
echo "Upgrading ${CODE_NAME}_cc (sequence ${SEQUENCE})..."

# 1. 打包
echo "1. Packaging..."
peer lifecycle chaincode package ${CODE_NAME}_v${SEQUENCE}.tar.gz \
    --path ${CODE_DIR} \
    --lang golang \
    --label ${CODE_NAME}_cc_${SEQUENCE}

# 2. Org1 安装
echo "2. Installing on Org1..."
export CORE_PEER_TLS_ENABLED=true
export CORE_PEER_LOCALMSPID="Org1MSP"
export CORE_PEER_TLS_ROOTCERT_FILE=${NETWORK_DIR}/organizations/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/ca.crt
export CORE_PEER_MSPCONFIGPATH=${NETWORK_DIR}/organizations/peerOrganizations/org1.example.com/users/Admin@org1.example.com/msp
export CORE_PEER_ADDRESS=localhost:7051
peer lifecycle chaincode install ${CODE_NAME}_v${SEQUENCE}.tar.gz

PACKAGE_ID=$(peer lifecycle chaincode queryinstalled | grep ${CODE_NAME}_cc_${SEQUENCE} | cut -d ' ' -f 3 | cut -d ',' -f 1)
echo "Package ID: ${PACKAGE_ID}"

# 3. Org2 安装
echo "3. Installing on Org2..."
export CORE_PEER_LOCALMSPID="Org2MSP"
export CORE_PEER_TLS_ROOTCERT_FILE=${NETWORK_DIR}/organizations/peerOrganizations/org2.example.com/peers/peer0.org2.example.com/tls/ca.crt
export CORE_PEER_MSPCONFIGPATH=${NETWORK_DIR}/organizations/peerOrganizations/org2.example.com/users/Admin@org2.example.com/msp
export CORE_PEER_ADDRESS=localhost:9051
peer lifecycle chaincode install ${CODE_NAME}_v${SEQUENCE}.tar.gz

# 4. Org2 批准
echo "4. Org2 approving..."
peer lifecycle chaincode approveformyorg \
    -o localhost:7050 \
    --ordererTLSHostnameOverride orderer.example.com \
    --tls --cafile $NETWORK_DIR/organizations/ordererOrganizations/example.com/orderers/orderer.example.com/msp/tlscacerts/tlsca.example.com-cert.pem \
    --channelID mychannel \
    --name ${CODE_NAME}_cc \
    --version 1.${SEQUENCE} \
    --package-id $PACKAGE_ID \
    --sequence ${SEQUENCE}

# 5. Org1 批准
echo "5. Org1 approving..."
export CORE_PEER_LOCALMSPID="Org1MSP"
export CORE_PEER_TLS_ROOTCERT_FILE=${NETWORK_DIR}/organizations/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/ca.crt
export CORE_PEER_MSPCONFIGPATH=${NETWORK_DIR}/organizations/peerOrganizations/org1.example.com/users/Admin@org1.example.com/msp
export CORE_PEER_ADDRESS=localhost:7051

peer lifecycle chaincode approveformyorg \
    -o localhost:7050 \
    --ordererTLSHostnameOverride orderer.example.com \
    --tls --cafile "$NETWORK_DIR/organizations/ordererOrganizations/example.com/orderers/orderer.example.com/msp/tlscacerts/tlsca.example.com-cert.pem" \
    --channelID mychannel \
    --name ${CODE_NAME}_cc \
    --version 1.${SEQUENCE} \
    --package-id $PACKAGE_ID \
    --sequence ${SEQUENCE}

# 6. 提交
echo "6. Committing..."
peer lifecycle chaincode commit \
    -o localhost:7050 \
    --ordererTLSHostnameOverride orderer.example.com \
    --channelID mychannel \
    --name ${CODE_NAME}_cc \
    --version 1.${SEQUENCE} \
    --sequence ${SEQUENCE} \
    --tls --cafile "${NETWORK_DIR}/organizations/ordererOrganizations/example.com/orderers/orderer.example.com/msp/tlscacerts/tlsca.example.com-cert.pem" \
    --peerAddresses localhost:7051 \
    --tlsRootCertFiles "${NETWORK_DIR}/organizations/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/ca.crt" \
    --peerAddresses localhost:9051 \
    --tlsRootCertFiles "${NETWORK_DIR}/organizations/peerOrganizations/org2.example.com/peers/peer0.org2.example.com/tls/ca.crt"

echo "Done! ${CODE_NAME}_cc upgraded to sequence ${SEQUENCE}"

