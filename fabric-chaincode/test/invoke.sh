#!/bin/bash
# 设置环境变量
export PATH=/root/czs/fabric/fabric-samples-main/bin:$PATH
export FABRIC_CFG_PATH=/root/czs/fabric/fabric-samples-main/config/

export CORE_PEER_TLS_ENABLED=true
export CORE_PEER_LOCALMSPID="Org1MSP"
export CORE_PEER_TLS_ROOTCERT_FILE=/root/czs/fabric/fabric-samples-main/test-network/organizations/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/ca.crt
export CORE_PEER_MSPCONFIGPATH=/root/czs/fabric/fabric-samples-main/test-network/organizations/peerOrganizations/org1.example.com/users/Admin@org1.example.com/msp
export CORE_PEER_ADDRESS=localhost:7051

# 调用链码
peer chaincode invoke \
  -o localhost:7050 \
  --ordererTLSHostnameOverride orderer.example.com \
  --tls \
  --cafile /root/czs/fabric/fabric-samples-main/test-network/organizations/ordererOrganizations/example.com/orderers/orderer.example.com/msp/tlscacerts/tlsca.example.com-cert.pem \
  -C mychannel \
  -n events \
  --peerAddresses localhost:7051 \
  --tlsRootCertFiles /root/czs/fabric/fabric-samples-main/test-network/organizations/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/ca.crt \
  -c '{"function":"createAsset","Args":["1234", "blue", "10", "Sam", "100"]}'
  # -c '{"function":"CreateAsset","Args":[]}'  # 调用CreateAsset方法，无参数

#   -c '{"Args":["emit"]}'
