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
