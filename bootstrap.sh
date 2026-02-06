#!/bin/bash

# bootstrap.sh - 自动部署 FISCO 合约和 Fabric Chaincode
# 功能：
#   1. 部署 FISCO 合约 (ChainRegistryAir, LightClientAir, GatewayAir)
#   2. 部署 Fabric Chaincode (gateway_cc)
#   3. 自动更新 fabric-chaincode/Relayer/config.json

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONSOLE_DIR="$SCRIPT_DIR/fisco-bcos/console"
FABRIC_SAMPLES_DIR="${FABRIC_SAMPLES_DIR:-/home/tr/fabric-samples}"
FABRIC_DIR="$FABRIC_SAMPLES_DIR/test-network"
RELAYER_DIR="$SCRIPT_DIR/fabric-chaincode/Relayer"
RELAYER_CONFIG="$RELAYER_DIR/config.json"

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

# 默认参数
REDEPLOY_FISCO=false
RECEIVE_METHOD="receiveLite"
SKIP_FABRIC_CC=false
SKIP_FISCO_CONTRACTS=false

# 解析命令行参数
while [[ $# -gt 0 ]]; do
    case $1 in
        --redeploy-fisco)
            REDEPLOY_FISCO=true
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
echo "RECEIVE_METHOD: $RECEIVE_METHOD"
echo "SKIP_FABRIC_CC: $SKIP_FABRIC_CC"
echo "SKIP_FISCO_CONTRACTS: $SKIP_FISCO_CONTRACTS"
echo "========================================="

# 函数：部署 FISCO 合约
deploy_fisco_contracts() {
    echo ""
    echo "[1/3] 部署 FISCO 合约..."
    cd "$CONSOLE_DIR"

    # 检查合约是否已部署
    if [ "$REDEPLOY_FISCO" = false ]; then
        EXISTING_REGISTRY=$(jq -r '.fisco.contracts.chainRegistry' "$RELAYER_CONFIG" 2>/dev/null || echo "")
        EXISTING_LIGHTCLIENT=$(jq -r '.fisco.contracts.lightClient' "$RELAYER_CONFIG" 2>/dev/null || echo "")
        EXISTING_GATEWAY=$(jq -r '.fisco.contracts.gateway' "$RELAYER_CONFIG" 2>/dev/null || echo "")

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
    GATEWAY_OUTPUT=$(./console.sh deploy GatewayAir "$REGISTRY_ADDR" "$LIGHTCLIENT_ADDR" 2>&1)
    GATEWAY_ADDR=$(extract_contract_address "$GATEWAY_OUTPUT")
    if [[ -z "$GATEWAY_ADDR" ]]; then
        echo "错误: 无法获取 GatewayAir 地址" >&2
        echo "输出: $GATEWAY_OUTPUT" >&2
        exit 1
    fi
    echo "$GATEWAY_ADDR"
    echo "✓ GatewayAir 部署成功: $GATEWAY_ADDR" >&2

    # 更新 config.json
    echo "更新 config.json..." >&2
    python3 - <<EOF
import json
import sys

config_path = "$RELAYER_CONFIG"
with open(config_path, 'r') as f:
    config = json.load(f)

def update_fisco_section(fisco_cfg):
    if 'contracts' not in fisco_cfg:
        fisco_cfg['contracts'] = {}
    # 同时兼容旧字段名
    fisco_cfg['contracts']['chainRegistry'] = "$REGISTRY_ADDR"
    fisco_cfg['contracts']['registry'] = "$REGISTRY_ADDR"
    fisco_cfg['contracts']['lightClient'] = "$LIGHTCLIENT_ADDR"
    fisco_cfg['contracts']['gateway'] = "$GATEWAY_ADDR"
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

print(f"✓ config.json 已更新", file=sys.stderr)
EOF

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
    cd "$FABRIC_DIR"

    # 检查 chaincode 是否已部署
    EXISTING_CC=$(./network.sh queryCommitted mychannel 2>/dev/null | grep "gateway_cc" || echo "")
    if [[ -n "$EXISTING_CC" ]]; then
        echo "✓ Fabric Chaincode 已部署，跳过部署"
        echo "$EXISTING_CC"
        return
    fi

    echo "开始部署 Fabric Chaincode..."

    # 打包和部署 chaincode
    echo "[1/1] 部署 gateway_cc..."
    ./network.sh deployCC -ccn gateway_cc -ccp "$SCRIPT_DIR/fabric-chaincode/gateway_cc" -ccl javascript

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
