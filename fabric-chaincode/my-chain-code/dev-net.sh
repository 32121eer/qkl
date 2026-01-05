#!/bin/bash

# 彻底清理函数
deep_cleanup() {
    echo "=== 彻底清理Fabric环境 ==="
    
    # 1. 停止所有进程
    echo "1. 停止所有相关进程..."
    pkill -f "orderer" || true
    pkill -f "peer node start" || true
    pkill -f "testChaincode" || true
    sleep 3
    
    # 2. 强制杀死残留进程
    echo "2. 强制清理残留进程..."
    pgrep -f "orderer" | xargs -r kill -9 || true
    pgrep -f "peer" | xargs -r kill -9 || true
    
    # 3. 清理排序节点数据（关键步骤）
    echo "3. 清理排序节点数据..."
    rm -rf /var/hyperledger/production/orderer/ || true
    rm -rf /var/hyperledger/orderer/ || true
    
    # 4. 清理Peer节点数据
    echo "4. 清理Peer节点数据..."
    rm -rf /var/hyperledger/production/ || true
    
    # 5. 清理临时文件
    echo "5. 清理临时文件..."
    rm -rf /tmp/fabric* || true
    rm -rf /var/hyperledger/* || true
    
    # 6. 清理工作目录
    echo "6. 清理工作目录文件..."
    cd /root/czs/fabric/dev-net/ && rm -f \
        orderer.log \
        peer.log \
        ChainCode.log \
        process.txt \
        mychannel.tx \
        mychannel.block \
        testChaincode || true
    
    # 7. 释放端口
    echo "7. 释放被占用端口..."
    fuser -k 7050/tcp || true
    fuser -k 7051/tcp || true
    fuser -k 7052/tcp || true
    
    echo "✓ 彻底清理完成"
    echo ""
}

export PATH=/root/czs/fabric/fabric-2.5.6/build/bin:$PATH
export FABRIC_CFG_PATH=/root/czs/fabric/fabric-2.5.6/sampleconfig/

# 执行彻底清理
deep_cleanup

mkdir /var/hyperledger

FABRIC_DIR=/root/czs/fabric/fabric-2.5.6
CURR_DIR = ${pwd}
WORK_DIR=/root/czs/fabric/dev-net/

echo "进入work dir: ${WORK_DIR}"
cd ${WORK_DIR}

set -e
# 生成创世区块
echo "生成创世区块..."
configtxgen -profile SampleDevModeSolo -channelID syschannel -outputBlock genesisblock -configPath $FABRIC_CFG_PATH -outputBlock "${FABRIC_DIR}/sampleconfig/genesisblock"

# 启动排序节点
echo "启动排序节点..."
ORDERER_GENERAL_GENESISPROFILE=SampleDevModeSolo
nohup  orderer > orderer.log 2>&1 &

# 获取排序节点进程ID
ORDERER_PID=$!
echo "排序节点已在后台启动，PID: $ORDERER_PID"
echo "日志输出到: orderer.log"

# 将 ORDERER_PID 写入 process.txt 文件
echo "OrderPid:$ORDERER_PID" > process.txt
echo "PID 已保存到: process.txt"

# 设置操作监听地址（避免端口冲突）
export CORE_OPERATIONS_LISTENADDRESS=127.0.0.1:9444
echo "等待order启动..."
sleep 5
# 启动 Peer 节点
# 启用开发模式 (--peer-chaincodedev=true)，设置链码调试日志级别，配置链码监听地址
echo "启动peer节点..."
FABRIC_LOGGING_SPEC=chaincode=debug 
CORE_PEER_CHAINCODELISTENADDRESS=0.0.0.0:7052 

nohup peer node start --peer-chaincodedev=true  > peer.log 2>&1 &
echo "等待peer启动..."
sleep 5

PEER_PID=$!
echo "peer节点已在后台启动，PID: $PEER_PID"
echo "日志输出到: peer.log"

# 将 ORDERER_PID 写入 process.txt 文件
echo "PeerPid:$PEER_PID" >> process.txt
echo "PID 已保存到: process.txt"

# 生成通道创建交易
echo "生成通道..."
configtxgen -channelID mychannel -outputCreateChannelTx mychannel.tx -profile SampleSingleMSPChannel -configPath $FABRIC_CFG_PATH
# 创建通道
echo "创建通道..."
peer channel create -o 127.0.0.1:7050 -c mychannel -f mychannel.tx
# 加入通道
echo "加入通道..."
peer channel join -b mychannel.block

# 构建链码
echo "构建链码..."
CHAIN_CODE_DIR=/root/czs/fabric/my-chain-code/test

cd ${CHAIN_CODE_DIR}

CHAIN_CODE_O=testChaincode

go build -o ${CHAIN_CODE_O} /root/czs/fabric/my-chain-code/test
cd ${WORK_DIR}
#启动链码，设置链码标识符 (mycc:1.0)，禁用 TLS（开发模式要求）
#启动链码并连接到 Peer 节点的链码监听端口
export CORE_CHAINCODE_LOGLEVEL=debug 
export CORE_PEER_TLS_ENABLED=false 
export CORE_CHAINCODE_ID_NAME=testcc:1.0 

#这里会阻塞住，链码容器启动后会持续监听 peer 节点的请求
echo "启动链码容器..."
nohup ${CHAIN_CODE_DIR}/${CHAIN_CODE_O} -peer.address 127.0.0.1:7052 > ChainCode.log 2>&1 &
echo "等待链码服务启动..."
sleep 5

CODE_NAME=testcc

echo "打包链码..."
peer lifecycle chaincode package testcc.tar.gz \
    --path ${CHAIN_CODE_DIR} \
    --lang golang \
    --label ${CODE_NAME}_1.0

echo "安装链码..."
peer lifecycle chaincode install ${CODE_NAME}.tar.gz

# 获取PackageID

PACKAGE_ID=$(peer lifecycle chaincode queryinstalled | grep ${CODE_NAME}_1.0 | cut -d ' ' -f 3 | cut -d ',' -f 1)
echo "org2 Package ID: ${PACKAGE_ID}"


echo "批准链码定义..."
# 批准链码定义
peer lifecycle chaincode approveformyorg  \
    -o 127.0.0.1:7050 \
    --channelID mychannel \
    --name testcc --version 1.0 \
    --sequence 1 \
    --init-required \
    --signature-policy "OR ('SampleOrg.member')" \
    --package-id ${PACKAGE_ID}


# 检查提交准备状态
echo "检查提交准备状态..."
peer lifecycle chaincode checkcommitreadiness \
    -o 127.0.0.1:7050 \
    --channelID mychannel \
    --name testcc --version 1.0 \
    --sequence 1 \
    --init-required \
    --signature-policy "OR ('SampleOrg.member')"

# 提交链码定义
echo "提交链码定义..."
peer lifecycle chaincode commit \
    -o 127.0.0.1:7050 \
    --channelID mychannel \
    --name testcc --version 1.0 \
    --sequence 1 \
    --init-required \
    --signature-policy "OR ('SampleOrg.member')" \
    --peerAddresses 127.0.0.1:7051

# 初始化链码
echo "初始化链码..."
CORE_PEER_ADDRESS=127.0.0.1:7051 
peer chaincode invoke \
    -o 127.0.0.1:7050 \
    -C mychannel \
    -n testcc \
    -c '{"Args":["InitLedger"]}' \
    --isInit
# 调用链码方法
echo "调用链码方法..."
CORE_PEER_ADDRESS=127.0.0.1:7051 
peer chaincode invoke \
    -o 127.0.0.1:7050 \
    -C mychannel -n testcc \
    -c '{"Args":["ReadAsset","asset1"]}'
