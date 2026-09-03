#!/bin/bash

# start-all.sh - 跨链系统一键启动脚本
# 功能：
#   1. 启动 FISCO-BCOS 节点
#   2. 启动 Hyperledger Fabric 测试网络
#   3. 自动部署合约和 Chaincode (通过 bootstrap.sh)

set -e

# macOS: start Docker API version proxy so that Fabric peers (go-dockerclient 1.25)
# can talk to Docker Desktop 29.x (which requires minimum API 1.40).
if [[ "$(uname)" == "Darwin" ]]; then
    _PROXY_SOCK=/tmp/docker-api-proxy.sock
    _PROXY_PID_FILE=/tmp/docker-api-proxy.pid
    _PROXY_SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/scripts/docker-api-proxy.js"
    _RUNNING=false
    if [[ -f "$_PROXY_PID_FILE" ]]; then
        _PID=$(cat "$_PROXY_PID_FILE")
        if kill -0 "$_PID" 2>/dev/null; then _RUNNING=true; fi
    fi
    if [[ "$_RUNNING" == false ]]; then
        nohup node "$_PROXY_SCRIPT" "$_PROXY_SOCK" /var/run/docker.sock \
            > /tmp/docker-api-proxy.log 2>&1 &
        echo $! > "$_PROXY_PID_FILE"
        sleep 1
        echo "✓ Docker API 代理已启动 (PID=$(cat $_PROXY_PID_FILE))"
    else
        echo "✓ Docker API 代理已在运行 (PID=$(cat $_PROXY_PID_FILE))"
    fi
fi

# macOS: prepend Homebrew OpenJDK to PATH (takes precedence over /usr/bin/java stub)
for _jdk_path in \
    /opt/homebrew/opt/openjdk@21/bin \
    /opt/homebrew/opt/openjdk@17/bin \
    /opt/homebrew/opt/openjdk/bin \
    /usr/local/opt/openjdk@21/bin; do
    if [[ -x "$_jdk_path/java" ]]; then
        export PATH="$_jdk_path:$PATH"
        break
    fi
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FISCO_DIR="$SCRIPT_DIR/fisco-bcos"
RELAYER_DIR="$SCRIPT_DIR/fabric-chaincode/Relayer"
BOOTSTRAP_SCRIPT="$SCRIPT_DIR/bootstrap.sh"
FABRIC_RUNTIME_HELPER="$SCRIPT_DIR/scripts/fabric-runtime.sh"

if [ ! -f "$FABRIC_RUNTIME_HELPER" ]; then
    echo "错误: Fabric 运行时助手不存在: $FABRIC_RUNTIME_HELPER"
    exit 1
fi
# shellcheck disable=SC1090
source "$FABRIC_RUNTIME_HELPER"

if [[ -z "${FABRIC_SAMPLES_DIR:-}" ]] && \
   [[ -f "$SCRIPT_DIR/.fabric-runtime/fabric-samples/test-network/network.sh" ]]; then
    FABRIC_SAMPLES_DIR="$SCRIPT_DIR/.fabric-runtime/fabric-samples"
fi

FABRIC_SAMPLES_SOURCE_DIR="$(fabric_detect_source_samples_dir || true)"
if [[ -n "$FABRIC_SAMPLES_SOURCE_DIR" ]]; then
    fabric_prepare_runtime "$SCRIPT_DIR" "$FABRIC_SAMPLES_SOURCE_DIR" || true
fi
FABRIC_USE_CA=true

# 默认参数
SKIP_FISCO=false
SKIP_FABRIC=false
SKIP_DEPLOY_CC=false
FAST_MODE=false
# Default: keep Fabric ledger across restarts. Pass --reset to tear down.
NO_DOWN=true
REDEPLOY_FABRIC_CC=false
SKIP_CA_TLS_VERIFY=false

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
        --redeploy-fabric-cc)
            REDEPLOY_FABRIC_CC=true
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
        --reset)
            # Force tear-down of Fabric network; clears all chaincode state.
            # Use after schema changes or when state corruption is suspected.
            NO_DOWN=false
            shift
            ;;
        --skip-ca-tls-verify)
            SKIP_CA_TLS_VERIFY=true
            shift
            ;;
        *)
            echo "Unknown option: $1"
            echo "Usage: $0 [--skip-fisco] [--skip-fabric] [--skip-deploy-cc] [--redeploy-fabric-cc] [--fast] [--no-down] [--reset] [--skip-ca-tls-verify]"
            echo "  Default: Fabric ledger PERSISTS across restarts. Pass --reset to wipe."
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
echo "REDEPLOY_FABRIC_CC: $REDEPLOY_FABRIC_CC"
echo "SKIP_CA_TLS_VERIFY: $SKIP_CA_TLS_VERIFY"
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
        echo "可用候选已搜索: /mnt/fast18/xunuo/czs/fabric-samples, /home/tr/fabric-samples"
        echo "如路径不同，请先执行: export FABRIC_SAMPLES_DIR=/your/fabric-samples"
        exit 1
    fi

    if [ ! -d "$RELAYER_DIR" ]; then
        echo "错误: Relayer 目录不存在: $RELAYER_DIR"
        exit 1
    fi
}

# 函数：强制清理残留 relayer 进程（避免旧 TLS 连接/旧配置）
kill_pid_gracefully() {
    local pid="$1"
    local label="$2"

    if ! kill -0 "$pid" >/dev/null 2>&1; then
        return
    fi

    kill "$pid" >/dev/null 2>&1 || true
    for _ in {1..8}; do
        if ! kill -0 "$pid" >/dev/null 2>&1; then
            break
        fi
        sleep 1
    done

    if kill -0 "$pid" >/dev/null 2>&1; then
        kill -9 "$pid" >/dev/null 2>&1 || true
    fi
    echo "✓ 已停止 ${label} (pid=${pid})"
}

cleanup_stale_relayer_processes() {
    local found=false

    # 先尝试按命令行匹配，后校验 cwd，避免误杀其他 node 进程
    while IFS= read -r pid; do
        [ -z "$pid" ] && continue
        [ "$pid" = "$$" ] && continue

        local cwd cmdline
        cwd="$(readlink -f "/proc/${pid}/cwd" 2>/dev/null || true)"
        cmdline="$(tr '\0' ' ' < "/proc/${pid}/cmdline" 2>/dev/null || true)"
        [ -z "$cmdline" ] && continue

        if [ "$cwd" = "$RELAYER_DIR" ] && [[ "$cmdline" == *"node index.js"* ]]; then
            found=true
            kill_pid_gracefully "$pid" "stale-relayer"
        fi
    done < <(pgrep -f 'node index.js' || true)

    if [ "$found" = true ]; then
        echo "✓ 已清理残留 Relayer 进程"
    else
        echo "✓ 未发现残留 Relayer 进程"
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
    local up_args=()

    if [ "$FABRIC_USE_CA" = true ]; then
        up_args=(-ca -s couchdb)
    else
        up_args=(-s couchdb)
    fi

    set +e
    ./network.sh up "${up_args[@]}" 2>&1 | tee "$log_file"
    local rc=${PIPESTATUS[0]}
    set -e

    if [ $rc -eq 0 ]; then
        rm -f "$log_file"
        return 0
    fi

    if grep -qiE 'proxyconnect|Failed to pull|pull access denied|registry-1\.docker\.io|toomanyrequests|context canceled' "$log_file"; then
        echo "⚠ 检测到镜像拉取异常，自动降级为 goleveldb 重试..."
        set +e
        if [ "$FABRIC_USE_CA" = true ]; then
            ./network.sh up -ca 2>&1 | tee "$log_file"
        else
            ./network.sh up 2>&1 | tee "$log_file"
        fi
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

# 函数：从 CA 容器回填本地 ca-cert.pem，避免本地证书与容器运行时证书不一致
sync_fabric_ca_certs_from_containers() {
    mkdir -p "$FABRIC_DIR/organizations/fabric-ca/ordererOrg" \
             "$FABRIC_DIR/organizations/fabric-ca/org1" \
             "$FABRIC_DIR/organizations/fabric-ca/org2"

    docker cp ca_orderer:/etc/hyperledger/fabric-ca-server/ca-cert.pem \
        "$FABRIC_DIR/organizations/fabric-ca/ordererOrg/ca-cert.pem" >/dev/null 2>&1 || return 1
    docker cp ca_org1:/etc/hyperledger/fabric-ca-server/ca-cert.pem \
        "$FABRIC_DIR/organizations/fabric-ca/org1/ca-cert.pem" >/dev/null 2>&1 || return 1
    docker cp ca_org2:/etc/hyperledger/fabric-ca-server/ca-cert.pem \
        "$FABRIC_DIR/organizations/fabric-ca/org2/ca-cert.pem" >/dev/null 2>&1 || return 1

    return 0
}

# 函数：校验 localhost:CA_PORT 返回的 TLS 证书能被对应 CA 根证书验证
verify_single_ca_tls_chain() {
    local container_name="$1"
    local port="$2"
    local local_ca_file="$3"
    local tmp_leaf
    local tmp_ca
    tmp_leaf="$(mktemp)"
    tmp_ca="$(mktemp)"

    if ! openssl s_client -connect "127.0.0.1:${port}" -servername localhost </dev/null 2>/dev/null \
        | awk '/BEGIN CERTIFICATE/{flag=1} flag{print} /END CERTIFICATE/{exit}' > "$tmp_leaf"; then
        rm -f "$tmp_leaf" "$tmp_ca"
        return 1
    fi

    if ! docker cp "${container_name}:/etc/hyperledger/fabric-ca-server/ca-cert.pem" "$tmp_ca" >/dev/null 2>&1; then
        rm -f "$tmp_leaf" "$tmp_ca"
        return 1
    fi

    if ! openssl verify -CAfile "$tmp_ca" "$tmp_leaf" >/dev/null 2>&1; then
        echo "⚠ CA TLS 校验失败: ${container_name} (${port})"
        echo "  - server leaf: $(openssl x509 -in "$tmp_leaf" -noout -fingerprint -sha256 2>/dev/null | sed 's/.*=//')"
        echo "  - runtime ca : $(openssl x509 -in "$tmp_ca" -noout -fingerprint -sha256 2>/dev/null | sed 's/.*=//')"
        rm -f "$tmp_leaf" "$tmp_ca"
        return 1
    fi

    if [ -f "$local_ca_file" ] && ! cmp -s "$tmp_ca" "$local_ca_file"; then
        cp "$tmp_ca" "$local_ca_file"
    fi

    rm -f "$tmp_leaf" "$tmp_ca"
    return 0
}

# 函数：Fabric CA TLS 健康检查与自愈
ensure_fabric_ca_tls_ready() {
    if [ "$FABRIC_USE_CA" != true ]; then
        echo "⚠ 当前 Fabric 使用 cryptogen 模式，跳过 CA TLS 校验"
        return 0
    fi

    if [ "$SKIP_CA_TLS_VERIFY" = true ]; then
        echo "⚠ 已跳过 Fabric CA TLS 校验 (--skip-ca-tls-verify)"
        return 0
    fi

    if ! command -v openssl >/dev/null 2>&1; then
        echo "⚠ 未检测到 openssl，跳过 Fabric CA TLS 校验"
        return 0
    fi

    local orderer_ca="$FABRIC_DIR/organizations/fabric-ca/ordererOrg/ca-cert.pem"
    local org1_ca="$FABRIC_DIR/organizations/fabric-ca/org1/ca-cert.pem"
    local org2_ca="$FABRIC_DIR/organizations/fabric-ca/org2/ca-cert.pem"

    if verify_single_ca_tls_chain "ca_orderer" "9054" "$orderer_ca" && \
       verify_single_ca_tls_chain "ca_org1" "7054" "$org1_ca" && \
       verify_single_ca_tls_chain "ca_org2" "8054" "$org2_ca"; then
        echo "✓ Fabric CA TLS 校验通过"
        return 0
    fi

    echo "⚠ 检测到 Fabric CA TLS 链异常，尝试自动回填 ca-cert.pem..."
    if ! sync_fabric_ca_certs_from_containers; then
        echo "✗ 自动回填 ca-cert.pem 失败"
        return 1
    fi

    if verify_single_ca_tls_chain "ca_orderer" "9054" "$orderer_ca" && \
       verify_single_ca_tls_chain "ca_org1" "7054" "$org1_ca" && \
       verify_single_ca_tls_chain "ca_org2" "8054" "$org2_ca"; then
        echo "✓ Fabric CA TLS 自愈成功"
        return 0
    fi

    return 1
}

# 函数：全局预检
preflight_checks() {
    sanitize_proxy_env
    check_required_paths
    cleanup_stale_relayer_processes

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

    # 验证启动：必须通过 console RPC 读到区块号，避免仅凭 nohup 文案误判成功
    local console_bin="$FISCO_DIR/console/console.sh"
    if "$console_bin" getBlockNumber >/tmp/fisco-start-check.log 2>&1; then
        echo "✓ FISCO-BCOS 启动成功"
    else
        echo "✗ FISCO-BCOS 启动失败"
        cat /tmp/fisco-start-check.log
        exit 1
    fi
    
    cd "$SCRIPT_DIR"
}

# 函数：启动 Fabric
start_fabric() {
    echo ""
    echo "[2/3] 启动 Hyperledger Fabric 网络..."

    fabric_prepare_runtime "$SCRIPT_DIR" "${FABRIC_SAMPLES_SOURCE_DIR:-}" || {
        echo "错误: 未找到可用的 fabric-samples，无法准备可写 Fabric 运行时"
        exit 1
    }
    
    if [ ! -d "$FABRIC_DIR" ]; then
        echo "错误: Fabric 测试网络目录不存在: $FABRIC_DIR"
        exit 1
    fi

    cd "$FABRIC_DIR"

    if [ -d "$FABRIC_BIN_DIR" ]; then
        export PATH="$FABRIC_BIN_DIR:$PATH"
    fi
    if [ -d "$FABRIC_CONFIG_DIR" ]; then
        export FABRIC_CFG_PATH="$FABRIC_CONFIG_DIR"
    fi

    if ! command -v peer >/dev/null 2>&1; then
        echo "错误: 未找到 Fabric peer 二进制，请确认 $FABRIC_BIN_DIR 可用"
        exit 1
    fi

    if ! command -v fabric-ca-client >/dev/null 2>&1; then
        FABRIC_USE_CA=false
        echo "⚠ 未检测到 fabric-ca-client，Fabric 网络将回退到 cryptogen 模式"
    fi

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

    if ! ensure_fabric_ca_tls_ready; then
        echo "⚠ Fabric CA TLS 仍异常，尝试强制重建 Fabric 网络..."
        ./network.sh down >/dev/null 2>&1 || true
        run_fabric_network_up

        if ! ensure_fabric_ca_tls_ready; then
            if command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null && command -v systemctl >/dev/null 2>&1; then
                echo "⚠ 尝试自动重启 Docker daemon..."
                sudo -n systemctl restart docker || true
                sleep 5
                run_fabric_network_up
                ensure_fabric_ca_tls_ready || true
            fi
        fi

        if ! ensure_fabric_ca_tls_ready; then
            echo "✗ Fabric CA TLS 校验持续失败（通常是 WSL 崩溃后的 docker-proxy 端口残留）"
            echo "  请执行："
            echo "    1) ./network.sh down"
            echo "    2) 重启 Docker Desktop（或 sudo systemctl restart docker）"
            echo "    3) 重新运行 start-all.sh"
            exit 1
        fi
    fi

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
    BOOTSTRAP_ARGS="--receive-method receiveLite"

    if [ "$SKIP_FISCO" = true ]; then
        BOOTSTRAP_ARGS="$BOOTSTRAP_ARGS --skip-fisco-contracts"
    else
        BOOTSTRAP_ARGS="$BOOTSTRAP_ARGS --redeploy-fisco"
    fi

    if [ "$REDEPLOY_FABRIC_CC" = true ]; then
        BOOTSTRAP_ARGS="$BOOTSTRAP_ARGS --redeploy-fabric-cc"
    fi
    
    if [ "$SKIP_DEPLOY_CC" = true ]; then
        BOOTSTRAP_ARGS="$BOOTSTRAP_ARGS --skip-fabric-cc"
    fi
    
    # 调用 bootstrap.sh
    FABRIC_SAMPLES_DIR="$FABRIC_SAMPLES_DIR" \
    FABRIC_CRYPTO_PATH="$FABRIC_CRYPTO_PATH" \
    FABRIC_PEER_BIN="$FABRIC_PEER_BIN" \
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
