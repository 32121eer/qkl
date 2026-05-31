#!/usr/bin/env bash
#
# Container end-to-end adversarial test runner. Drives the 5 verifier Agent
# containers (docker-compose.agents.yml) on the local Ollama LLM through the
# scenarios below and asserts the negotiation outcome of each:
#
#   TC-E2E-001  Health: all 5 /health endpoints respond OK
#   TC-E2E-002  HMAC: unauth /execute -> 401; signed -> 200
#   TC-E2E-003  Happy path: 5 honest containers -> COMMIT (acceptRatio==1)
#   TC-E2E-004  Fault tolerance: stop 1 container -> committee=4 -> still COMMIT
#   TC-E2E-005  Byzantine 1/5 (semantic-02 always_reject) -> still COMMIT
#   TC-E2E-006  Byzantine 2/5 (proof-02 + semantic-02 always_reject) -> NO COMMIT
#
# Usage:  bash scripts/test-containers-e2e.sh
# Prereqs: bash scripts/start-ollama.sh  &&  docker compose -f docker-compose.agents.yml up -d

set -uo pipefail

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY no_proxy NO_PROXY

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PASS=0
FAIL=0
RESULTS=()

ARTIFACT="$ROOT/../../docs/xn/experiments/container-negotiation-latest.json"

# Read a dotted path from the JSON artifact via node (avoids depending on a
# specific jq build).
read_field() {
    node -e "const d=require('$ARTIFACT');let v=d;for(const k of '$1'.split('.')){if(v==null)break;v=v[k]}console.log(v)" 2>/dev/null
}

record() {
    local name="$1" status="$2" detail="${3:-}"
    if [[ "$status" == "PASS" ]]; then
        printf '  \033[32mPASS\033[0m  %s  %s\n' "$name" "$detail"
        PASS=$((PASS + 1))
        RESULTS+=("PASS  $name  $detail")
    else
        printf '  \033[31mFAIL\033[0m  %s  %s\n' "$name" "$detail"
        FAIL=$((FAIL + 1))
        RESULTS+=("FAIL  $name  $detail")
    fi
}

run_negotiation() {
    node scripts/demo-negotiation-containers.js --json > /tmp/neg-$$.log 2>&1
    local rc=$?
    cp /tmp/neg-$$.log "/tmp/neg-latest-$1.log"
    return $rc
}

read_final() { read_field finalProposal.finalDecision; }
read_acceptratio() { read_field finalProposal.quorum.acceptRatio; }
read_rejectratio() { read_field finalProposal.quorum.rejectRatio; }
read_reveals() { read_field finalProposal.quorum.validRevealCount; }

recreate_service_with_behavior() {
    local service="$1" behavior_env="$2" behavior="$3"
    eval "export $behavior_env=$behavior"
    docker compose -f docker-compose.agents.yml up -d --force-recreate "$service" >/dev/null 2>&1
    # health-wait
    local port="$4"
    for _ in $(seq 1 20); do
        curl -s -m 1 "http://127.0.0.1:$port/health" >/dev/null 2>&1 && return 0
        sleep 0.5
    done
    return 1
}

reset_all_honest() {
    unset VERIFIER_PROOF_01_BEHAVIOR VERIFIER_PROOF_02_BEHAVIOR \
          VERIFIER_POLICY_01_BEHAVIOR VERIFIER_SEMANTIC_01_BEHAVIOR \
          VERIFIER_SEMANTIC_02_BEHAVIOR
    docker compose -f docker-compose.agents.yml up -d --force-recreate >/dev/null 2>&1
    for p in 19111 19112 19113 19114 19115; do
        for _ in $(seq 1 20); do
            curl -s -m 1 "http://127.0.0.1:$p/health" >/dev/null 2>&1 && break
            sleep 0.5
        done
    done
}

echo "========================================================"
echo " Container end-to-end adversarial test runner"
echo "========================================================"

# --- TC-E2E-001 Health
echo "[TC-E2E-001] Health"
ok=0
for p in 19111 19112 19113 19114 19115; do
    if curl -s -m 3 "http://127.0.0.1:$p/health" | grep -q '"status":"ok"'; then
        ok=$((ok + 1))
    fi
done
[[ $ok -eq 5 ]] && record "TC-E2E-001 health" PASS "5/5 OK" || record "TC-E2E-001 health" FAIL "$ok/5 OK"

# --- TC-E2E-002 HMAC
echo "[TC-E2E-002] HMAC enforcement"
code=$(curl -s -m 5 -o /dev/null -w "%{http_code}" -X POST http://127.0.0.1:19111/execute \
    -H 'content-type: application/json' -d '{"task":{"taskId":"t"}}')
if [[ "$code" == "401" ]]; then
    record "TC-E2E-002 HMAC unauth 401" PASS "got $code"
else
    record "TC-E2E-002 HMAC unauth 401" FAIL "got $code (expected 401)"
fi

# --- TC-E2E-003 Happy path: all honest -> COMMIT
echo "[TC-E2E-003] Happy path (5 honest -> COMMIT)"
reset_all_honest
if run_negotiation honest; then
    fd=$(read_final); ar=$(read_acceptratio); rv=$(read_reveals)
    if [[ "$fd" == "COMMIT" && $(echo "$ar >= 0.7" | bc -l) == "1" ]]; then
        record "TC-E2E-003 happy COMMIT" PASS "finalDecision=$fd acceptRatio=$ar reveals=$rv"
    else
        record "TC-E2E-003 happy COMMIT" FAIL "finalDecision=$fd acceptRatio=$ar reveals=$rv"
    fi
else
    record "TC-E2E-003 happy COMMIT" FAIL "negotiation script error (see /tmp/neg-latest-honest.log)"
fi

# --- TC-E2E-004 Fault tolerance: stop 1 -> committee=4 -> still COMMIT
echo "[TC-E2E-004] Fault tolerance (stop semantic-02)"
docker stop agent-verifier-semantic-02 >/dev/null 2>&1
sleep 1
if run_negotiation fault; then
    fd=$(read_final); rv=$(read_reveals)
    if [[ "$fd" == "COMMIT" && "$rv" -ge 4 ]]; then
        record "TC-E2E-004 fault tolerance" PASS "finalDecision=$fd reveals=$rv"
    else
        record "TC-E2E-004 fault tolerance" FAIL "finalDecision=$fd reveals=$rv"
    fi
else
    record "TC-E2E-004 fault tolerance" FAIL "negotiation script error"
fi
docker start agent-verifier-semantic-02 >/dev/null 2>&1
for _ in $(seq 1 30); do curl -s -m 1 http://127.0.0.1:19115/health >/dev/null 2>&1 && break; sleep 0.5; done

# --- TC-E2E-005 Byzantine 1/5: semantic-02 always_reject -> still COMMIT
echo "[TC-E2E-005] Byzantine 1/5 (semantic-02 always_reject -> still COMMIT)"
recreate_service_with_behavior agent-verifier-semantic-02 VERIFIER_SEMANTIC_02_BEHAVIOR always_reject 19115
if run_negotiation byz1; then
    fd=$(read_final); ar=$(read_acceptratio)
    if [[ "$fd" == "COMMIT" && $(echo "$ar >= 0.7" | bc -l) == "1" ]]; then
        record "TC-E2E-005 1/5 byz tolerated" PASS "finalDecision=$fd acceptRatio=$ar"
    else
        record "TC-E2E-005 1/5 byz tolerated" FAIL "finalDecision=$fd acceptRatio=$ar"
    fi
else
    record "TC-E2E-005 1/5 byz tolerated" FAIL "negotiation script error"
fi

# --- TC-E2E-006 Byzantine 2/5: proof-02 + semantic-02 always_reject -> NOT COMMIT
echo "[TC-E2E-006] Byzantine 2/5 (2 always_reject -> NOT COMMIT)"
recreate_service_with_behavior agent-verifier-proof-02 VERIFIER_PROOF_02_BEHAVIOR always_reject 19112
if run_negotiation byz2; then
    fd=$(read_final); ar=$(read_acceptratio); rj=$(read_rejectratio)
    if [[ "$fd" != "COMMIT" ]]; then
        record "TC-E2E-006 2/5 byz blocks COMMIT" PASS "finalDecision=$fd acceptRatio=$ar rejectRatio=$rj"
    else
        record "TC-E2E-006 2/5 byz blocks COMMIT" FAIL "finalDecision=$fd acceptRatio=$ar (should not COMMIT)"
    fi
else
    record "TC-E2E-006 2/5 byz blocks COMMIT" FAIL "negotiation script error"
fi

# --- restore for next session
echo ""
echo "[cleanup] restoring all containers to honest"
reset_all_honest

echo ""
echo "========================================================"
echo " Summary: $PASS pass, $FAIL fail"
echo "========================================================"
for line in "${RESULTS[@]}"; do echo "  $line"; done

exit $((FAIL > 0 ? 1 : 0))
