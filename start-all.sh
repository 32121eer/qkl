#!/bin/bash

# start-all.sh - 跨链系统一键启动脚本
# 功能：
#   1. 启动 FISCO-BCOS 节点
#   2. 启动 Hyperledger Fabric 测试网络
#   3. 自动部署合约和 Chaincode (通过 bootstrap.sh)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FISCO_DIR="$SCRIPT_DIR/fisco-bcos"
FABRIC_SAMPLES_DIR="${FABRIC_SAMPLES_DIR:-/home/tr/fabric-samples}"
FABRIC_DIR="$FABRIC_SAMPLES_DIR/test-network"
BOOTSTRAP_SCRIPT="$SCRIPT_DIR/bootstrap.sh"

# 默认参数
SKIP_FISCO=false
SKIP_FABRIC=false
SKIP_DEPLOY_CC=false
FAST_MODE=false
NO_DOWN=false

# 解析命令行参数
while [[ $# -gt 0 ]]; do
    case $1 in
        --skip-fisco)
            SKIP_FISCO=true
            shift
            ;;
        --skip-fabric)
            SKIP_FABRIC=true
            shift
            ;;
        --skip-deploy-cc)
            SKIP_DEPLOY_CC=true
            shift
            ;;
        --fast)
            FAST_MODE=true
            shift
            ;;
        --no-down)
            NO_DOWN=true
            shift
            ;;
        *)
            echo "Unknown option: $1"
            echo "Usage: $0 [--skip-fisco] [--skip-fabric] [--skip-deploy-cc] [--fast] [--no-down]"
            exit 1
            ;;
    esac
done

echo "========================================="
echo "  跨链系统一键启动"
echo "========================================="
echo "SKIP_FISCO: $SKIP_FISCO"
echo "SKIP_FABRIC: $SKIP_FABRIC"
echo "SKIP_DEPLOY_CC: $SKIP_DEPLOY_CC"
echo "FAST_MODE: $FAST_MODE"
echo "NO_DOWN: $NO_DOWN"
echo "========================================="

# 函数：启动 FISCO-BCOS
start_fisco() {
    echo ""
    echo "[1/3] 启动 FISCO-BCOS 节点..."
    
    if [ ! -d "$FISCO_DIR/nodes" ]; then
        echo "错误: FISCO 节点目录不存在: $FISCO_DIR/nodes"
        echo "请先初始化 FISCO 节点"
        exit 1
    fi

    cd "$FISCO_DIR/nodes/127.0.0.1"
    
    # 停止旧节点
    if [ "$FAST_MODE" = false ]; then
        echo "停止旧的 FISCO 节点..."
        bash stop_all.sh 2>/dev/null || true
        sleep 2
    fi
    
    # 启动节点
    echo "启动 FISCO 节点..."
    bash start_all.sh
    sleep 5
    
    # 验证启动
    if ps aux | grep -v grep | grep "fisco-bcos" > /dev/null; then
        echo "✓ FISCO-BCOS 启动成功"
    else
        echo "✗ FISCO-BCOS 启动失败"
        exit 1
    fi
    
    cd "$SCRIPT_DIR"
}

# 函数：启动 Fabric
start_fabric() {
    echo ""
    echo "[2/3] 启动 Hyperledger Fabric 网络..."
    
    if [ ! -d "$FABRIC_DIR" ]; then
        echo "错误: Fabric 测试网络目录不存在: $FABRIC_DIR"
        exit 1
    fi

    cd "$FABRIC_DIR"
    
    # 清理旧网络
    if [ "$FAST_MODE" = false ] && [ "$NO_DOWN" = false ]; then
        echo "清理旧的 Fabric 网络..."
        ./network.sh down 2>/dev/null || true
    fi
    
    # 启动网络
    echo "启动 Fabric 网络和通道..."
    ./network.sh up createChannel -ca -s couchdb
    
    echo "✓ Fabric 网络启动成功"
    
    cd "$SCRIPT_DIR"
}

# 函数：部署合约
deploy_contracts() {
    echo ""
    echo "[3/3] 部署合约和 Chaincode..."
    
    # 确保 bootstrap.sh 可执行
    chmod +x "$BOOTSTRAP_SCRIPT"
    
    # 构建参数
    BOOTSTRAP_ARGS="--redeploy-fisco --receive-method receiveLite"
    
    if [ "$SKIP_DEPLOY_CC" = true ]; then
        BOOTSTRAP_ARGS="$BOOTSTRAP_ARGS --skip-fabric-cc"
    fi
    
    # 调用 bootstrap.sh
    bash "$BOOTSTRAP_SCRIPT" $BOOTSTRAP_ARGS
    
    echo "✓ 合约部署完成"
}

# 主流程
main() {
    # 1. 启动 FISCO
    if [ "$SKIP_FISCO" = false ]; then
        start_fisco
    else
        echo "[1/3] 跳过 FISCO 启动"
    fi

    # 2. 启动 Fabric
    if [ "$SKIP_FABRIC" = false ]; then
        start_fabric
    else
        echo "[2/3] 跳过 Fabric 启动"
    fi

    # 3. 部署合约（总是执行，除非明确跳过）
    deploy_contracts

    echo ""
    echo "========================================="
    echo "✓ 所有服务启动完成！"
    echo "========================================="
    echo ""
    echo "下一步："
    echo "  1. 启动 Relayer:"
    echo "     cd fabric-chaincode/Relayer"
    echo "     npm start | tee ~/relayer.log"
    echo ""
    echo "  2. 测试跨链 (Fabric → FISCO):"
    echo "     cd fabric-chaincode/Relayer"
    echo "     node test-crosschain.js"
    echo ""
    echo "  3. 查看日志:"
    echo "     tail -50 ~/relayer.log"
    echo "     grep 'MessageHandler' ~/relayer.log"
    echo ""
    echo "更多信息请查看: CROSSCHAIN_GUIDE.md"
    echo "========================================="
}

# 执行主流程
main

