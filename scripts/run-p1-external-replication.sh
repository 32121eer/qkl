#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RELAYER_DIR="$PROJECT_ROOT/fabric-chaincode/Relayer"
OUTPUT_ROOT="${1:-$PROJECT_ROOT/docs/xn/experiments/external-replication/$(date -u +%Y%m%dT%H%M%SZ)}"

if [[ -e "$OUTPUT_ROOT" ]]; then
    echo "Refusing to overwrite existing output: $OUTPUT_ROOT" >&2
    exit 1
fi

for command_name in bash docker git node npm python3; do
    if ! command -v "$command_name" >/dev/null 2>&1; then
        echo "Missing required command: $command_name" >&2
        exit 1
    fi
done

if ! docker info >/dev/null 2>&1; then
    echo "Docker daemon is unavailable" >&2
    exit 1
fi

mkdir -p "$OUTPUT_ROOT"
{
    echo "generated_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "host=$(hostname)"
    echo "uname=$(uname -a)"
    echo "node=$(node --version)"
    echo "npm=$(npm --version)"
    echo "docker=$(docker version --format '{{.Server.Version}}')"
    echo "git_commit=$(git -C "$PROJECT_ROOT" rev-parse HEAD)"
    echo "git_dirty_files=$(git -C "$PROJECT_ROOT" status --porcelain | wc -l | tr -d ' ')"
} > "$OUTPUT_ROOT/environment.txt"

cd "$PROJECT_ROOT"
bash start-all.sh --fast 2>&1 | tee "$OUTPUT_ROOT/start-all.log"

cd "$RELAYER_DIR"
npm run exp:semantic-query:seed 2>&1 | tee "$OUTPUT_ROOT/seed.log"
npm test -- --runInBand 2>&1 | tee "$OUTPUT_ROOT/tests.log"

node demo/semantic_query/experiments/run_live_saturation.js \
    --levels 1,2,4,8,16 --runs 3 --queries 20 --warmup 2 \
    --anchor-wallets 1 --out "$OUTPUT_ROOT/single-wallet" \
    2>&1 | tee "$OUTPUT_ROOT/single-wallet.log"

node demo/semantic_query/experiments/run_live_saturation.js \
    --levels 1,2,4,8,16 --runs 3 --queries 20 --warmup 2 \
    --anchor-wallets 4 --out "$OUTPUT_ROOT/four-wallet" \
    2>&1 | tee "$OUTPUT_ROOT/four-wallet.log"

node demo/semantic_query/experiments/compare_anchor_strategies.js \
    "$OUTPUT_ROOT/single-wallet/summary.json" \
    "$OUTPUT_ROOT/four-wallet/summary.json" \
    "$OUTPUT_ROOT/comparison.json"

replication_databases=(
    "$OUTPUT_ROOT"/single-wallet/c*/audit.db
    "$OUTPUT_ROOT"/four-wallet/c*/audit.db
)
python3 "$PROJECT_ROOT/tools/independent_audit_verify.py" \
    "${replication_databases[@]}" \
    --out "$OUTPUT_ROOT/independent_verification.json"

if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 \
        "$OUTPUT_ROOT/single-wallet/summary.json" \
        "$OUTPUT_ROOT/four-wallet/summary.json" \
        "$OUTPUT_ROOT/comparison.json" \
        "$OUTPUT_ROOT/independent_verification.json" > "$OUTPUT_ROOT/SHA256SUMS"
elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum \
        "$OUTPUT_ROOT/single-wallet/summary.json" \
        "$OUTPUT_ROOT/four-wallet/summary.json" \
        "$OUTPUT_ROOT/comparison.json" \
        "$OUTPUT_ROOT/independent_verification.json" > "$OUTPUT_ROOT/SHA256SUMS"
fi

echo "External replication artifacts: $OUTPUT_ROOT"
