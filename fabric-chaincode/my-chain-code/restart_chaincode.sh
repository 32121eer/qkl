#!/bin/bash
set -euo pipefail

# 加载环境变量（与dev-net2.sh保持一致）
export PATH=/root/czs/fabric/fabric-2.5.6/build/bin:$PATH
export FABRIC_CFG_PATH=/root/czs/fabric/fabric-2.5.6/sampleconfig/
export CORE_PEER_TLS_ENABLED=false
export CORE_CHAINCODE_LOGLEVEL=debug

# 环境变量配置（与启动脚本保持一致）
WORK_DIR=/root/czs/fabric/dev-net/
CHAIN_CODE_DIR=/root/czs/fabric/my-chain-code/test
CHAIN_CODE_NAME=testcc
CHAIN_CODE_VERSION=1.0
CHAIN_CODE_O=testChaincode
PROCESS_FILE=${WORK_DIR}/process.txt
CHAINCODE_LOG=${WORK_DIR}/ChainCode.log

# 切换到工作目录
cd ${WORK_DIR}

# 1. 停止当前链码进程
echo "=== 停止当前链码进程 ==="
if [ -f "${PROCESS_FILE}" ]; then
    CHAINCODE_PID=$(grep "ChaincodePid" ${PROCESS_FILE} | awk -F':' '{print $2}')
    if [ -n "${CHAINCODE_PID}" ] && ps -P ${CHAINCODE_PID} > /dev/null; then
        echo "杀死链码进程 PID: ${CHAINCODE_PID}"
        kill -9 ${CHAINCODE_PID} || true
        sleep 2
    else
        echo "未找到运行中的链码进程，跳过杀死步骤"
    fi
else
    echo "进程文件不存在，跳过杀死步骤"
fi

# 2. 重新编译链码
echo "=== 重新编译链码 ==="
cd ${CHAIN_CODE_DIR}
echo "进入链码目录: $(pwd)"
go mod tidy || echo "依赖检查完成（无更新）"
go build -o ${CHAIN_CODE_O} . || { echo "链码编译失败"; exit 1; }
echo "链码编译成功: ${CHAIN_CODE_DIR}/${CHAIN_CODE_O}"

# 3. 重启链码进程
echo "=== 重启链码进程 ==="
cd ${WORK_DIR}
export CORE_CHAINCODE_ID_NAME=${CHAIN_CODE_NAME}:${CHAIN_CODE_VERSION}
nohup ${CHAIN_CODE_DIR}/${CHAIN_CODE_O} -peer.address 127.0.0.1:7052 > ${CHAINCODE_LOG} 2>&1 &
CHAINCODE_NEW_PID=$!
echo "新链码进程已启动，PID: ${CHAINCODE_NEW_PID}"

# 更新进程文件中的链码PID
if [ -f "${PROCESS_FILE}" ]; then
    sed -i "s/ChaincodePid:.*/ChaincodePid:${CHAINCODE_NEW_PID}/" ${PROCESS_FILE}
else
    echo "ChaincodePid:${CHAINCODE_NEW_PID}" > ${PROCESS_FILE}
fi
sleep 5  # 等待链码初始化

# 4. 测试示例（可根据实际需求修改）
echo "=== 开始测试修改后的链码 ==="
echo "测试1: 查询资产（asset1）"
peer chaincode query \
  -C mychannel \
  -n ${CHAIN_CODE_NAME} \
  -c '{"Args":["ReadAsset","asset1"]}'

echo -e "\n=== 链码更新与测试完成 ==="
echo "链码日志: tail -f ${CHAINCODE_LOG}"
echo "当前链码PID: ${CHAINCODE_NEW_PID}"