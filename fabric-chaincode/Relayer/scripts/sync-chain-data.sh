#!/bin/bash
# Sync on-chain AgentRegistry data to local JSON

CONTRACT_ADDR="${1:-0xfcf9ace6d9653593164b98386f10995acc9115fe}"
CONSOLE_DIR="/mnt/fast18/xunuo/qkl/cross-chain/fisco-bcos/console"
OUTPUT_FILE="/mnt/fast18/xunuo/qkl/cross-chain/fabric-chaincode/Relayer/.demo/agents/onchain-state.json"

mkdir -p "$(dirname "$OUTPUT_FILE")"

echo "=== Syncing On-Chain Data ==="
echo "Contract: $CONTRACT_ADDR"

cd "$CONSOLE_DIR"

# Get active verifiers
VERIFIERS_OUTPUT=$(./console.sh call AgentRegistry "$CONTRACT_ADDR" getActiveVerifiers 2>/dev/null)
VERIFIERS=$(echo "$VERIFIERS_OUTPUT" | grep "Return values" | sed 's/.*(\[\([^]]*\)\].*/\1/' | tr ',' '\n' | sed 's/^[ \t]*//;s/[ \t]*$//')

# Build JSON
cat > "$OUTPUT_FILE" << EOF
{
  "contractAddress": "$CONTRACT_ADDR",
  "syncedAt": "$(date -Iseconds)",
  "agents": [
EOF

FIRST=1
for agentId in $VERIFIERS; do
    # Get agent details
    AGENT_OUTPUT=$(./console.sh call AgentRegistry "$CONTRACT_ADDR" getAgent "$agentId" 2>/dev/null)
    VALUES=$(echo "$AGENT_OUTPUT" | grep "Return values" | sed 's/.*(\[\([^]]*\)\].*/\1/')

    # Parse values (comma-separated)
    ROLE=$(echo "$VALUES" | awk -F', ' '{print $2}')
    ORG=$(echo "$VALUES" | awk -F', ' '{print $3}')
    STRATEGY=$(echo "$VALUES" | awk -F', ' '{print $4}')
    ENDPOINT=$(echo "$VALUES" | awk -F', ' '{print $5}')
    REPUTATION=$(echo "$VALUES" | awk -F', ' '{print $7}')
    SUCCESS=$(echo "$VALUES" | awk -F', ' '{print $8}')
    TOTAL=$(echo "$VALUES" | awk -F', ' '{print $9}')
    STATUS=$(echo "$VALUES" | awk -F', ' '{print $12}')

    if [ "$FIRST" -eq 1 ]; then
        FIRST=0
    else
        echo "," >> "$OUTPUT_FILE"
    fi

    cat >> "$OUTPUT_FILE" << AGENT
    {
      "agentId": "$agentId",
      "role": ${ROLE:-2},
      "organization": "${ORG:-unknown}",
      "strategyType": "${STRATEGY:-}",
      "endpoint": "${ENDPOINT:-}",
      "reputation": ${REPUTATION:-500},
      "successCount": ${SUCCESS:-0},
      "totalTasks": ${TOTAL:-0},
      "status": ${STATUS:-1}
    }
AGENT
done

cat >> "$OUTPUT_FILE" << EOF

  ]
}
EOF

echo ""
echo "✅ Synced to: $OUTPUT_FILE"
wc -l "$OUTPUT_FILE"
