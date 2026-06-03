#!/bin/bash
dirpath="$(cd "$(dirname "$0")" && pwd)"
cd "${dirpath}"

CONTAINER_NAME="fisco-all-nodes"
# Native ARM64 image (no x86 emulation on Apple Silicon)
FISCO_IMAGE="fisco-bcos-arm64:v3.11.0"

# macOS Docker Desktop: host networking doesn't expose ports to macOS, use bridge + port mapping
if [[ "$(uname)" == "Darwin" ]]; then
    echo "macOS detected — starting FISCO nodes in Docker container with port mapping"

    docker rm -f "$CONTAINER_NAME" 2>/dev/null || true

    docker run -d \
        --name "$CONTAINER_NAME" \
        --entrypoint /bin/bash \
        -v "$dirpath/node0:/nodes/node0" \
        -v "$dirpath/node1:/nodes/node1" \
        -v "$dirpath/node2:/nodes/node2" \
        -v "$dirpath/node3:/nodes/node3" \
        -v "$dirpath/docker-entrypoint.sh:/docker-entrypoint.sh" \
        -p 20200:20200 -p 20201:20201 -p 20202:20202 -p 20203:20203 \
        -p 30300:30300 -p 30301:30301 -p 30302:30302 -p 30303:30303 \
        -p 18545:8545 \
        "$FISCO_IMAGE" \
        /docker-entrypoint.sh

    echo "FISCO container started: $CONTAINER_NAME"

    # Wait for web3 RPC (18545) to be available — ethers.js connects here directly
    echo "Waiting for FISCO nodes to be ready..."
    deadline=$((SECONDS + 90))
    while (( SECONDS < deadline )); do
        if curl -sS -m 2 -X POST -H 'content-type: application/json' \
               --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
               http://127.0.0.1:18545 2>/dev/null | grep -q '"result"'; then
            echo "✓ FISCO web3 RPC (port 18545) is ready"
            break
        fi
        sleep 3
    done
    exit 0
fi

# Linux: use native per-node start scripts
dirs=($(ls -l ${dirpath} | awk '/^d/ {print $NF}'))
for dir in ${dirs[*]}
do
    if [[ -f "${dirpath}/${dir}/config.ini" && -f "${dirpath}/${dir}/start.sh" ]];then
        echo "try to start ${dir}"
        bash ${dirpath}/${dir}/start.sh &
    fi
done
wait
