# Cross-Chain Demo

This repository is a practical cross-chain demo between Hyperledger Fabric and FISCO-BCOS.
It focuses on two things:
- Reliable bidirectional relay with lightweight header verification.
- User-facing visualization pages for explorer and query workflows.

## Implemented
- Fabric <-> FISCO message relay.
- FISCO -> Fabric light-client-lite header submission and verification flow.
- Demo UI pages:
  - `/explorer`: chain status and block explorer (lite).
  - `/app-query`: business-style cross-chain query demo.

## Quick Start
```bash
unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY no_proxy NO_PROXY
cd /home/tr/projects/cross-chain
bash start-all.sh
bash scripts/start-demo.sh
```

Open from Windows: `http://localhost:15173`

## Start From Scratch
Use this flow when WSL/docker crashes, ports conflict, or demo health check fails.

### 1) Clean proxy and old processes
```bash
unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY no_proxy NO_PROXY
cd /home/tr/projects/cross-chain
bash scripts/stop-demo.sh || true
pkill -f "node index.js|vite|npm run dev" || true
```

### 2) Stop old chain network
```bash
cd /home/tr/projects/cross-chain/fisco-bcos/nodes/127.0.0.1
bash stop_all.sh || true

cd /home/tr/fabric-samples/test-network
./network.sh down || true
```

### 3) Start base services from zero
```bash
cd /home/tr/projects/cross-chain
bash start-all.sh --redeploy-fabric-cc
```

If CA TLS validation fails, use:
```bash
bash start-all.sh --redeploy-fabric-cc --skip-ca-tls-verify
```

### 4) Start demo services
```bash
cd /home/tr/projects/cross-chain
bash scripts/start-demo.sh
```

### 5) Health check
```bash
curl -s -X POST http://127.0.0.1:8545 -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
curl -s http://127.0.0.1:18080/health
```

Open from Windows:
- `http://localhost:15173`
- fallback: `http://<WSL_IP>:15173` (printed by `scripts/start-demo.sh`)
