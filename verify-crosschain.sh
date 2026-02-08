#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RELAYER_DIR="$SCRIPT_DIR/fabric-chaincode/Relayer"
CONFIG_PATH="$RELAYER_DIR/config.json"
FISCO_CONSOLE_DIR="$SCRIPT_DIR/fisco-bcos/console"

LOG_FILE="${RELAYER_LOG:-$HOME/relayer.log}"
FABRIC_TEST_CHANNEL="${VERIFY_FABRIC_CHANNEL:-mychannel}"
SLEEP_SECONDS="${VERIFY_SLEEP_SECONDS:-3}"
WAIT_TIMEOUT="${VERIFY_WAIT_TIMEOUT:-90}"
RELAYER_START_TIMEOUT="${VERIFY_RELAYER_START_TIMEOUT:-90}"
VERIFY_RELAYER_RESTART="${VERIFY_RELAYER_RESTART:-true}"
KEEP_RELAYER="${VERIFY_KEEP_RELAYER:-true}"
PAYLOAD_HEX="${VERIFY_FISCO_PAYLOAD_HEX:-0x48656c6c6f466973636f}"
FISCO_TO_FABRIC_RETRY="${VERIFY_FISCO_TO_FABRIC_RETRY:-3}"
VERIFY_PRESERVE_DEMO_API="${VERIFY_PRESERVE_DEMO_API:-auto}"
VERIFY_DEMO_API_PORT="${VERIFY_DEMO_API_PORT:-18080}"

MANAGED_RELAYER_PID=""
DEMO_API_WAS_RUNNING="false"

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY no_proxy NO_PROXY

require_cmd() {
    if ! command -v "$1" >/dev/null 2>&1; then
        echo "ERROR: missing command: $1"
        exit 1
    fi
}

require_path() {
    local path="$1"
    local label="$2"
    if [[ ! -e "$path" ]]; then
        echo "ERROR: missing ${label}: $path"
        exit 1
    fi
}

is_container_running() {
    local name="$1"
    docker ps --format '{{.Names}}' | grep -qx "$name"
}

extract_fisco_gateway() {
    python3 - "$CONFIG_PATH" <<'PY'
import json
import sys

with open(sys.argv[1], 'r', encoding='utf-8') as file:
    config = json.load(file)

for chain in config.get('chains', []):
    if chain.get('type') == 'FISCO_BCOS':
        print(chain.get('contracts', {}).get('gateway', ''))
        break
PY
}

extract_fisco_receive_method() {
    python3 - "$CONFIG_PATH" <<'PY'
import json
import sys

with open(sys.argv[1], 'r', encoding='utf-8') as file:
    config = json.load(file)

for chain in config.get('chains', []):
    if chain.get('type') == 'FISCO_BCOS':
        print(chain.get('receiveMethod') or 'receiveLite')
        break
PY
}

extract_fabric_gateway_cc_name() {
    python3 - "$CONFIG_PATH" <<'PY'
import json
import sys

with open(sys.argv[1], 'r', encoding='utf-8') as file:
    config = json.load(file)

for chain in config.get('chains', []):
    if chain.get('type') == 'FABRIC':
        print(chain.get('contracts', {}).get('gateway', 'gateway_cc'))
        break
PY
}

wait_for_fisco_rpc() {
    local deadline=$((SECONDS + 30))
    while (( SECONDS <= deadline )); do
        if curl -sS -X POST \
            --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
            -H 'Content-Type: application/json' \
            http://127.0.0.1:8545 | grep -q '"result"'; then
            return 0
        fi
        sleep 2
    done
    return 1
}

find_relayer_pids() {
    local pids
    pids="$(pgrep -f 'node index.js' || true)"
    for pid in $pids; do
        local cwd
        cwd="$(pwdx "$pid" 2>/dev/null | awk '{print $2}' || true)"
        if [[ "$cwd" == "$RELAYER_DIR" ]]; then
            echo "$pid"
        fi
    done
}

stop_relayer_if_needed() {
    local found=false
    while IFS= read -r pid; do
        [[ -z "$pid" ]] && continue
        found=true
        kill "$pid" 2>/dev/null || true
    done < <(find_relayer_pids)

    if [[ "$found" == true ]]; then
        sleep 2
    fi
}

wait_for_relayer_ready() {
    local deadline=$((SECONDS + RELAYER_START_TIMEOUT))
    while (( SECONDS <= deadline )); do
        if [[ -n "$MANAGED_RELAYER_PID" ]] && ! kill -0 "$MANAGED_RELAYER_PID" 2>/dev/null; then
            return 1
        fi
        if grep -aEq 'Relayer service is running|Relay service started successfully' "$LOG_FILE"; then
            return 0
        fi
        sleep 2
    done
    return 1
}

start_managed_relayer() {
    mkdir -p "$(dirname "$LOG_FILE")"
    : > "$LOG_FILE"
    (
        cd "$RELAYER_DIR"
        if [[ "$VERIFY_PRESERVE_DEMO_API" == "true" ]] || \
           [[ "$VERIFY_PRESERVE_DEMO_API" == "auto" && "$DEMO_API_WAS_RUNNING" == "true" ]]; then
            env DEMO_API_ENABLED=true DEMO_API_PORT="$VERIFY_DEMO_API_PORT" \
                node index.js "$CONFIG_PATH" >> "$LOG_FILE" 2>&1
        else
            node index.js "$CONFIG_PATH" >> "$LOG_FILE" 2>&1
        fi
    ) &
    MANAGED_RELAYER_PID=$!

    if ! wait_for_relayer_ready; then
        echo "ERROR: relayer failed to start within ${RELAYER_START_TIMEOUT}s"
        tail -n 120 "$LOG_FILE" || true
        exit 1
    fi
}

cleanup() {
    if [[ "$KEEP_RELAYER" != "true" ]] && [[ -n "$MANAGED_RELAYER_PID" ]]; then
        kill "$MANAGED_RELAYER_PID" 2>/dev/null || true
    fi
}
trap cleanup EXIT

check_log_pattern() {
    local logs="$1"
    local pattern="$2"
    local label="$3"
    if echo "$logs" | grep -aEq "$pattern"; then
        echo "PASS: $label"
        return 0
    fi
    echo "FAIL: $label"
    return 1
}

print_failure_diagnostics() {
    local logs="$1"
    echo "---------------- recent relayer logs ----------------"
    echo "$logs" | tail -n 160
    echo "---------------- docker status ----------------------"
    docker ps --format 'table {{.Names}}\t{{.Status}}' || true
}

send_fisco_to_fabric() {
    local gateway_addr="$1"
    (
        cd "$FISCO_CONSOLE_DIR"
        ./console.sh call GatewayAir "$gateway_addr" send '"FABRIC_NET_01"' '"mychannel/gateway_cc"' '"Receive"' "$PAYLOAD_HEX"
    )
}

echo "========================================="
echo "Cross-chain bidirectional verifier"
echo "LOG_FILE: $LOG_FILE"
echo "WAIT_TIMEOUT: ${WAIT_TIMEOUT}s"
echo "RELAYER_RESTART: $VERIFY_RELAYER_RESTART"
echo "KEEP_RELAYER: $KEEP_RELAYER"
echo "FISCO_TO_FABRIC_RETRY: $FISCO_TO_FABRIC_RETRY"
echo "========================================="

require_cmd docker
require_cmd node
require_cmd python3
require_cmd curl
require_path "$RELAYER_DIR" "Relayer directory"
require_path "$CONFIG_PATH" "Relayer config"
require_path "$FISCO_CONSOLE_DIR/console.sh" "FISCO console"

if curl -fsS --max-time 1 "http://127.0.0.1:${VERIFY_DEMO_API_PORT}/health" >/dev/null 2>&1; then
    DEMO_API_WAS_RUNNING="true"
fi

if ! is_container_running "peer0.org1.example.com" || \
   ! is_container_running "peer0.org2.example.com" || \
   ! is_container_running "orderer.example.com"; then
    echo "ERROR: Fabric core containers are not all running"
    docker ps --format 'table {{.Names}}\t{{.Status}}'
    exit 1
fi

if ! wait_for_fisco_rpc; then
    echo "ERROR: FISCO RPC http://127.0.0.1:8545 is not ready"
    exit 1
fi

if [[ "$VERIFY_RELAYER_RESTART" == "true" ]]; then
    stop_relayer_if_needed
    start_managed_relayer
else
    if ! pgrep -f 'node index.js' >/dev/null 2>&1; then
        start_managed_relayer
    else
        touch "$LOG_FILE"
    fi
fi

start_line="$(wc -l < "$LOG_FILE")"

echo
echo "[1/4] Fabric -> FISCO"
set +e
fabric_output="$(
    cd "$RELAYER_DIR"
    node test-crosschain.js 2>&1
)"
fabric_rc=$?
set -e
echo "$fabric_output"
if [[ $fabric_rc -ne 0 ]]; then
    if echo "$fabric_output" | grep -qi 'No metadata was found for chaincode'; then
        cc_name="$(extract_fabric_gateway_cc_name | tr -d '\r\n')"
        echo "HINT: Fabric chaincode '${cc_name}' is not committed on channel '${FABRIC_TEST_CHANNEL}'"
        echo "      Run deploy first:"
        echo "      cd /home/tr/fabric-samples/test-network"
        echo "      ./network.sh deployCC -c ${FABRIC_TEST_CHANNEL} -ccn ${cc_name} -ccp /home/tr/projects/cross-chain/fabric-chaincode/gateway_cc -ccl javascript -ccv 1.1 -ccs auto"
    fi
    exit 1
fi

sleep "$SLEEP_SECONDS"

echo
echo "[2/4] FISCO -> Fabric"
gateway_addr="$(extract_fisco_gateway | tr -d '\r\n')"
receive_method="$(extract_fisco_receive_method | tr -d '\r\n')"
if [[ -z "$gateway_addr" ]]; then
    echo "ERROR: cannot read FISCO gateway address from config"
    exit 1
fi
echo "Gateway: $gateway_addr"
echo "Receive method: $receive_method"

captured_logs=""
fisco_to_fabric_landed=false
for ((attempt=1; attempt<=FISCO_TO_FABRIC_RETRY; attempt++)); do
    echo "Attempt ${attempt}/${FISCO_TO_FABRIC_RETRY}"
    fisco_output="$(send_fisco_to_fabric "$gateway_addr")"
    echo "$fisco_output"

    if ! echo "$fisco_output" | grep -q "transaction status: 0"; then
        echo "WARN: FISCO send transaction failed on attempt ${attempt}"
        if (( attempt == FISCO_TO_FABRIC_RETRY )); then
            echo "ERROR: FISCO send failed after ${FISCO_TO_FABRIC_RETRY} attempts"
            exit 1
        fi
        sleep "$SLEEP_SECONDS"
        continue
    fi

    sleep "$SLEEP_SECONDS"
    deadline=$((SECONDS + WAIT_TIMEOUT))
    while (( SECONDS <= deadline )); do
        captured_logs="$(tail -n +"$((start_line + 1))" "$LOG_FILE" 2>/dev/null || true)"
        if echo "$captured_logs" | grep -aEq "Fabric transaction success"; then
            fisco_to_fabric_landed=true
            break
        fi
        sleep 2
    done

    if [[ "$fisco_to_fabric_landed" == "true" ]]; then
        break
    fi

    if echo "$captured_logs" | grep -aEq "MVCC_READ_CONFLICT|CommitError.*MVCC|non-sequential"; then
        echo "WARN: detected temporary conflict/non-sequential header submit, retrying FISCO->Fabric..."
    else
        echo "WARN: FISCO->Fabric not landed within timeout, retrying..."
    fi
done

echo
echo "[3/4] Waiting for relay completion"
deadline=$((SECONDS + WAIT_TIMEOUT))
while (( SECONDS <= deadline )); do
    captured_logs="$(tail -n +"$((start_line + 1))" "$LOG_FILE" 2>/dev/null || true)"
    if echo "$captured_logs" | grep -aEq "FISCO transaction SUCCESS" && \
       echo "$captured_logs" | grep -aEq "Fabric transaction success"; then
        break
    fi
    sleep 2
done

echo
echo "[4/4] Validating logs"
failed=0
check_log_pattern "$captured_logs" "Cross-chain event from FABRIC_NET_01" "Fabric event captured" || failed=1
check_log_pattern "$captured_logs" "FISCO transaction SUCCESS" "Fabric -> FISCO landed" || failed=1
check_log_pattern "$captured_logs" "Cross-chain event from FISCO_NET_01" "FISCO event captured" || failed=1
check_log_pattern "$captured_logs" "Fabric transaction success" "FISCO -> Fabric landed" || failed=1

if echo "$captured_logs" | grep -aEq "Abi is empty|Failed to relay|Source block not verified|GatewayError|EndorseError"; then
    echo "FAIL: error patterns found in relayer logs"
    failed=1
else
    echo "PASS: no fatal error pattern in relayer logs"
fi

if [[ "$failed" -ne 0 ]]; then
    echo
    echo "========================================="
    echo "RESULT: FAILED"
    echo "========================================="
    print_failure_diagnostics "$captured_logs"
    exit 1
fi

echo
echo "========================================="
echo "RESULT: PASS"
echo "Fabric <-> FISCO bidirectional relay OK"
echo "========================================="
