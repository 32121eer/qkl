#!/bin/bash
dirpath="$(cd "$(dirname "$0")" && pwd)"
cd "${dirpath}"

CONTAINER_NAME="fisco-all-nodes"

if [[ "$(uname)" == "Darwin" ]]; then
    echo "macOS detected — stopping FISCO Docker container"
    docker rm -f "$CONTAINER_NAME" 2>/dev/null && echo "Stopped $CONTAINER_NAME" || echo "$CONTAINER_NAME not running"
    exit 0
fi

# Linux: use native per-node stop scripts
dirs=($(ls -l ${dirpath} | awk '/^d/ {print $NF}'))
for dir in ${dirs[*]}
do
    if [[ -f "${dirpath}/${dir}/config.ini" && -f "${dirpath}/${dir}/stop.sh" ]];then
        echo "try to stop ${dir}"
        bash ${dirpath}/${dir}/stop.sh
    fi
done
wait
