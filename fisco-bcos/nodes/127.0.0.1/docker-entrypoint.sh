#!/bin/bash
# Runs inside the Docker container — starts all 4 FISCO-BCOS nodes
BINARY=/usr/local/bin/fisco-bcos

_stop_all() {
    kill $(jobs -p) 2>/dev/null || true
    wait 2>/dev/null
}
trap '_stop_all' INT TERM

for i in 0 1 2 3; do
    mkdir -p /nodes/node${i}/data/consensus_log
    cd /nodes/node${i}
    nohup $BINARY -c config.ini -g config.genesis >> nohup.out 2>&1 &
done

wait
