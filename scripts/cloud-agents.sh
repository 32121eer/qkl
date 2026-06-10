#!/usr/bin/env bash
#
# cloud-agents.sh — start/stop/status 4 verifier agents on one cloud VM.
#
# AutoDL exposes only ports 6006 and 6008 publicly per instance. To run 4
# agents per VM, this script spawns TWO multi_agent_service.js processes
# (one on 6006, one on 6008), each hosting 2 agents at sub-paths /a, /b.
#
# Public URLs to use in the relayer's DEMO_REMOTE_AGENTS_JSON:
#   verifier-cloud-?1  →  <port-6006-public-url>/a
#   verifier-cloud-?2  →  <port-6006-public-url>/b
#   verifier-cloud-?3  →  <port-6008-public-url>/a
#   verifier-cloud-?4  →  <port-6008-public-url>/b
# (where ?=a on VM-A and ?=b on VM-B)

set -euo pipefail

# ── CONFIG ────────────────────────────────────────────────────────────────
REPO_DIR="${REPO_DIR:-/root/qkl}"
RELAYER_DIR="$REPO_DIR/fabric-chaincode/Relayer"
LOG_DIR="${LOG_DIR:-/root/agent-logs}"
PID_DIR="${PID_DIR:-/root/agent-logs}"

SIDE="${SIDE:-${1:-}}"
case "$SIDE" in
    a|b) ;;
    start|stop|status|restart) CMD="$SIDE"; SIDE="" ;;
    *) ;;
esac
if [[ -z "${SIDE:-}" ]]; then
    if hostname | grep -qi 'bjb1\|9977'; then SIDE=a; fi
    if hostname | grep -qi 'bjb2\|zv4w'; then SIDE=b; fi
fi
SIDE="${SIDE:-a}"

# Two ports, each hosting two agents (slots a, b).
AGENT_PORTS=(6006 6008)

CMD="${CMD:-${2:-${1:-}}}"
CMD="${CMD:-status}"

mkdir -p "$LOG_DIR" "$PID_DIR"

# Map (side, port, slot) -> agentId/org/strategy/focus.
# 4 agents per VM = 2 ports × 2 slots. Strategies spread across A/B/C.
build_bundle() {
    # Args: port_index (0|1)
    local pi="$1"
    local port="${AGENT_PORTS[$pi]}"
    # Numbering: agent N = port_index*2 + slot_index + 1   (1..4)
    local n1=$(( pi * 2 + 1 ))
    local n2=$(( pi * 2 + 2 ))

    # Strategy/focus by agent number for variety
    declare -a STRAT=(A_PROOF_VALIDATOR B_POLICY_CHECKER C_SEMANTIC_REASONER A_PROOF_VALIDATOR)
    declare -a FOCUS=(proof balanced semantic proof)

    cat <<JSON
[
  {
    "mountPath": "/a",
    "agentId": "verifier-cloud-${SIDE}${n1}",
    "organization": "org-cloud-${SIDE}-${n1}",
    "strategyType": "${STRAT[$((n1-1))]}",
    "focus": "${FOCUS[$((n1-1))]}",
    "sharedSecret": "cloud-secret-${SIDE}${n1}"
  },
  {
    "mountPath": "/b",
    "agentId": "verifier-cloud-${SIDE}${n2}",
    "organization": "org-cloud-${SIDE}-${n2}",
    "strategyType": "${STRAT[$((n2-1))]}",
    "focus": "${FOCUS[$((n2-1))]}",
    "sharedSecret": "cloud-secret-${SIDE}${n2}"
  }
]
JSON
}

pid_file_for_port() { echo "$PID_DIR/bundle-port-$1.pid"; }
log_file_for_port() { echo "$LOG_DIR/bundle-port-$1.log"; }

# True if the bundle on port $1 answers its root /health over HTTP.
port_healthy() { curl -fsS -m 2 "http://localhost:$1/health" >/dev/null 2>&1; }

# True only if pid $1 is alive AND is actually our agent process. Guards
# against an unrelated process that happened to reuse the PID number.
pid_is_agent() {
    local p="${1:-}"
    [[ -n "$p" ]] && kill -0 "$p" 2>/dev/null && \
        ps -p "$p" -o args= 2>/dev/null | grep -q 'multi_agent_service.js'
}

start_port() {
    local pi="$1"
    local port="${AGENT_PORTS[$pi]}"
    local pidf="$(pid_file_for_port "$port")"
    local log="$(log_file_for_port "$port")"
    local oldpid=""
    [[ -f "$pidf" ]] && oldpid="$(cat "$pidf" 2>/dev/null || true)"

    # Already serving HTTP? Nothing to do — trust the health probe, not the PID.
    if port_healthy "$port"; then
        echo "  port=$port already serving (pid=${oldpid:-?})"
        return 0
    fi

    # Not serving. Clear out any stale/hung previous instance before relaunch.
    if [[ -n "$oldpid" ]] && kill -0 "$oldpid" 2>/dev/null; then
        if pid_is_agent "$oldpid"; then
            echo "  port=$port pid=$oldpid alive but not serving; killing stale agent"
            kill "$oldpid" 2>/dev/null || true
            sleep 0.5
            kill -9 "$oldpid" 2>/dev/null || true
        else
            echo "  port=$port pid=$oldpid is not our agent (reused number); leaving it alone"
        fi
    fi
    rm -f "$pidf"

    local bundle
    bundle="$(build_bundle "$pi")"

    cd "$RELAYER_DIR"
    AGENT_PORT="$port" \
    AGENT_HOST=0.0.0.0 \
    AGENT_BUNDLE_JSON="$bundle" \
    nohup node demo/agents/multi_agent_service.js > "$log" 2>&1 &
    local newpid=$!
    echo "$newpid" > "$pidf"

    # Confirm it actually bound and is serving before declaring success.
    # multi_agent_service.js exits on bind error, so a dead PID == failed start.
    local i
    for i in $(seq 1 10); do
        if port_healthy "$port"; then
            echo "  port=$port bundle started (pid=$newpid)"
            return 0
        fi
        if ! kill -0 "$newpid" 2>/dev/null; then
            break
        fi
        sleep 0.5
    done

    echo "  port=$port FAILED to start (not serving) — last log lines:"
    tail -n 6 "$log" 2>/dev/null | sed 's/^/      /' || true
    rm -f "$pidf"
    return 1
}

stop_port() {
    local port="$1"
    local pidf="$(pid_file_for_port "$port")"
    local p=""
    [[ -f "$pidf" ]] && p="$(cat "$pidf" 2>/dev/null || true)"
    if pid_is_agent "$p"; then
        kill "$p" 2>/dev/null || true
        sleep 0.5
        kill -9 "$p" 2>/dev/null || true
        echo "  port=$port stopped (pid=$p)"
    elif [[ -n "$p" ]] && kill -0 "$p" 2>/dev/null; then
        echo "  port=$port pid=$p is not our agent (reused number); not killing"
    else
        echo "  port=$port not running"
    fi
    rm -f "$pidf"
}

status_port() {
    local pi="$1"
    local port="${AGENT_PORTS[$pi]}"
    local pidf="$(pid_file_for_port "$port")"
    local pidstr=""
    [[ -f "$pidf" ]] && pidstr="$(cat "$pidf" 2>/dev/null || true)"

    if port_healthy "$port"; then
        echo "  port=$port serving (pid=${pidstr:-?}):"
        for slot in a b; do
            local h
            h="$(curl -sS -m 2 "http://localhost:$port/$slot/health" 2>/dev/null || echo 'unreachable')"
            echo "    /$slot/health  =>  ${h:0:200}"
        done
    elif [[ -n "$pidstr" ]] && kill -0 "$pidstr" 2>/dev/null; then
        echo "  port=$port NOT SERVING (pid=$pidstr alive but no HTTP — stale/hung); see $(log_file_for_port "$port")"
    else
        echo "  port=$port NOT RUNNING"
    fi
}

case "$CMD" in
    start)
        echo "Starting 4 agents (2 ports × 2 slots) on side='$SIDE' ..."
        rc=0
        for pi in 0 1; do start_port "$pi" || rc=1; done
        exit "$rc"
        ;;
    stop)
        echo "Stopping bundles on side='$SIDE' ..."
        for port in "${AGENT_PORTS[@]}"; do stop_port "$port"; done
        ;;
    restart)
        for port in "${AGENT_PORTS[@]}"; do stop_port "$port"; done
        sleep 1
        rc=0
        for pi in 0 1; do start_port "$pi" || rc=1; done
        exit "$rc"
        ;;
    status)
        echo "Status on side='$SIDE':"
        for pi in 0 1; do status_port "$pi"; done
        ;;
    *)
        echo "Usage: $0 {start|stop|restart|status}  (optionally prefix with SIDE=a|b)"
        exit 2
        ;;
esac
