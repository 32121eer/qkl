#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RECEIVE_METHOD="${1:-receiveLite}"

echo "升级 FISCO GatewayAir，receiveMethod=$RECEIVE_METHOD"
exec bash "$PROJECT_ROOT/bootstrap.sh" --upgrade-fisco-gateway --receive-method "$RECEIVE_METHOD"
