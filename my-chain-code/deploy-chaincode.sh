#!/bin/bash

export PATH=/home/tr/fabric-samples/bin:$PATH
export FABRIC_CFG_PATH=/home/tr/fabric-samples/config/

NETWORK_DIR="/home/tr/fabric-samples/test-network"
ORDERER_CA="/home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/tlsca/tlsca.example.com-cert.pem"



# ��ȡ��һ����������ֵ�� CODE_DIR
CODE_DIR=$1
# ��ȡ�ڶ�����������ֵ�� CODE_NAME  
CODE_NAME=$2

CURRENT_DIR=${PWD}

#����mod�ļ�
cd ${CODE_DIR}
go mod init ${CODE_NAME}_chaincode
go mod tidy
GO111MODULE=on 
go mod vendor

set -e

#����ԭ·��
cd ${CURRENT_DIR}
echo "Deploying chaincodes to Hyperledger Fabric..."
# 1. ���������
echo ""
echo "1. Packaging ${CODE_NAME}_cc..."
peer lifecycle chaincode package ${CODE_NAME}.tar.gz \
    --path ${CODE_DIR} \
    --lang golang \
    --label ${CODE_NAME}_cc_1

# 2. ��װRegistry����
echo ""
echo "2. Installing ${CODE_NAME}_cc..."
#���û�����������org1��
export CORE_PEER_TLS_ENABLED=true
export CORE_PEER_LOCALMSPID="Org1MSP"
export CORE_PEER_TLS_ROOTCERT_FILE=${NETWORK_DIR}/organizations/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/ca.crt
export CORE_PEER_MSPCONFIGPATH=${NETWORK_DIR}/organizations/peerOrganizations/org1.example.com/users/Admin@org1.example.com/msp
export CORE_PEER_ADDRESS=localhost:7051
peer lifecycle chaincode install ${CODE_NAME}.tar.gz
# ��ȡpackage ID
ORG1_REGISTRY_PACKAGE_ID=$(peer lifecycle chaincode queryinstalled | grep ${CODE_NAME}_cc_1 | cut -d ' ' -f 3 | cut -d ',' -f 1)
echo "org1  Package ID: ${ORG1_REGISTRY_PACKAGE_ID}"

# ����org2
echo ""
echo "Org2 Installing ${CODE_NAME}_cc..."
export CORE_PEER_LOCALMSPID="Org2MSP"
export CORE_PEER_TLS_ROOTCERT_FILE=${NETWORK_DIR}/organizations/peerOrganizations/org2.example.com/peers/peer0.org2.example.com/tls/ca.crt
export CORE_PEER_MSPCONFIGPATH=${NETWORK_DIR}/organizations/peerOrganizations/org2.example.com/users/Admin@org2.example.com/msp
export CORE_PEER_ADDRESS=localhost:9051
# org2��peer0��������
peer lifecycle chaincode install ${CODE_NAME}.tar.gz
# ��ȡpackage ID
ORG2_REGISTRY_PACKAGE_ID=$(peer lifecycle chaincode queryinstalled | grep ${CODE_NAME}_cc_1 | cut -d ' ' -f 3 | cut -d ',' -f 1)
echo "org2 Package ID: ${ORG2_REGISTRY_PACKAGE_ID}"

# 3. ��׼����
echo ""
echo "3. Approving ${CODE_NAME}_cc..."
# ��׼org2

peer lifecycle chaincode approveformyorg \
    -o localhost:7050 \
    --ordererTLSHostnameOverride orderer.example.com \
    --tls --cafile $NETWORK_DIR/organizations/ordererOrganizations/example.com/orderers/orderer.example.com/msp/tlscacerts/tlsca.example.com-cert.pem \
    --channelID mychannel \
    --name ${CODE_NAME}_cc \
    --version 1.0 \
    --package-id $ORG2_REGISTRY_PACKAGE_ID \
    --sequence 1
# ����org1
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
    --name ${CODE_NAME}_cc \
    --version 1.0 \
    --package-id $ORG1_REGISTRY_PACKAGE_ID \
    --sequence 1 \


# 4. �ύRegistry����
echo ""
echo "4. Committing ${CODE_NAME}_cc..."
peer lifecycle chaincode checkcommitreadiness \
    --channelID mychannel \
    --name ${CODE_NAME}_cc \
    --version 1.0 \
    --sequence 1 \
    --tls --cafile "${NETWORK_DIR}/organizations/ordererOrganizations/example.com/orderers/orderer.example.com/msp/tlscacerts/tlsca.example.com-cert.pem" \
    --output json
# ��channel�ύ
peer lifecycle chaincode commit \
    -o localhost:7050 \
    --ordererTLSHostnameOverride orderer.example.com \
    --channelID mychannel \
    --name ${CODE_NAME}_cc \
    --version 1.0 \
    --sequence 1 \
    --tls --cafile "${NETWORK_DIR}/organizations/ordererOrganizations/example.com/orderers/orderer.example.com/msp/tlscacerts/tlsca.example.com-cert.pem" \
    --peerAddresses localhost:7051 \
    --tlsRootCertFiles "${NETWORK_DIR}/organizations/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/ca.crt" \
    --peerAddresses localhost:9051 \
    --tlsRootCertFiles "${NETWORK_DIR}/organizations/peerOrganizations/org2.example.com/peers/peer0.org2.example.com/tls/ca.crt"
# ��֤�Ѿ��ύ��channel
peer lifecycle chaincode querycommitted \
    --channelID mychannel \
    --name ${CODE_NAME}_cc \
    --cafile "${NETWORK_DIR}/organizations/ordererOrganizations/example.com/orderers/orderer.example.com/msp/tlscacerts/tlsca.example.com-cert.pem"






