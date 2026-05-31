#!/usr/bin/env bash
set -euo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY no_proxy NO_PROXY || true

BASE_URL="${BASE_URL:-http://127.0.0.1:18080}"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_cmd curl

echo "[smoke] BASE_URL=$BASE_URL"

echo "[smoke] GET /health"
curl -fsS "$BASE_URL/health" >/dev/null

echo "[smoke] GET /demo/status"
curl -fsS "$BASE_URL/demo/status" >/dev/null

echo "[smoke] GET /demo/events"
curl -fsS "$BASE_URL/demo/events?limit=5" >/dev/null

echo "[smoke] GET /demo/explorer/overview"
curl -fsS "$BASE_URL/demo/explorer/overview" >/dev/null

echo "[smoke] GET /demo/app/proof-cards"
curl -fsS "$BASE_URL/demo/app/proof-cards?limit=5" >/dev/null

echo "[smoke] GET /demo/app/query/sessions"
curl -fsS "$BASE_URL/demo/app/query/sessions?limit=5" >/dev/null

echo "[smoke] GET /demo/stream (SSE)"
SSE_OUT="$(mktemp)"
set +e
curl -fsS --max-time 2 "$BASE_URL/demo/stream" >"$SSE_OUT"
set -e
if ! rg -q "retry:|event: ping|data:" "$SSE_OUT" 2>/dev/null && ! grep -Eq "retry:|event: ping|data:" "$SSE_OUT"; then
  echo "SSE output did not contain expected markers." >&2
  echo "--- SSE output ---" >&2
  cat "$SSE_OUT" >&2
  exit 1
fi
rm -f "$SSE_OUT"

echo "[smoke] PASS"
