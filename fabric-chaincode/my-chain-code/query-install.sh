#!/bin/bash

export PATH=/root/czs/fabric/fabric-samples-main/bin:$PATH
export FABRIC_CFG_PATH=/root/czs/fabric/fabric-samples-main/config/

NETWORK_DIR="/root/czs/fabric/fabric-samples-main/test-network"
ORDERER_CA="/root/czs/fabric/fabric-samples-main/test-network/organizations/ordererOrganizations/example.com/tlsca/tlsca.example.com-cert.pem"
ORG1_PEER0_CA="/root/czs/fabric/fabric-samples-main/test-network/organizations/"
ORG2_PEER0_CA="/root/czs/fabric/fabric-samples-main/test-network/organizations/"


set -e

export CORE_PEER_TLS_ENABLED=true
export CORE_PEER_LOCALMSPID="Org1MSP"
export CORE_PEER_TLS_ROOTCERT_FILE=${NETWORK_DIR}/organizations/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/ca.crt
export CORE_PEER_MSPCONFIGPATH=${NETWORK_DIR}/organizations/peerOrganizations/org1.example.com/users/Admin@org1.example.com/msp
export CORE_PEER_ADDRESS=localhost:7051


peer lifecycle chaincode queryinstalled


