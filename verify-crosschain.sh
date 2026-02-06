#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RELAYER_DIR="$SCRIPT_DIR/fabric-chaincode/Relayer"
CONFIG_PATH="$RELAYER_DIR/config.json"
FISCO_CONSOLE_DIR="$SCRIPT_DIR/fisco-bcos/console"
LOG_FILE="${RELAYER_LOG:-$HOME/relayer.log}"
SLEEP_SECONDS="${VERIFY_SLEEP_SECONDS:-6}"
WAIT_TIMEOUT="${VERIFY_WAIT_TIMEOUT:-45}"
PAYLOAD_HEX="${VERIFY_FISCO_PAYLOAD_HEX:-0x48656c6c6f466973636f}"

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY no_proxy NO_PROXY

require_path() {
    local path="$1"
    local name="$2"
    if [[ ! -e "$path" ]]; then
        echo "✗ 缺少${name}: $path"
        exit 1
    fi
}

extract_gateway_address() {
    python3 - "$CONFIG_PATH" <<'PY'
import json
import sys

config_path = sys.argv[1]
with open(config_path, 'r', encoding='utf-8') as file:
    config = json.load(file)

for chain in config.get('chains', []):
    if chain.get('type') == 'FISCO_BCOS':
        print(chain.get('contracts', {}).get('gateway', ''))
        break
PY
}

check_log_pattern() {
    local logs="$1"
    local pattern="$2"
    local label="$3"

    if echo "$logs" | grep -aEq "$pattern"; then
        echo "✓ $label"
        return 0
    fi

    echo "✗ $label"
    return 1
}

echo "========================================="
echo "跨链双向验收脚本"
echo "日志文件: $LOG_FILE"
echo "========================================="

require_path "$RELAYER_DIR" "Relayer 目录"
require_path "$CONFIG_PATH" "Relayer 配置"
require_path "$FISCO_CONSOLE_DIR/console.sh" "FISCO console.sh"
require_path "$LOG_FILE" "Relayer 日志"

if ! pgrep -af "node index.js" >/dev/null 2>&1; then
    echo "✗ 未检测到运行中的 Relayer 进程"
    echo "请先执行: cd $RELAYER_DIR && npm start | tee $LOG_FILE"
    exit 1
fi

start_line=$(wc -l < "$LOG_FILE")

echo
echo "[1/4] 执行 Fabric -> FISCO 测试"
(
    cd "$RELAYER_DIR"
    node test-crosschain.js
)

sleep "$SLEEP_SECONDS"

gateway_addr="$(extract_gateway_address | tr -d '\r\n')"
if [[ -z "$gateway_addr" ]]; then
    echo "✗ 无法从 config.json 读取 FISCO gateway 地址"
    exit 1
fi

echo
echo "[2/4] 执行 FISCO -> Fabric 测试"
echo "使用 Gateway 地址: $gateway_addr"
fisco_output="$(
    cd "$FISCO_CONSOLE_DIR"
    ./console.sh call GatewayAir "$gateway_addr" send '"FABRIC_NET_01"' '"mychannel/gateway_cc"' '"Receive"' "$PAYLOAD_HEX"
)"
echo "$fisco_output"

if ! echo "$fisco_output" | grep -q "transaction status: 0"; then
    echo "✗ FISCO->Fabric 发起交易失败（transaction status != 0）"
    exit 1
fi

sleep "$SLEEP_SECONDS"

echo
echo "[3/4] 等待 Relayer 完成双向转发"
deadline=$((SECONDS + WAIT_TIMEOUT))
captured_logs=""
while (( SECONDS <= deadline )); do
    captured_logs="$(tail -n +"$((start_line + 1))" "$LOG_FILE" 2>/dev/null || true)"

    if echo "$captured_logs" | grep -aEq "FISCO transaction SUCCESS" &&
       echo "$captured_logs" | grep -aEq "Fabric transaction success"; then
        break
    fi

    sleep 2
done

echo
echo "[4/4] 校验关键日志"
failed=0

check_log_pattern "$captured_logs" "Cross-chain event from FABRIC_NET_01" "已捕获 Fabric -> FISCO 事件" || failed=1
check_log_pattern "$captured_logs" "FISCO transaction SUCCESS" "Fabric -> FISCO 已落地" || failed=1
check_log_pattern "$captured_logs" "Cross-chain event from FISCO_NET_01" "已捕获 FISCO -> Fabric 事件" || failed=1
check_log_pattern "$captured_logs" "Fabric transaction success" "FISCO -> Fabric 已落地" || failed=1

if echo "$captured_logs" | grep -aEq "Abi is empty|Failed to relay"; then
    echo "✗ 发现异常日志: Abi is empty 或 Failed to relay"
    failed=1
else
    echo "✓ 未发现 Abi is empty / Failed to relay"
fi

if [[ "$failed" -ne 0 ]]; then
    echo
    echo "========================================="
    echo "验收结果: FAILED"
    echo "最近相关日志:"
    echo "-----------------------------------------"
    echo "$captured_logs" | tail -120
    echo "========================================="
    exit 1
fi

echo
echo "========================================="
echo "验收结果: PASS"
echo "Fabric <-> FISCO 双向链路正常"
echo "========================================="
