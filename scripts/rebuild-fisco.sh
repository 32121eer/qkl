#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FISCO_DIR="$ROOT_DIR/fisco-bcos"
BUILD_SCRIPT="$FISCO_DIR/build_chain.sh"
OUTPUT_DIR="$FISCO_DIR/nodes"
FISCO_BIN="$FISCO_DIR/bin/fisco-bcos"
SAFE_HOME="${FISCO_JAVA_USER_HOME:-/tmp/cross-chain-home}"
STAMP="$(date +%Y%m%d-%H%M%S)"

if [[ ! -x "$BUILD_SCRIPT" ]]; then
    echo "ERROR: build_chain.sh not found: $BUILD_SCRIPT" >&2
    exit 1
fi

if [[ ! -x "$FISCO_BIN" ]]; then
    echo "ERROR: fisco-bcos binary not found: $FISCO_BIN" >&2
    exit 1
fi

mkdir -p "$SAFE_HOME"

if [[ -d "$OUTPUT_DIR" ]]; then
    BACKUP_DIR="${OUTPUT_DIR}.backup-${STAMP}"
    mv "$OUTPUT_DIR" "$BACKUP_DIR"
    echo "Backed up existing nodes to: $BACKUP_DIR"
fi

echo "Rebuilding FISCO nodes with HOME=$SAFE_HOME"
(
    cd "$FISCO_DIR"
    HOME="$SAFE_HOME" bash "$BUILD_SCRIPT" -l 127.0.0.1:4 -p 30300,20200 -o nodes -e ./bin/fisco-bcos
)

echo "FISCO nodes rebuilt at: $OUTPUT_DIR"
