# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Bidirectional cross-chain message relay between Hyperledger Fabric and FISCO-BCOS with lightweight block header verification. Includes a demo platform with blockchain explorer and cross-chain query UI.

**Environment:** Runs in WSL2 (Ubuntu) with Docker. Fabric test-network lives at `/home/tr/fabric-samples/test-network/`.

## Key Commands

### Full startup (chains + contracts)
```bash
unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY no_proxy NO_PROXY
bash start-all.sh                          # start Fabric + FISCO + deploy contracts
bash start-all.sh --redeploy-fabric-cc     # force redeploy chaincode
bash start-all.sh --skip-ca-tls-verify     # bypass CA TLS check if certs fail
```

### Demo services (relayer + UI)
```bash
bash scripts/start-demo.sh     # start relayer (port 18080) + Vite UI (port 15173)
bash scripts/stop-demo.sh      # stop demo services
```

### Relayer (standalone)
```bash
cd fabric-chaincode/Relayer
npm start                                              # production
npm run dev                                            # nodemon auto-reload
DEMO_API_ENABLED=true DEMO_API_PORT=18080 npm start    # with demo API
```

### Demo UI (standalone)
```bash
cd demo-ui
npm run dev       # Vite dev server on :15173, proxies /api/* to :18080
npm run build     # production build to dist/
```

### Testing
```bash
bash verify-crosschain.sh                              # full bidirectional integration test
VERIFY_RELAYER_RESTART=false bash verify-crosschain.sh  # skip relayer restart
cd fabric-chaincode/Relayer && node test-crosschain.js  # quick Fabric->FISCO test
```

### Lint
```bash
cd fabric-chaincode/Relayer && npx eslint .
```

### Useful dev utilities
```bash
cd fabric-chaincode/Relayer && bash quick-test.sh        # health check: FISCO RPC, Fabric peers, cross-chain
bash scripts/smoke-demo-api.sh                           # smoke test all demo API endpoints including SSE
```

## Architecture

### Component Layout

```
Browser (Windows) --> demo-ui (Vite/React :15173)
                          |
                     /api/* proxy
                          |
                     Demo API (Express :18080, inside relayer process)
                          |
                     Relayer Core (monitors + handlers)
                        /    \
            Fabric Peers      FISCO-BCOS RPC (:8545)
            (gateway_cc)      (GatewayAir / LightClientAir)
```

The Relayer and Demo API run in a **single Node.js process** (`fabric-chaincode/Relayer/index.js`).

### Cross-chain message flow

- **Fabric -> FISCO:** Fabric chaincode emits `CrossChainCall` event -> FabricMonitor picks it up -> MessageHandler calls FISCO `receiveLite()`.
- **FISCO -> Fabric:** FISCO emits event -> FiscoBcosMonitor polls RPC -> Relayer submits block headers to Fabric (`SubmitBlockHeader`) then calls `Receive()`, which verifies the header exists in LightClient-lite state.

### Relayer internal structure (`fabric-chaincode/Relayer/`)

- `index.js` / `relayer.js` - Entry point and orchestrator
- `monitors/` - `fabric_monitor.js` (fabric-gateway SDK), `fisco_bcos_monitor.js` (ethers.js polling)
- `handlers/message_handler.js` - Routes messages between chains
- `extractors/block_header_extractor.js` - Normalizes block headers
- `config.json` - Runtime chain endpoints, contract addresses, relayer settings
- `abi/` - Contract ABIs for FISCO contracts

### Demo platform layers (`fabric-chaincode/Relayer/demo/`)

Layered architecture: `api/` (HTTP routes) -> `broker/` (cross-chain orchestration) -> `session/` (query state machine) -> `store/` (memory or SQLite). Events flow via `events/` + SSE to the frontend.

### Fabric chaincode (`fabric-chaincode/gateway_cc/`)

JavaScript chaincode using `fabric-contract-api@^2.5.0`. Key methods: `Send()`, `Receive()`, `SubmitBlockHeader()`, `GetOrchardRecord()`. Deployed to channel `mychannel`.

### FISCO contracts (`fisco-bcos/console/contracts/solidity/`)

Solidity contracts: `GatewayAir.sol`, `LightClientAir.sol`, `ChainRegistryAir.sol`. Deployed via FISCO console (`console.sh`). The "Air" variants are the lightweight versions actually in use.

### Demo UI (`demo-ui/`)

React 18 + Vite 5 + React Router 6. Pages: `ExplorerPage.jsx` (block explorer), `AppDemoPage.jsx` (proof-card relay demo), `AppQueryPage.jsx` (cross-chain query workflow).

## Tech Stack

- **Relayer:** Node.js, Express, ethers.js 6, @hyperledger/fabric-gateway 1.4, Winston logging, SQLite3
- **Fabric chaincode:** JavaScript (fabric-contract-api 2.5)
- **FISCO contracts:** Solidity 0.8.x
- **Frontend:** React 18, Vite 5, plain CSS

## Important Conventions

- All startup scripts sanitize proxy env vars (`unset http_proxy ...`) to avoid Docker/localhost issues in WSL.
- Contract addresses in `fabric-chaincode/Relayer/config.json` are updated by `bootstrap.sh` after deployment.
- FISCO interop uses `console.sh` CLI for contract deployment/calls; ethers.js for runtime RPC.
- Logs go to `.demo/demo-api.log` and `.demo/demo-ui.log`. PID file at `.demo/demo.pids`.
- Fabric network is torn down and recreated by default on `start-all.sh` (use `--no-down` to preserve). FISCO data persists across restarts.

## Ports

| Service | Port |
|---------|------|
| Demo UI (Vite) | 15173 |
| Demo API (Express) | 18080 |
| FISCO-BCOS RPC | 8545 |
| Fabric Peer | 7051 |
