#!/bin/bash


export PATH=/root/czs/fabric/fabric-samples-main/bin:$PATH
export FABRIC_CFG_PATH=/root/czs/fabric/fabric-samples-main/config/

NETWORK_DIR="/root/czs/fabric/fabric-samples-main/test-network"
ORDERER_CA="/root/czs/fabric/fabric-samples-main/test-network/organizations/ordererOrganizations/example.com/tlsca/tlsca.example.com-cert.pem"


set -e
CURRENT_DIR=${PWD}
# 关闭网络
echo "shutdown network..."
cd ${NETWORK_DIR}
./network.sh down
