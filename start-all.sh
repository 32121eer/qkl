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

# 函数：仅清理会导致 WSL/NAT 失效的 localhost 代理变量
sanitize_proxy_env() {
    local proxy_vars=(http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY)
    local cleaned=false

    for key in "${proxy_vars[@]}"; do
        local value="${!key}"
        if [[ -n "$value" ]] && [[ "$value" =~ localhost|127\.0\.0\.1 ]]; then
            unset "$key"
            cleaned=true
            echo "⚠ 检测到 $key 使用 localhost/127.0.0.1，已在脚本进程内自动清理"
        fi
    done

    if [ "$cleaned" = true ]; then
        echo "✓ 已清理当前脚本进程中的本地代理环境变量"
    fi
}

# 函数：检查必要路径
check_required_paths() {
    if [ ! -f "$BOOTSTRAP_SCRIPT" ]; then
        echo "错误: bootstrap.sh 不存在: $BOOTSTRAP_SCRIPT"
        exit 1
    fi

    if [ ! -d "$FABRIC_DIR" ] && [ "$SKIP_FABRIC" = false ]; then
        echo "错误: Fabric 测试网络目录不存在: $FABRIC_DIR"
        exit 1
    fi
}

# 函数：检查 Docker 可用性（Fabric 启动/部署依赖）
check_docker_ready() {
    if ! command -v docker >/dev/null 2>&1; then
        echo "错误: 未找到 docker 命令，请先安装并启动 Docker Desktop"
        exit 1
    fi

    if ! docker info >/dev/null 2>&1; then
        echo "错误: Docker daemon 不可用，请确认 Docker Desktop 已启动"
        exit 1
    fi

    local docker_proxy_info
    docker_proxy_info="$(docker info 2>/dev/null | grep -iE 'HTTP Proxy|HTTPS Proxy' || true)"
    if echo "$docker_proxy_info" | grep -qiE 'localhost:|127\.0\.0\.1|172\.27\.112\.1:7890'; then
        echo "⚠ 检测到 Docker 引擎代理可能导致镜像拉取失败："
        echo "$docker_proxy_info"
        echo "  建议在 Docker Desktop -> Resources -> Proxies 中修正代理配置"
    fi
}

# 函数：判断 Fabric 核心容器是否已运行（用于 skip-fabric 场景）
fabric_network_running() {
    docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^peer0\.org1\.example\.com$' &&
    docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^peer0\.org2\.example\.com$' &&
    docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^orderer\.example\.com$'
}

# 函数：启动 Fabric 网络，失败时自动降级重试（couchdb -> goleveldb）
run_fabric_network_up() {
    local log_file
    log_file="$(mktemp)"

    set +e
    ./network.sh up -ca -s couchdb 2>&1 | tee "$log_file"
    local rc=${PIPESTATUS[0]}
    set -e

    if [ $rc -eq 0 ]; then
        rm -f "$log_file"
        return 0
    fi

    if grep -qiE 'proxyconnect|Failed to pull|pull access denied|registry-1\.docker\.io|toomanyrequests|context canceled' "$log_file"; then
        echo "⚠ 检测到镜像拉取异常，自动降级为 goleveldb 重试..."
        set +e
        ./network.sh up -ca 2>&1 | tee "$log_file"
        rc=${PIPESTATUS[0]}
        set -e

        if [ $rc -eq 0 ]; then
            echo "✓ Fabric 网络已通过 goleveldb 模式启动"
            rm -f "$log_file"
            return 0
        fi
    fi

    echo "✗ Fabric 网络启动失败"
    echo "  诊断建议：docker ps --format \"table {{.Names}}\\t{{.Status}}\""
    rm -f "$log_file"
    return $rc
}

# 函数：全局预检
preflight_checks() {
    sanitize_proxy_env
    check_required_paths

    # Fabric 启动或 Fabric chaincode 部署都依赖 Docker
    if [ "$SKIP_FABRIC" = false ] || [ "$SKIP_DEPLOY_CC" = false ]; then
        check_docker_ready
    fi

    # 如果跳过 Fabric 启动但仍要部署 chaincode，要求网络已存在
    if [ "$SKIP_FABRIC" = true ] && [ "$SKIP_DEPLOY_CC" = false ]; then
        if ! fabric_network_running; then
            echo "错误: 使用 --skip-fabric 时未检测到运行中的 Fabric 网络，无法部署 Fabric Chaincode"
            echo "请先启动 Fabric，或加上 --skip-deploy-cc"
            exit 1
        fi
    fi
}

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

    local channel_name="${FABRIC_CHANNEL_NAME:-mychannel}"

    fabric_channel_exists() {
        # 通过 peer CLI 查询已加入通道列表（只要 peer 可连通即可判断）
        # 注意：FABRIC_CFG_PATH 需要指向 fabric-samples/config（不是 configtx）
        (
            set +e
            export TEST_NETWORK_HOME="${FABRIC_DIR}"
            export FABRIC_CFG_PATH="${FABRIC_DIR}/../config"
            # shellcheck disable=SC1091
            . "${FABRIC_DIR}/scripts/envVar.sh" >/dev/null 2>&1 || exit 1
            setGlobals 1 >/dev/null 2>&1 || exit 1
            peer channel list 2>/dev/null | grep -qw "${channel_name}"
        )
    }
    
    # 清理旧网络
    if [ "$FAST_MODE" = false ] && [ "$NO_DOWN" = false ]; then
        echo "清理旧的 Fabric 网络..."
        ./network.sh down 2>/dev/null || true
    fi
    
    # 启动网络（幂等）：始终先 up，再按需 createChannel
    # 这样可以避免在“通道已存在”时触发 createChannel 的重复 join 失败。
    echo "启动/复用 Fabric 网络..."
    run_fabric_network_up

    if fabric_channel_exists; then
        echo "✓ Fabric 通道 ${channel_name} 已存在，跳过 createChannel"
    else
        echo "创建 Fabric 通道 ${channel_name}..."
        set +e
        out="$(./network.sh createChannel -c "${channel_name}" 2>&1)"
        rc=$?
        set -e

        if [ $rc -ne 0 ]; then
            if echo "$out" | grep -qiE "channel already exists|ledger \\[${channel_name}\\] already exists"; then
                echo "⚠ Fabric 通道/账本已存在，继续复用现有网络"
            else
                echo "$out"
                exit $rc
            fi
        fi
    fi
    
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
    # 0. 启动前预检
    preflight_checks

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
