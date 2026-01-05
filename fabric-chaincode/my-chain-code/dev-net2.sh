#!/bin/bash
set -euo pipefail  # 增强错误检测，比set -e更严格

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

# 全局环境变量配置（确保生效）
export PATH=/root/czs/fabric/fabric-2.5.6/build/bin:$PATH
export FABRIC_CFG_PATH=/root/czs/fabric/fabric-2.5.6/sampleconfig/
export CORE_PEER_TLS_ENABLED=false  # 全局禁用TLS（开发模式）
export CORE_CHAINCODE_LOGLEVEL=info
export CORE_OPERATIONS_LISTENADDRESS=127.0.0.1:9444  # 避免端口冲突

# 执行彻底清理
deep_cleanup

# 创建目录（加-p避免已存在报错）
mkdir -p /var/hyperledger

# 定义关键路径（修复赋值空格错误）
FABRIC_DIR=/root/czs/fabric/fabric-2.5.6
CURR_DIR=$(pwd)  # 修复pwd调用错误
WORK_DIR=/root/czs/fabric/dev-net/
CHAIN_CODE_DIR=/root/czs/fabric/my-chain-code/test
CHAIN_CODE_NAME=testcc
CHAIN_CODE_VERSION=1.0
CHAIN_CODE_O=testChaincode

echo "进入work dir: ${WORK_DIR}"
cd ${WORK_DIR}

# 生成创世区块
echo "=== 生成创世区块 ==="
configtxgen -profile SampleDevModeSolo -channelID syschannel \
    -outputBlock "${FABRIC_DIR}/sampleconfig/genesisblock" \
    -configPath $FABRIC_CFG_PATH

# 启动排序节点
echo "=== 启动排序节点 ==="
export ORDERER_GENERAL_GENESISPROFILE=SampleDevModeSolo
nohup orderer > orderer.log 2>&1 &
ORDERER_PID=$!
echo "排序节点已启动，PID: ${ORDERER_PID}"
echo "日志文件: ${WORK_DIR}/orderer.log"
echo "OrderPid:${ORDERER_PID}" > process.txt
echo "等待5秒，确保orderer完全启动"
sleep 5  # 延长等待时间，确保orderer完全启动

# 启动Peer节点（开发模式）
echo "=== 启动Peer节点 ==="
export CORE_PEER_CHAINCODELISTENADDRESS=0.0.0.0:7052  # 导出环境变量确保生效
export FABRIC_LOGGING_SPEC=chaincode=debug
nohup peer node start --peer-chaincodedev=true > peer.log 2>&1 &
PEER_PID=$!
echo "Peer节点已启动，PID: ${PEER_PID}"
echo "日志文件: ${WORK_DIR}/peer.log"
echo "PeerPid:${PEER_PID}" >> process.txt
echo "等待8秒，确保peer完全启动"
sleep 8  # 延长等待时间，确保peer完全启动

# 生成并创建通道
echo "=== 生成并创建通道 ==="
configtxgen -channelID mychannel -outputCreateChannelTx mychannel.tx \
    -profile SampleSingleMSPChannel -configPath $FABRIC_CFG_PATH

peer channel create -o 127.0.0.1:7050 -c mychannel -f mychannel.tx
peer channel join -b mychannel.block

# 构建链码（修复编译路径错误）
echo "=== 构建链码 ==="
cd ${CHAIN_CODE_DIR}
go mod tidy  # 确保依赖完整
go build -o ${CHAIN_CODE_O} .  # 正确的编译方式（当前目录）
cd ${WORK_DIR}

# 启动链码（开发模式）
echo "=== 启动链码（开发模式） ==="
export CORE_CHAINCODE_ID_NAME=${CHAIN_CODE_NAME}:${CHAIN_CODE_VERSION}
nohup ${CHAIN_CODE_DIR}/${CHAIN_CODE_O} -peer.address 127.0.0.1:7052 > ChainCode.log 2>&1 &
CHAINCODE_PID=$!
echo "链码已启动，PID: ${CHAINCODE_PID}"
echo "日志文件: ${WORK_DIR}/ChainCode.log"
echo "ChaincodePid:${CHAINCODE_PID}" >> process.txt
echo "等待8秒，确保链码监听就绪"
sleep 8  # 延长等待，确保链码监听就绪
export FABRIC_LOGGING_SPEC=INFO
export CORE_LOGGING_LEVEL=INFO
export ORDERER_LOGGING_LEVEL=INFO
# 链码生命周期操作
echo "=== 链码打包 & 安装 ==="
peer lifecycle chaincode package ${CHAIN_CODE_NAME}.tar.gz \
    --path ${CHAIN_CODE_DIR} \
    --lang golang \
    --label ${CHAIN_CODE_NAME}_${CHAIN_CODE_VERSION}

peer lifecycle chaincode install ${CHAIN_CODE_NAME}.tar.gz

# 获取PackageID（增强兼容性）
PACKAGE_ID=$(peer lifecycle chaincode queryinstalled | grep "${CHAIN_CODE_NAME}_${CHAIN_CODE_VERSION}" | awk -F'[ ,]' '{print $3}')
echo "链码Package ID: ${PACKAGE_ID}"
if [ -z "${PACKAGE_ID}" ]; then
    echo "ERROR: 未获取到链码Package ID，请检查安装日志"
    cat peer.log
    exit 1
fi

# 批准链码定义
echo "=== 批准链码定义 ==="
peer lifecycle chaincode approveformyorg  \
    -o 127.0.0.1:7050 \
    --channelID mychannel \
    --name ${CHAIN_CODE_NAME} \
    --version ${CHAIN_CODE_VERSION} \
    --sequence 1 \
    --init-required \
    --signature-policy "OR ('SampleOrg.member')" \
    --package-id ${PACKAGE_ID}

# 检查提交准备状态
echo "=== 检查提交准备状态 ==="
peer lifecycle chaincode checkcommitreadiness \
    -o 127.0.0.1:7050 \
    --channelID mychannel \
    --name ${CHAIN_CODE_NAME} \
    --version ${CHAIN_CODE_VERSION} \
    --sequence 1 \
    --init-required \
    --signature-policy "OR ('SampleOrg.member')"

# 提交链码定义
echo "=== 提交链码定义 ==="
peer lifecycle chaincode commit \
    -o 127.0.0.1:7050 \
    --channelID mychannel \
    --name ${CHAIN_CODE_NAME} \
    --version ${CHAIN_CODE_VERSION} \
    --sequence 1 \
    --init-required \
    --signature-policy "OR ('SampleOrg.member')" \
    --peerAddresses 127.0.0.1:7051

# 初始化链码（关键修复：--isInit 正确调用，环境变量直接传递）
echo "=== 初始化链码 ==="
CORE_PEER_ADDRESS=127.0.0.1:7051 peer chaincode invoke \
    -o 127.0.0.1:7050 \
    -C mychannel \
    -n ${CHAIN_CODE_NAME} \
    -c '{"Args":["InitLedger"]}' \
    --isInit

# 验证初始化结果
echo "=== 验证链码初始化 ==="
sleep 3
peer chaincode query \
    -C mychannel \
    -n ${CHAIN_CODE_NAME} \
    -c '{"Args":["ReadAsset","asset1"]}'

echo "=== 所有步骤执行完成 ==="
echo "进程ID文件: ${WORK_DIR}/process.txt"
echo "日志文件路径："
echo "  - Orderer: ${WORK_DIR}/orderer.log"
echo "  - Peer: ${WORK_DIR}/peer.log"
echo "  - 链码: ${WORK_DIR}/ChainCode.log"