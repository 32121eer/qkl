#!/bin/bash

FABRIC_SAMPLES_MAIN=/mnt/fast18/xunuo/qukuialian/czs/fabric-samples-main
export PATH=${FABRIC_SAMPLES_MAIN}/bin:$PATH
export FABRIC_CFG_PATH=${FABRIC_SAMPLES_MAIN}/config/

NETWORK_DIR="${FABRIC_SAMPLES_MAIN}/test-network"
ORDERER_CA="${FABRIC_SAMPLES_MAIN}/test-network/organizations/ordererOrganizations/example.com/tlsca/tlsca.example.com-cert.pem"


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
