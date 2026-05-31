#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RELAYER_DIR="$ROOT_DIR/fabric-chaincode/Relayer"
UI_DIR="$ROOT_DIR/demo-ui"
RUN_DIR="$ROOT_DIR/.demo"
PID_FILE="$RUN_DIR/demo.pids"
API_LOG="$RUN_DIR/demo-api.log"
UI_LOG="$RUN_DIR/demo-ui.log"
RPC_ADAPTER_LOG="$RUN_DIR/fisco-rpc-compat.log"
FABRIC_RUNTIME_HELPER="$ROOT_DIR/scripts/fabric-runtime.sh"
FISCO_CONSOLE_DIR_DEFAULT="$ROOT_DIR/fabric-chaincode/fisco-bcos/console"

API_HOST="${DEMO_API_HOST:-0.0.0.0}"
API_PORT="${DEMO_API_PORT:-18080}"
UI_HOST="${DEMO_UI_HOST:-0.0.0.0}"
UI_PORT="${DEMO_UI_PORT:-15173}"

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY no_proxy NO_PROXY

mkdir -p "$RUN_DIR"

if [[ -f "$FABRIC_RUNTIME_HELPER" ]]; then
    # shellcheck disable=SC1090
    source "$FABRIC_RUNTIME_HELPER"
    FABRIC_SAMPLES_SOURCE_DIR="$(fabric_detect_source_samples_dir || true)"
    if [[ -n "$FABRIC_SAMPLES_SOURCE_DIR" ]]; then
        fabric_prepare_runtime "$ROOT_DIR" "$FABRIC_SAMPLES_SOURCE_DIR" || true
    fi
fi

require_cmd() {
    if ! command -v "$1" >/dev/null 2>&1; then
        echo "ERROR: missing command: $1"
        exit 1
    fi
}

is_pid_alive() {
    local pid="$1"
    [[ -n "$pid" ]] && kill -0 "$pid" >/dev/null 2>&1
}

stop_pid_gracefully() {
    local pid="$1"
    local label="$2"
    if ! is_pid_alive "$pid"; then
        return
    fi

    kill "$pid" >/dev/null 2>&1 || true
    for _ in {1..8}; do
        if ! is_pid_alive "$pid"; then
            break
        fi
        sleep 1
    done

    if is_pid_alive "$pid"; then
        kill -9 "$pid" >/dev/null 2>&1 || true
    fi
    echo "Stopped ${label} (pid=${pid})"
}

jsonrpc_post_ok() {
    local url="$1"
    local payload="$2"
    curl -sS -m 2 -X POST -H 'content-type: application/json' --data "$payload" "$url" >/dev/null 2>&1
}

load_existing_pids() {
    API_PID=""
    UI_PID=""
    RPC_ADAPTER_PID=""
    if [[ -f "$PID_FILE" ]]; then
        # shellcheck disable=SC1090
        source "$PID_FILE" || true
    fi
}

cleanup_existing_demo_processes() {
    load_existing_pids

    # 1) stop processes recorded by previous run
    stop_pid_gracefully "${API_PID:-}" "demo-api"
    stop_pid_gracefully "${UI_PID:-}" "demo-ui"
    stop_pid_gracefully "${RPC_ADAPTER_PID:-}" "fisco-rpc-compat"

    # 2) stop stale processes that may not be in pid file
    while IFS= read -r pid; do
        [[ -z "$pid" ]] && continue
        [[ "$pid" == "$$" ]] && continue

        local cwd cmdline
        cwd="$(readlink -f "/proc/${pid}/cwd" 2>/dev/null || true)"
        cmdline="$(tr '\0' ' ' < "/proc/${pid}/cmdline" 2>/dev/null || true)"
        [[ -z "$cmdline" ]] && continue

        if [[ "$cwd" == "$RELAYER_DIR" ]] && [[ "$cmdline" == *"node index.js"* ]]; then
            stop_pid_gracefully "$pid" "stale-demo-api"
            continue
        fi

        if [[ "$cwd" == "$UI_DIR" ]] && { [[ "$cmdline" == *"vite"* ]] || [[ "$cmdline" == *"npm run dev"* ]]; }; then
            stop_pid_gracefully "$pid" "stale-demo-ui"
            continue
        fi
        if [[ "$cmdline" == *"node "* ]] && [[ "$cmdline" == *"scripts/fisco-rpc-compat.js"* ]]; then
            stop_pid_gracefully "$pid" "stale-fisco-rpc-compat"
            continue
        fi
    done < <(pgrep -f 'node index.js|vite|npm run dev|scripts/fisco-rpc-compat.js' || true)

    rm -f "$PID_FILE"
}

wait_http_ready() {
    local url="$1"
    local timeout="$2"
    local deadline=$((SECONDS + timeout))
    while (( SECONDS <= deadline )); do
        if curl -sS "$url" >/dev/null 2>&1; then
            return 0
        fi
        sleep 1
    done
    return 1
}

check_fisco_console_ready() {
    local console_bin="${FISCO_CONSOLE_DIR:-$FISCO_CONSOLE_DIR_DEFAULT}/console.sh"
    if [[ ! -x "$console_bin" ]]; then
        echo "ERROR: FISCO console is missing: $console_bin"
        exit 1
    fi

    if "$console_bin" getBlockNumber >/dev/null 2>&1; then
        return 0
    fi

    echo "ERROR: FISCO console cannot reach the rebuilt node set"
    echo "  Fix: start the base services first:"
    echo "    cd $ROOT_DIR"
    echo "    bash start-all.sh"
    exit 1
}

start_fisco_rpc_adapter() {
    if is_pid_alive "${RPC_ADAPTER_PID:-}"; then
        return
    fi

    : > "$RPC_ADAPTER_LOG"
    local old_pwd
    old_pwd="$(pwd)"
    cd "$ROOT_DIR"
    nohup env FISCO_COMPAT_HOST="127.0.0.1" FISCO_COMPAT_PORT="8545" \
        FISCO_CONSOLE_DIR="${FISCO_CONSOLE_DIR:-$FISCO_CONSOLE_DIR_DEFAULT}" \
        node scripts/fisco-rpc-compat.js >> "$RPC_ADAPTER_LOG" 2>&1 &
    RPC_ADAPTER_PID=$!
    cd "$old_pwd"
    echo "Started FISCO RPC compat pid=${RPC_ADAPTER_PID}"
}

check_fisco_rpc_ready() {
    local payload='{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
    if jsonrpc_post_ok "http://127.0.0.1:8545" "$payload"; then
        return 0
    fi

    check_fisco_console_ready
    start_fisco_rpc_adapter

    local deadline=$((SECONDS + 30))
    while (( SECONDS <= deadline )); do
        if jsonrpc_post_ok "http://127.0.0.1:8545" "$payload"; then
            return 0
        fi
        sleep 1
    done

    echo "ERROR: FISCO RPC compat layer failed to start at http://127.0.0.1:8545"
    tail -n 120 "$RPC_ADAPTER_LOG" || true
    exit 1
}

ensure_relayer_deps() {
    if [[ ! -d "$RELAYER_DIR/node_modules" ]]; then
        (cd "$RELAYER_DIR" && npm install)
        return
    fi

    if ! (cd "$RELAYER_DIR" && node -e "require.resolve('express'); require.resolve('ajv')" >/dev/null 2>&1); then
        (cd "$RELAYER_DIR" && npm install)
    fi
}

ensure_ui_deps() {
    if [[ ! -d "$UI_DIR/node_modules" ]]; then
        (cd "$UI_DIR" && npm install)
    fi
}

start_api() {
    if is_pid_alive "${API_PID:-}"; then
        echo "API already running (pid=${API_PID})"
        return
    fi

    : > "$API_LOG"
    local old_pwd
    old_pwd="$(pwd)"
    cd "$RELAYER_DIR"
    nohup env DEMO_API_ENABLED=true DEMO_API_HOST="$API_HOST" DEMO_API_PORT="$API_PORT" \
        FISCO_CONSOLE_DIR="${FISCO_CONSOLE_DIR:-$FISCO_CONSOLE_DIR_DEFAULT}" \
        FABRIC_SAMPLES_DIR="${FABRIC_SAMPLES_DIR:-}" \
        FABRIC_CRYPTO_PATH="${FABRIC_CRYPTO_PATH:-}" \
        FABRIC_PEER_BIN="${FABRIC_PEER_BIN:-}" \
        node index.js ./config.json >> "$API_LOG" 2>&1 &
    API_PID=$!
    cd "$old_pwd"
    echo "Started API pid=${API_PID}"
}

start_ui() {
    if is_pid_alive "${UI_PID:-}"; then
        echo "UI already running (pid=${UI_PID})"
        return
    fi

    : > "$UI_LOG"
    local old_pwd
    old_pwd="$(pwd)"
    cd "$UI_DIR"
    nohup npm run dev -- --host "$UI_HOST" --port "$UI_PORT" >> "$UI_LOG" 2>&1 &
    UI_PID=$!
    cd "$old_pwd"
    echo "Started UI pid=${UI_PID}"
}

save_pids() {
    cat > "$PID_FILE" <<EOF
RPC_ADAPTER_PID=$RPC_ADAPTER_PID
API_PID=$API_PID
UI_PID=$UI_PID
EOF
}

require_cmd node
require_cmd npm
require_cmd curl
require_cmd hostname

if [[ ! -d "$RELAYER_DIR" ]]; then
    echo "ERROR: relayer dir missing: $RELAYER_DIR"
    exit 1
fi
if [[ ! -d "$UI_DIR" ]]; then
    echo "ERROR: demo-ui dir missing: $UI_DIR"
    exit 1
fi

load_existing_pids
ensure_relayer_deps
ensure_ui_deps
cleanup_existing_demo_processes
check_fisco_rpc_ready
start_api
start_ui
save_pids

if ! wait_http_ready "http://127.0.0.1:${API_PORT}/health" 45; then
    echo "ERROR: demo API failed health check"
    tail -n 120 "$API_LOG" || true
    exit 1
fi

if ! wait_http_ready "http://127.0.0.1:${UI_PORT}" 45; then
    echo "ERROR: demo UI failed health check"
    tail -n 120 "$UI_LOG" || true
    exit 1
fi

WSL_IP="$(hostname -I | awk '{print $1}')"

echo
echo "========================================="
echo "Demo services started"
echo "API log: $API_LOG"
echo "UI  log: $UI_LOG"
echo "RPC log: $RPC_ADAPTER_LOG"
echo "Windows URL (localhost): http://localhost:${UI_PORT}"
echo "Windows URL (fallback):  http://${WSL_IP}:${UI_PORT}"
echo "API URL:                 http://127.0.0.1:${API_PORT}"
echo "Stop command:            bash scripts/stop-demo.sh"
echo "========================================="
