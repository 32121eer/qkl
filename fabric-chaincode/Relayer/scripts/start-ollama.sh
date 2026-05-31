#!/usr/bin/env bash
#
# Start the local Ollama LLM server used by the B/C verifier agents.
# User-space install (no root), GPU = RTX 3090 Ti. Models live on /mnt/fast18.
#
# The agent containers use host networking and reach this server over loopback
# (http://127.0.0.1:11434), which ufw permits. Keep this running before launching
# the agent containers / negotiation demo.
#
# Usage:
#   bash scripts/start-ollama.sh         # start if not already running
#   bash scripts/start-ollama.sh --stop  # stop

set -euo pipefail

OLLAMA_DIR="/mnt/fast18/xunuo/qkl/ollama"
export OLLAMA_HOST="0.0.0.0:11434"
export OLLAMA_MODELS="$OLLAMA_DIR/models"
export LD_LIBRARY_PATH="$OLLAMA_DIR/lib/ollama:${LD_LIBRARY_PATH:-}"
LOG="$OLLAMA_DIR/serve.log"

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY no_proxy NO_PROXY

if [[ "${1:-}" == "--stop" ]]; then
    pkill -f "$OLLAMA_DIR/bin/ollama serve" && echo "Stopped ollama" || echo "ollama not running"
    exit 0
fi

if curl -s -m 2 http://127.0.0.1:11434/api/version >/dev/null 2>&1; then
    echo "ollama already running: $(curl -s http://127.0.0.1:11434/api/version)"
    exit 0
fi

nohup "$OLLAMA_DIR/bin/ollama" serve >> "$LOG" 2>&1 &
echo "Started ollama serve (pid=$!), log: $LOG"

for _ in {1..30}; do
    if curl -s -m 2 http://127.0.0.1:11434/api/version >/dev/null 2>&1; then
        echo "ready: $(curl -s http://127.0.0.1:11434/api/version)"
        "$OLLAMA_DIR/bin/ollama" list
        exit 0
    fi
    sleep 1
done
echo "ERROR: ollama did not become ready; see $LOG"; tail -20 "$LOG"; exit 1
