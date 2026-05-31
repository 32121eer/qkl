#!/bin/bash
set -e

# ============================================================================
# 跨链系统一键启动脚本
# ============================================================================
# 使用说明：
#   cd /path/to/cross-chain/fabric-chaincode/Relayer
#   ./start-all.sh
#
# 可配置路径（如需修改，请编辑以下变量）：
# ============================================================================

# 获取脚本所在目录（用于计算相对路径）
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
FABRIC_RUNTIME_HELPER="${PROJECT_ROOT}/scripts/fabric-runtime.sh"

# ============================================================================
# 【可配置】项目内部路径（基于 PROJECT_ROOT 的相对路径）
# ============================================================================
FISCO_NODES_DIR="${PROJECT_ROOT}/fisco-bcos/nodes/127.0.0.1"
FISCO_CONSOLE_DIR="${PROJECT_ROOT}/fisco-bcos/console"
RELAYER_DIR="${PROJECT_ROOT}/fabric-chaincode/Relayer"
GATEWAY_CC_DIR="${PROJECT_ROOT}/fabric-chaincode/my-chain-code/gateway_cc"

# ============================================================================
# 【可配置】外部依赖路径 - fabric-samples 的位置
# 注意：fabric-samples 通常安装在用户目录下，不在本项目内
# 如果您的 fabric-samples 在不同位置，请修改此变量
# ============================================================================
if [ ! -f "${FABRIC_RUNTIME_HELPER}" ]; then
    echo "  ✗ 错误: Fabric 运行时助手不存在: ${FABRIC_RUNTIME_HELPER}"
    exit 1
fi
# shellcheck disable=SC1090
source "${FABRIC_RUNTIME_HELPER}"

FABRIC_SAMPLES_SOURCE_DIR="$(fabric_detect_source_samples_dir || true)"
if [[ -n "${FABRIC_SAMPLES_SOURCE_DIR}" ]]; then
    fabric_prepare_runtime "${PROJECT_ROOT}" "${FABRIC_SAMPLES_SOURCE_DIR}" || true
fi

FABRIC_NETWORK_DIR="${FABRIC_DIR:-}"

# ============================================================================

echo "=========================================="
echo "       跨链系统一键启动脚本"
echo "=========================================="
echo "项目根目录: ${PROJECT_ROOT}"
echo "FISCO 节点: ${FISCO_NODES_DIR}"
echo "Fabric 网络: ${FABRIC_NETWORK_DIR}"
echo "Fabric 源目录: ${FABRIC_SAMPLES_SOURCE_DIR:-<not-found>}"
echo ""

# 1. 修复权限
echo "[1/5] 修复脚本权限..."
chmod -R +x "${FISCO_NODES_DIR}"/*.sh 2>/dev/null || true
chmod -R +x "${FISCO_NODES_DIR}"/node*/*.sh 2>/dev/null || true
chmod +x "${FISCO_CONSOLE_DIR}"/*.sh 2>/dev/null || true
echo "  ✓ 权限已修复"

# 2. 启动 FISCO 节点
echo ""
echo "[2/5] 启动 FISCO-BCOS 节点..."
cd "${FISCO_NODES_DIR}"
./stop_all.sh 2>/dev/null || true
sleep 2
./start_all.sh
sleep 5
FISCO_COUNT=$(ps aux | grep fisco-bcos | grep -v grep | wc -l)
echo "  ✓ FISCO 节点启动: $FISCO_COUNT 个"

# 检查 RPC 端口
if nc -z localhost 8545 2>/dev/null; then
    echo "  ✓ RPC 端口 8545 已监听"
else
    echo "  ✗ 警告: RPC 端口 8545 未监听"
fi

# 3. 启动 Fabric 网络
echo ""
echo "[3/5] 启动 Fabric 网络..."
fabric_prepare_runtime "${PROJECT_ROOT}" "${FABRIC_SAMPLES_SOURCE_DIR:-}" || {
    echo "  ✗ 错误: 未找到可用的 fabric-samples，无法准备可写 Fabric 运行时"
    exit 1
}
FABRIC_NETWORK_DIR="${FABRIC_DIR:-}"
if [ ! -d "${FABRIC_NETWORK_DIR}" ]; then
    echo "  ✗ 错误: Fabric 网络目录不存在: ${FABRIC_NETWORK_DIR}"
    echo "  请设置环境变量 FABRIC_SAMPLES_DIR 指向正确的 fabric-samples 目录"
    echo "  当前机器可用候选通常是: /mnt/fast18/xunuo/czs/fabric-samples"
    exit 1
fi
cd "${FABRIC_NETWORK_DIR}"
if [ -d "${FABRIC_BIN_DIR}" ]; then
    export PATH="${FABRIC_BIN_DIR}:$PATH"
fi
if [ -d "${FABRIC_CONFIG_DIR}" ]; then
    export FABRIC_CFG_PATH="${FABRIC_CONFIG_DIR}"
fi
./network.sh down 2>/dev/null || true
sleep 2
if command -v fabric-ca-client >/dev/null 2>&1; then
    ./network.sh up createChannel -c mychannel -ca
else
    echo "  ⚠ 未检测到 fabric-ca-client，回退到 cryptogen 模式"
    ./network.sh up createChannel -c mychannel
fi
sleep 5
FABRIC_COUNT=$(docker ps | grep hyperledger | wc -l)
echo "  ✓ Fabric 容器启动: $FABRIC_COUNT 个"

# 4. 部署 Fabric 链码
echo ""
echo "[4/5] 部署 gateway_cc 链码..."
export FABRIC_CRYPTO_PATH="${FABRIC_CRYPTO_PATH:-${FABRIC_NETWORK_DIR}/organizations/peerOrganizations/org1.example.com}"
export FABRIC_PEER_BIN="${FABRIC_PEER_BIN:-${FABRIC_BIN_DIR}/peer}"
./network.sh deployCC -ccn gateway_cc -ccp "${GATEWAY_CC_DIR}" -ccl go
echo "  ✓ 链码部署完成"

# 5. 完成
echo ""
echo "[5/5] 启动完成!"
echo ""
echo "=========================================="
echo "              启动摘要"
echo "=========================================="
echo "FISCO 节点: $FISCO_COUNT 个运行中"
echo "FISCO RPC:  http://127.0.0.1:8545"
echo "FISCO SDK:  127.0.0.1:20203"
echo "Fabric:     localhost:7051"
echo ""
echo "下一步:"
echo "  1. 新终端启动 Relayer:"
echo "     cd ${RELAYER_DIR} && npm start"
echo ""
echo "  2. 新终端启动 FISCO Console (可选):"
echo "     cd ${FISCO_CONSOLE_DIR} && ./start.sh"
echo "=========================================="
