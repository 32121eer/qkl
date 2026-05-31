#!/bin/bash

# bootstrap.sh - 自动部署 FISCO 合约和 Fabric Chaincode
# 功能：
#   1. 部署 FISCO 合约 (ChainRegistryAir, LightClientAir, GatewayAir)
#   2. 部署 Fabric Chaincode (gateway_cc)
#   3. 自动更新 fabric-chaincode/Relayer/config.json

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONSOLE_DIR="$SCRIPT_DIR/fisco-bcos/console"
RELAYER_DIR="$SCRIPT_DIR/fabric-chaincode/Relayer"
RELAYER_CONFIG="$RELAYER_DIR/config.json"
FABRIC_RUNTIME_HELPER="$SCRIPT_DIR/scripts/fabric-runtime.sh"
GATEWAY_AIR_SOURCE_PATH="contracts/solidity/GatewayAir.sol"
GATEWAY_AIR_DEPLOY_SCRIPT="$SCRIPT_DIR/scripts/deploy_gatewayair_rpc.js"

if [ ! -f "$FABRIC_RUNTIME_HELPER" ]; then
    echo "错误: Fabric 运行时助手不存在: $FABRIC_RUNTIME_HELPER"
    exit 1
fi
# shellcheck disable=SC1090
source "$FABRIC_RUNTIME_HELPER"

FABRIC_SAMPLES_SOURCE_DIR="$(fabric_detect_source_samples_dir || true)"
if [[ -n "$FABRIC_SAMPLES_SOURCE_DIR" ]]; then
    fabric_prepare_runtime "$SCRIPT_DIR" "$FABRIC_SAMPLES_SOURCE_DIR" || true
fi

extract_contract_address() {
    local deploy_output="$1"
    local addr=""

    # 优先解析 console 标准输出中的 contract address 行
    addr=$(echo "$deploy_output" | sed -nE 's/.*contract address:[[:space:]]*(0x[0-9a-fA-F]{40}).*/\1/p' | tail -1)

    # 兜底：取输出中最后一个 0x 地址（避免把构造参数地址误当成部署地址）
    if [[ -z "$addr" ]]; then
        addr=$(echo "$deploy_output" | grep -oE '0x[0-9a-fA-F]{40}' | tail -1)
    fi

    echo "$addr"
}

query_committed_gateway_chaincode() {
    local channel_name="$1"
    (
        set +e
        cd "$FABRIC_DIR" || exit 1
        export TEST_NETWORK_HOME="$FABRIC_DIR"
        export FABRIC_CFG_PATH="$FABRIC_DIR/../config"
        # shellcheck disable=SC1091
        . "$FABRIC_DIR/scripts/envVar.sh" >/dev/null 2>&1 || exit 1
        setGlobals 1 >/dev/null 2>&1 || exit 1
        peer lifecycle chaincode querycommitted --channelID "$channel_name" --name gateway_cc 2>/dev/null || true
    )
}

extract_committed_chaincode_version() {
    local committed_output="$1"
    echo "$committed_output" | sed -nE "s/^Version:[[:space:]]*([^,]+),.*/\1/p" | head -n 1
}

# 默认参数
REDEPLOY_FISCO=false
UPGRADE_FISCO_GATEWAY=false
RECEIVE_METHOD="receiveLite"
REDEPLOY_FABRIC_CC=false
SKIP_FABRIC_CC=false
SKIP_FISCO_CONTRACTS=false

# 解析命令行参数
while [[ $# -gt 0 ]]; do
    case $1 in
        --redeploy-fisco)
            REDEPLOY_FISCO=true
            shift
            ;;
        --upgrade-fisco-gateway)
            UPGRADE_FISCO_GATEWAY=true
            shift
            ;;
        --redeploy-fabric-cc)
            REDEPLOY_FABRIC_CC=true
            shift
            ;;
        --receive-method)
            RECEIVE_METHOD="$2"
            shift 2
            ;;
        --skip-fabric-cc)
            SKIP_FABRIC_CC=true
            shift
            ;;
        --skip-fisco-contracts)
            SKIP_FISCO_CONTRACTS=true
            shift
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

echo "========================================="
echo "Bootstrap Script - 自动部署合约"
echo "========================================="
echo "REDEPLOY_FISCO: $REDEPLOY_FISCO"
echo "UPGRADE_FISCO_GATEWAY: $UPGRADE_FISCO_GATEWAY"
echo "RECEIVE_METHOD: $RECEIVE_METHOD"
echo "REDEPLOY_FABRIC_CC: $REDEPLOY_FABRIC_CC"
echo "SKIP_FABRIC_CC: $SKIP_FABRIC_CC"
echo "SKIP_FISCO_CONTRACTS: $SKIP_FISCO_CONTRACTS"
echo "FABRIC_SAMPLES_DIR: ${FABRIC_SAMPLES_DIR:-<not-found>}"
echo "FABRIC_SAMPLES_SOURCE_DIR: ${FABRIC_SAMPLES_SOURCE_DIR:-<not-found>}"
echo "========================================="

read_config_value() {
    local jq_expr="$1"
    local py_expr="$2"

    if command -v jq >/dev/null 2>&1; then
        jq -r "$jq_expr // \"\"" "$RELAYER_CONFIG" 2>/dev/null || echo ""
        return
    fi

    python3 - <<PY 2>/dev/null || echo ""
import json

with open("$RELAYER_CONFIG", "r") as f:
    config = json.load(f)

try:
    value = $py_expr
except Exception:
    value = ""

if value is None:
    value = ""
print(value)
PY
}

get_existing_fisco_addresses() {
    EXISTING_REGISTRY=$(read_config_value '.fisco.contracts.chainRegistry' 'config.get("fisco", {}).get("contracts", {}).get("chainRegistry", "")')
    if [[ -z "$EXISTING_REGISTRY" || "$EXISTING_REGISTRY" == "null" ]]; then
        EXISTING_REGISTRY=$(read_config_value '.chains[]? | select(.type=="FISCO_BCOS") | .contracts.chainRegistry' 'next((c.get("contracts", {}).get("chainRegistry", "") for c in config.get("chains", []) if c.get("type") == "FISCO_BCOS"), "")')
    fi

    EXISTING_LIGHTCLIENT=$(read_config_value '.fisco.contracts.lightClient' 'config.get("fisco", {}).get("contracts", {}).get("lightClient", "")')
    if [[ -z "$EXISTING_LIGHTCLIENT" || "$EXISTING_LIGHTCLIENT" == "null" ]]; then
        EXISTING_LIGHTCLIENT=$(read_config_value '.chains[]? | select(.type=="FISCO_BCOS") | .contracts.lightClient' 'next((c.get("contracts", {}).get("lightClient", "") for c in config.get("chains", []) if c.get("type") == "FISCO_BCOS"), "")')
    fi

    EXISTING_GATEWAY=$(read_config_value '.fisco.contracts.gateway' 'config.get("fisco", {}).get("contracts", {}).get("gateway", "")')
    if [[ -z "$EXISTING_GATEWAY" || "$EXISTING_GATEWAY" == "null" ]]; then
        EXISTING_GATEWAY=$(read_config_value '.chains[]? | select(.type=="FISCO_BCOS") | .contracts.gateway' 'next((c.get("contracts", {}).get("gateway", "") for c in config.get("chains", []) if c.get("type") == "FISCO_BCOS"), "")')
    fi
}

update_relayer_fisco_config() {
    local registry_addr="$1"
    local lightclient_addr="$2"
    local gateway_addr="$3"

    python3 - <<EOF
import json
import sys

config_path = "$RELAYER_CONFIG"
with open(config_path, 'r') as f:
    config = json.load(f)

def update_fisco_section(fisco_cfg):
    if 'contracts' not in fisco_cfg:
        fisco_cfg['contracts'] = {}
    if "$registry_addr":
        fisco_cfg['contracts']['chainRegistry'] = "$registry_addr"
        fisco_cfg['contracts']['registry'] = "$registry_addr"
    if "$lightclient_addr":
        fisco_cfg['contracts']['lightClient'] = "$lightclient_addr"
    if "$gateway_addr":
        fisco_cfg['contracts']['gateway'] = "$gateway_addr"
    fisco_cfg['receiveMethod'] = "$RECEIVE_METHOD"

if 'fisco' in config:
    update_fisco_section(config['fisco'])
elif 'chains' in config:
    updated = False
    for chain in config['chains']:
        if chain.get('type') == 'FISCO_BCOS':
            update_fisco_section(chain)
            updated = True
            break
    if not updated:
        print("错误: config.json 中未找到 FISCO_BCOS 链配置", file=sys.stderr)
        sys.exit(1)
else:
    print("错误: config.json 格式不支持", file=sys.stderr)
    sys.exit(1)

with open(config_path, 'w') as f:
    json.dump(config, f, indent=2)

print("✓ config.json 已更新", file=sys.stderr)
EOF
}

# 函数：部署 FISCO 合约
deploy_fisco_contracts() {
    echo ""
    echo "[1/3] 部署 FISCO 合约..."
    cd "$CONSOLE_DIR"

    # 检查合约是否已部署
    get_existing_fisco_addresses

    if [ "$UPGRADE_FISCO_GATEWAY" = true ]; then
        if [[ -z "$EXISTING_REGISTRY" || "$EXISTING_REGISTRY" == "null" || "$EXISTING_REGISTRY" == "0x0000000000000000000000000000000000000000" ]]; then
            echo "错误: --upgrade-fisco-gateway 需要现有 ChainRegistryAir 地址"
            exit 1
        fi
        if [[ -z "$EXISTING_LIGHTCLIENT" || "$EXISTING_LIGHTCLIENT" == "null" || "$EXISTING_LIGHTCLIENT" == "0x0000000000000000000000000000000000000000" ]]; then
            echo "错误: --upgrade-fisco-gateway 需要现有 LightClientAir 地址"
            exit 1
        fi

        echo "检测到 Gateway 单独升级模式，复用现有依赖："
        echo "  ChainRegistry: $EXISTING_REGISTRY"
        echo "  LightClient:   $EXISTING_LIGHTCLIENT"
        if [[ -n "$EXISTING_GATEWAY" && "$EXISTING_GATEWAY" != "null" ]]; then
            echo "  Old Gateway:   $EXISTING_GATEWAY"
        fi

        echo "[1/1] 部署新的 GatewayAir..." >&2
        GATEWAY_OUTPUT=$(node "$GATEWAY_AIR_DEPLOY_SCRIPT" "$EXISTING_REGISTRY" "$EXISTING_LIGHTCLIENT" 2>&1)
        GATEWAY_ADDR=$(python3 - <<EOF
import json
import sys
text = """$GATEWAY_OUTPUT""".strip()
try:
    print(json.loads(text)["contractAddress"])
except Exception:
    print("")
EOF
)
        if [[ -z "$GATEWAY_ADDR" ]]; then
            echo "错误: 无法获取新 GatewayAir 地址" >&2
            echo "输出: $GATEWAY_OUTPUT" >&2
            exit 1
        fi

        update_relayer_fisco_config "$EXISTING_REGISTRY" "$EXISTING_LIGHTCLIENT" "$GATEWAY_ADDR"

        echo ""
        echo "========================================="
        echo "GatewayAir 升级完成！"
        echo "========================================="
        echo "ChainRegistry: $EXISTING_REGISTRY"
        echo "LightClient:   $EXISTING_LIGHTCLIENT"
        echo "Old Gateway:   ${EXISTING_GATEWAY:-<unknown>}"
        echo "New Gateway:   $GATEWAY_ADDR"
        echo "receiveMethod: $RECEIVE_METHOD"
        echo "========================================="
        return
    fi

    if [ "$REDEPLOY_FISCO" = false ]; then

        if [[ -n "$EXISTING_REGISTRY" && "$EXISTING_REGISTRY" != "null" && "$EXISTING_REGISTRY" != "0x0000000000000000000000000000000000000000" ]] && \
           [[ -n "$EXISTING_LIGHTCLIENT" && "$EXISTING_LIGHTCLIENT" != "null" && "$EXISTING_LIGHTCLIENT" != "0x0000000000000000000000000000000000000000" ]] && \
           [[ -n "$EXISTING_GATEWAY" && "$EXISTING_GATEWAY" != "null" && "$EXISTING_GATEWAY" != "0x0000000000000000000000000000000000000000" ]]; then
            echo "✓ FISCO 合约已部署，跳过部署"
            echo "  ChainRegistry: $EXISTING_REGISTRY"
            echo "  LightClient:   $EXISTING_LIGHTCLIENT"
            echo "  Gateway:       $EXISTING_GATEWAY"
            return
        fi
    fi

    echo "开始部署 FISCO 合约..."

    # 1. 部署 ChainRegistryAir
    echo "[1/3] 部署 ChainRegistryAir..." >&2
    REGISTRY_OUTPUT=$(./console.sh deploy ChainRegistryAir 2>&1)
    REGISTRY_ADDR=$(extract_contract_address "$REGISTRY_OUTPUT")
    if [[ -z "$REGISTRY_ADDR" ]]; then
        echo "错误: 无法获取 ChainRegistryAir 地址" >&2
        echo "输出: $REGISTRY_OUTPUT" >&2
        exit 1
    fi
    echo "$REGISTRY_ADDR"
    echo "✓ ChainRegistryAir 部署成功: $REGISTRY_ADDR" >&2

    # 2. 部署 LightClientAir（需要 ChainRegistry 地址作为参数）
    echo "[2/3] 部署 LightClientAir..." >&2
    LIGHTCLIENT_OUTPUT=$(./console.sh deploy LightClientAir "$REGISTRY_ADDR" 2>&1)
    LIGHTCLIENT_ADDR=$(extract_contract_address "$LIGHTCLIENT_OUTPUT")
    if [[ -z "$LIGHTCLIENT_ADDR" ]]; then
        echo "错误: 无法获取 LightClientAir 地址" >&2
        echo "输出: $LIGHTCLIENT_OUTPUT" >&2
        exit 1
    fi
    echo "$LIGHTCLIENT_ADDR"
    echo "✓ LightClientAir 部署成功: $LIGHTCLIENT_ADDR" >&2

    # 3. 部署 GatewayAir
    echo "[3/3] 部署 GatewayAir..." >&2
    GATEWAY_OUTPUT=$(node "$GATEWAY_AIR_DEPLOY_SCRIPT" "$REGISTRY_ADDR" "$LIGHTCLIENT_ADDR" 2>&1)
    GATEWAY_ADDR=$(python3 - <<EOF
import json
import sys
text = """$GATEWAY_OUTPUT""".strip()
try:
    print(json.loads(text)["contractAddress"])
except Exception:
    print("")
EOF
)
    if [[ -z "$GATEWAY_ADDR" ]]; then
        echo "错误: 无法获取 GatewayAir 地址" >&2
        echo "输出: $GATEWAY_OUTPUT" >&2
        exit 1
    fi
    echo "$GATEWAY_ADDR"
    echo "✓ GatewayAir 部署成功: $GATEWAY_ADDR" >&2

    # 更新 config.json
    echo "更新 config.json..." >&2
    update_relayer_fisco_config "$REGISTRY_ADDR" "$LIGHTCLIENT_ADDR" "$GATEWAY_ADDR"

    # 4. 注册链到 ChainRegistryAir
    echo "" >&2
    echo "注册链到 ChainRegistryAir..." >&2

    # 注册 FABRIC_NET_01
    echo "  注册 FABRIC_NET_01..." >&2
    REG_FABRIC_OUTPUT=$(./console.sh call ChainRegistryAir "$REGISTRY_ADDR" registerChain '"FABRIC_NET_01"' '"ACTIVE"' '"FABRIC"' '"RAFT"' '"localhost:7051"' '"fabric-pub-key"' '"fabric-ca-key"' 2>&1 || true)
    if echo "$REG_FABRIC_OUTPUT" | grep -q "Already registered"; then
        echo "  ✓ FABRIC_NET_01 已注册（跳过）" >&2
    elif echo "$REG_FABRIC_OUTPUT" | grep -q "transaction status: 0"; then
        echo "  ✓ FABRIC_NET_01 注册成功" >&2
    else
        echo "  ⚠ FABRIC_NET_01 注册结果: $REG_FABRIC_OUTPUT" >&2
    fi

    # 注册 FISCO_NET_01
    echo "  注册 FISCO_NET_01..." >&2
    REG_FISCO_OUTPUT=$(./console.sh call ChainRegistryAir "$REGISTRY_ADDR" registerChain '"FISCO_NET_01"' '"ACTIVE"' '"FISCO_BCOS"' '"PBFT"' '"127.0.0.1:8545"' '"fisco-pub-key"' '"fisco-ca-key"' 2>&1 || true)
    if echo "$REG_FISCO_OUTPUT" | grep -q "Already registered"; then
        echo "  ✓ FISCO_NET_01 已注册（跳过）" >&2
    elif echo "$REG_FISCO_OUTPUT" | grep -q "transaction status: 0"; then
        echo "  ✓ FISCO_NET_01 注册成功" >&2
    else
        echo "  ⚠ FISCO_NET_01 注册结果: $REG_FISCO_OUTPUT" >&2
    fi

    echo ""
    echo "========================================="
    echo "FISCO 合约部署完成！"
    echo "========================================="
    echo "ChainRegistry: $REGISTRY_ADDR"
    echo "LightClient:   $LIGHTCLIENT_ADDR"
    echo "Gateway:       $GATEWAY_ADDR"
    echo "receiveMethod: $RECEIVE_METHOD"
    echo "========================================="
}

# 函数：部署 Fabric Chaincode
deploy_fabric_chaincode() {
    echo ""
    echo "[2/3] 部署 Fabric Chaincode..."
    fabric_prepare_runtime "$SCRIPT_DIR" "${FABRIC_SAMPLES_SOURCE_DIR:-}" || {
        echo "错误: 未找到可用的 fabric-samples，无法准备可写 Fabric 运行时"
        exit 1
    }
    if [ -z "$FABRIC_SAMPLES_DIR" ] || [ ! -d "$FABRIC_DIR" ]; then
        echo "错误: 未找到可用的 fabric-samples/test-network"
        echo "请设置 FABRIC_SAMPLES_DIR，例如：export FABRIC_SAMPLES_DIR=/mnt/fast18/xunuo/czs/fabric-samples"
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

    local channel_name="${FABRIC_CHANNEL_NAME:-mychannel}"

    local desired_cc_version="${FABRIC_CC_VERSION:-1.1}"

    # 检查 chaincode 是否已部署
    EXISTING_CC="$(query_committed_gateway_chaincode "$channel_name")"
    local existing_cc_version=""
    if [[ -n "$EXISTING_CC" ]]; then
        existing_cc_version="$(extract_committed_chaincode_version "$EXISTING_CC")"
    fi

    if [[ -n "$EXISTING_CC" && "$REDEPLOY_FABRIC_CC" = false && "$existing_cc_version" = "$desired_cc_version" ]]; then
        echo "✓ Fabric Chaincode 已部署，跳过部署"
        echo "$EXISTING_CC"
        return
    fi

    if [[ -n "$EXISTING_CC" && "$REDEPLOY_FABRIC_CC" = false && "$existing_cc_version" != "$desired_cc_version" ]]; then
        echo "⚠ 检测到已部署的 gateway_cc 版本为 ${existing_cc_version:-unknown}，目标版本为 $desired_cc_version，执行自动升级"
        echo "$EXISTING_CC"
    fi

    echo "开始部署 Fabric Chaincode..."

    # 打包和部署 chaincode
    echo "[1/1] 部署 gateway_cc..."
    local cc_version="$desired_cc_version"
    local cc_sequence="${FABRIC_CC_SEQUENCE:-auto}"

    ./network.sh deployCC -ccn gateway_cc -ccp "$SCRIPT_DIR/fabric-chaincode/gateway_cc" -ccl javascript -ccv "$cc_version" -ccs "$cc_sequence"

    echo ""
    echo "========================================="
    echo "Fabric Chaincode 部署完成！"
    echo "========================================="
}

# 主流程
main() {
    # 检查 config.json 是否存在
    if [ ! -f "$RELAYER_CONFIG" ]; then
        echo "错误: config.json 不存在: $RELAYER_CONFIG"
        exit 1
    fi

    if [ "$UPGRADE_FISCO_GATEWAY" = true ] && [ "$SKIP_FABRIC_CC" = false ]; then
        echo "检测到 --upgrade-fisco-gateway，自动跳过 Fabric Chaincode 部署"
        SKIP_FABRIC_CC=true
    fi

    if [ "$SKIP_FABRIC_CC" = false ] && [ -z "$FABRIC_SAMPLES_DIR" ]; then
        echo "错误: 未找到可用的 fabric-samples"
        echo "请设置 FABRIC_SAMPLES_DIR，例如：export FABRIC_SAMPLES_DIR=/mnt/fast18/xunuo/czs/fabric-samples"
        exit 1
    fi

    # 部署 FISCO 合约
    if [ "$SKIP_FISCO_CONTRACTS" = false ]; then
        deploy_fisco_contracts
    else
        echo "[1/3] 跳过 FISCO 合约部署"
    fi

    # 部署 Fabric Chaincode
    if [ "$SKIP_FABRIC_CC" = false ]; then
        deploy_fabric_chaincode
    else
        echo "[2/3] 跳过 Fabric Chaincode 部署"
    fi

    echo ""
    echo "========================================="
    echo "✓ 所有部署完成！"
    echo "========================================="
    echo "下一步："
    echo "  1. cd fabric-chaincode/Relayer"
    echo "  2. npm start | tee ~/relayer.log"
    echo "========================================="
}

# 执行主流程
main
