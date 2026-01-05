#!/bin/bash

export PATH=/home/tr/fabric-samples/bin:$PATH
export FABRIC_CFG_PATH=/home/tr/fabric-samples/config/
export CORE_PEER_TLS_ENABLED=true
export CORE_PEER_LOCALMSPID="Org1MSP"
export CORE_PEER_TLS_ROOTCERT_FILE=/home/tr/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/ca.crt
export CORE_PEER_MSPCONFIGPATH=/home/tr/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/users/Admin@org1.example.com/msp
export CORE_PEER_ADDRESS=localhost:7051

ORDERER_CA=/home/tr/fabric-samples/test-network/organizations/ordererOrganizations/example.com/orderers/orderer.example.com/msp/tlscacerts/tlsca.example.com-cert.pem
ORG1_CA=/home/tr/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/ca.crt
ORG2_CA=/home/tr/fabric-samples/test-network/organizations/peerOrganizations/org2.example.com/peers/peer0.org2.example.com/tls/ca.crt

echo "Testing gateway_cc Send function..."

peer chaincode invoke \
  -o localhost:7050 \
  --ordererTLSHostnameOverride orderer.example.com \
  --tls \
  --cafile $ORDERER_CA \
  -C mychannel \
  -n gateway_cc \
  --peerAddresses localhost:7051 \
  --tlsRootCertFiles $ORG1_CA \
  --peerAddresses localhost:9051 \
  --tlsRootCertFiles $ORG2_CA \
  -c '{"function":"Send","Args":["FISCO_NET_01","0x1234567890abcdef","transfer","{\"amount\":100}"]}'

echo "Done!"

