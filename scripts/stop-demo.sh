#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="$ROOT_DIR/.demo"
PID_FILE="$RUN_DIR/demo.pids"

kill_if_alive() {
    local pid="$1"
    local name="$2"
    if [[ -n "$pid" ]] && kill -0 "$pid" >/dev/null 2>&1; then
        kill "$pid" >/dev/null 2>&1 || true
        sleep 1
        if kill -0 "$pid" >/dev/null 2>&1; then
            kill -9 "$pid" >/dev/null 2>&1 || true
        fi
        echo "Stopped ${name} (pid=${pid})"
    fi
}

if [[ ! -f "$PID_FILE" ]]; then
    echo "No pid file found: $PID_FILE"
    exit 0
fi

API_PID=""
UI_PID=""
# shellcheck disable=SC1090
source "$PID_FILE" || true

kill_if_alive "${API_PID:-}" "demo-api"
kill_if_alive "${UI_PID:-}" "demo-ui"

rm -f "$PID_FILE"

echo "Demo services stopped."
