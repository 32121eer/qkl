# Repository Guidelines

## Project Structure & Module Organization
This repo combines a cross-chain demo UI, a Node.js relayer, and Fabric/FISCO chain artifacts.

- `demo-ui/`: Vite + React frontend. Main code lives in `demo-ui/src`, with pages under `src/pages` and shared UI in `src/components`.
- `fabric-chaincode/Relayer/`: Node.js relay service, demo API, config, and integration scripts.
- `fabric-chaincode/my-chain-code/`: Go chaincode for Fabric (`gateway_cc`, `registry_cc`) plus deployment helpers.
- `fisco-bcos/`: local FISCO-BCOS node and console assets.
- `scripts/`: demo startup, shutdown, and smoke-check scripts.
- `docs/`: architecture notes such as `docs/ARCHITECTURE_OVERVIEW.md`.

## Build, Test, and Development Commands
- `bash start-all.sh`: boot FISCO-BCOS, Fabric test network, and deploy contracts/chaincode.
- `bash scripts/start-demo.sh`: start the relayer demo API and Vite UI.
- `bash scripts/stop-demo.sh`: stop demo processes recorded in `.demo/demo.pids`.
- `cd demo-ui && npm run dev`: run the frontend only.
- `cd demo-ui && npm run build`: produce a production UI bundle.
- `cd fabric-chaincode/Relayer && npm test`: run relayer Jest tests.
- `cd fabric-chaincode/Relayer && npm run lint`: lint relayer JavaScript.

## Coding Style & Naming Conventions
Match the style already used in each module instead of forcing one global format.

- React UI uses ES modules, 2-space indentation, PascalCase for components, and page files such as `ExplorerPage.jsx`.
- Relayer code uses CommonJS, typically 4-space indentation, and descriptive snake_case filenames such as `block_header_extractor.js`.
- Go chaincode follows standard Go formatting. Run `gofmt` on edited `.go` files before submitting.
- Prefer small, focused scripts; keep config examples in `*.example.json` when adding new settings.

## Testing Guidelines
Put JS tests next to the relayer service or use the existing `test-*.js` pattern in `fabric-chaincode/Relayer/`. For Go changes, add or update `*_test.go` files near the affected package. After infrastructure changes, verify the end-to-end flow with `bash scripts/start-demo.sh` and `bash scripts/smoke-demo-api.sh`.

## Commit & Pull Request Guidelines
Recent history uses short imperative subjects with prefixes like `feat:`, `fix:`, `docs:`, `chore:`, and `demo:`. Keep commits scoped to one concern. PRs should explain the affected flow, list manual verification steps, link related issues, and include screenshots for UI changes such as `/explorer` or `/app-query`.

## Security & Configuration Tips
Do not commit live secrets or environment-specific `config.json` values. Use `config.example.json` as the template, and clear proxy variables before bootstrapping local networks when following the root `README.md`.
