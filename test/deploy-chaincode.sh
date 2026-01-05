#!/bin/bash
FABRIC_SAMPLES_MAIN=/mnt/fast18/xunuo/qukuialian/czs/fabric-samples-main

export PATH=${FABRIC_SAMPLES_MAIN}/bin:$PATH
export FABRIC_CFG_PATH=${FABRIC_SAMPLES_MAIN}/config/

NETWORK_DIR="${FABRIC_SAMPLES_MAIN}/test-network"
ORDERER_CA="${FABRIC_SAMPLES_MAIN}/test-network/organizations/ordererOrganizations/example.com/tlsca/tlsca.example.com-cert.pem"



# 获取第一个参数并赋值给 CODE_DIR
CODE_DIR=$1
# 获取第二个参数并赋值给 CODE_NAME  
CODE_NAME=$2

CURRENT_DIR=${PWD}

#生成mod文件
cd ${CODE_DIR}
go mod init ${CODE_NAME}_chaincode
go mod tidy
GO111MODULE=on 
go mod vendor

set -e

#返回原路径
cd ${CURRENT_DIR}
echo "Deploying chaincodes to Hyperledger Fabric..."
echo "链码名称: ${CODE_NAME}"
# 1. 创建链码包
echo ""
echo "1. Packaging ${CODE_NAME}..."
peer lifecycle chaincode package ${CODE_NAME}.tar.gz \
    --path ${CODE_DIR} \
    --lang golang \
    --label ${CODE_NAME}_cc_1

# 2. 安装Registry链码
echo ""
echo "2. Installing ${CODE_NAME}..."
#设置环境变量进入org1中
export CORE_PEER_TLS_ENABLED=true
export CORE_PEER_LOCALMSPID="Org1MSP"
export CORE_PEER_TLS_ROOTCERT_FILE=${NETWORK_DIR}/organizations/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/ca.crt
export CORE_PEER_MSPCONFIGPATH=${NETWORK_DIR}/organizations/peerOrganizations/org1.example.com/users/Admin@org1.example.com/msp
export CORE_PEER_ADDRESS=localhost:7051
peer lifecycle chaincode install ${CODE_NAME}.tar.gz
# 获取package ID
ORG1_REGISTRY_PACKAGE_ID=$(peer lifecycle chaincode queryinstalled | grep ${CODE_NAME}_cc_1 | cut -d ' ' -f 3 | cut -d ',' -f 1)
echo "org1  Package ID: ${ORG1_REGISTRY_PACKAGE_ID}"

# 进入org2
echo ""
echo "Org2 Installing ${CODE_NAME}..."
export CORE_PEER_LOCALMSPID="Org2MSP"
export CORE_PEER_TLS_ROOTCERT_FILE=${NETWORK_DIR}/organizations/peerOrganizations/org2.example.com/peers/peer0.org2.example.com/tls/ca.crt
export CORE_PEER_MSPCONFIGPATH=${NETWORK_DIR}/organizations/peerOrganizations/org2.example.com/users/Admin@org2.example.com/msp
export CORE_PEER_ADDRESS=localhost:9051
# org2中peer0下载链码
peer lifecycle chaincode install ${CODE_NAME}.tar.gz
# 获取package ID
ORG2_REGISTRY_PACKAGE_ID=$(peer lifecycle chaincode queryinstalled | grep ${CODE_NAME}_cc_1 | cut -d ' ' -f 3 | cut -d ',' -f 1)
echo "org2 Package ID: ${ORG2_REGISTRY_PACKAGE_ID}"

# 3. 批准链码
echo ""
echo "3. Approving ${CODE_NAME}..."
# 批准org2

peer lifecycle chaincode approveformyorg \
    -o localhost:7050 \
    --ordererTLSHostnameOverride orderer.example.com \
    --tls --cafile $NETWORK_DIR/organizations/ordererOrganizations/example.com/orderers/orderer.example.com/msp/tlscacerts/tlsca.example.com-cert.pem \
    --channelID mychannel \
    --name ${CODE_NAME} \
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
    --name ${CODE_NAME} \
    --version 1.0 \
    --package-id $ORG1_REGISTRY_PACKAGE_ID \
    --sequence 1 \


# 4. 提交Registry链码
echo ""
echo "4. Committing ${CODE_NAME}..."
peer lifecycle chaincode checkcommitreadiness \
    --channelID mychannel \
    --name ${CODE_NAME} \
    --version 1.0 \
    --sequence 1 \
    --tls --cafile "${NETWORK_DIR}/organizations/ordererOrganizations/example.com/orderers/orderer.example.com/msp/tlscacerts/tlsca.example.com-cert.pem" \
    --output json
# 向channel提交
peer lifecycle chaincode commit \
    -o localhost:7050 \
    --ordererTLSHostnameOverride orderer.example.com \
    --channelID mychannel \
    --name ${CODE_NAME} \
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
    --name ${CODE_NAME} \
    --cafile "${NETWORK_DIR}/organizations/ordererOrganizations/example.com/orderers/orderer.example.com/msp/tlscacerts/tlsca.example.com-cert.pem"






