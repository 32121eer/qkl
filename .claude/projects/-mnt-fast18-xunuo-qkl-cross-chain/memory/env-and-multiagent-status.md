---
name: env-and-multiagent-status
description: Actual machine differs from CLAUDE.md; multi-container agent negotiation verified status
metadata:
  type: project
---

This checkout runs on host `user-Z690-GAMING-X-DDR4` (Linux, not the WSL2 box CLAUDE.md assumes). Consequences verified 2026-05-28:
- **No `/home/tr/fabric-samples`** — Fabric test-network cannot be started here; FISCO RPC (8545) was down. So the full `/app-query` end-to-end (demo API → live chains) is NOT runnable on this machine.
- The Relayer/demo API runs on the **host** (`node index.js` via `scripts/start-demo.sh`), NOT in a container — so it must reach the Dockerized agents via published ports `http://127.0.0.1:191xx`, never via Docker-internal service names.

**Multi-Docker multi-agent negotiation is verified working** (phase 1 of the user's plan), independent of live chains:
- 5 verifier containers (`docker-compose.agents.yml`, ports 19111–19115), HMAC-SHA256 auth enforced (unauth `/execute` → 401).
- LLM backend (as of 2026-05-28): the `zyapi.tuluo.top` relay died; switched to **local Ollama** on the host RTX 3090 Ti (user-space install at `/mnt/fast18/xunuo/qkl/ollama`, `bash scripts/start-ollama.sh`). Models: policy-01=llama3.1:8b, semantic-01/02=qwen2.5:14b. Free, no key, no VPN; full round ~9s (~7× faster than the relay).
- **Networking gotcha:** host `ufw` blocks docker-bridge→host and Docker Hub is unreachable here (can't pull `ollama/ollama`), so agents run `network_mode: host` and reach Ollama over loopback `http://127.0.0.1:11434`. Ollama's own model registry (registry.ollama.ai) IS reachable. `Relayer/.env` holds `LLM_BACKEND=ollama` + base URL.
- Driver: `fabric-chaincode/Relayer/scripts/demo-negotiation-containers.js` (no chains needed). Reaches COMMIT (5/5 APPROVE, acceptRatio 100% ≥ theta 0.70) and degrades gracefully when a container is stopped.
- Root-cause fixes & reproduce steps documented in `docs/xn/多docker容器下部署多agent.md` §17.
- Phase 2 (multi-server) switch path = endpoints only: `AGENT_ENDPOINT_HOST` / `<AGENT_ID>_ENDPOINT` in `setup-agent-directory.js`; negotiation logic unchanged.

Gotcha: agent Docker images must be rebuilt with `--build` after agent-side code changes — stale images silently ship old code (the 2-week-old image lacked HMAC auth entirely).
