# Auditable semantic-query P0

This module is the first executable implementation of the revised paper architecture. It is deliberately separate from the legacy committee/negotiation demo.

Implemented in P0:

- dependency-aware DAG execution with finite retry, candidate and deadline budgets;
- deterministic evidence/rule nodes and a replaceable semantic-service interface;
- query state and business outcome stored as separate fields;
- canonical audit receipts with node, evidence and service-output hashes;
- normalized SQLite persistence, reconstruction and independent root verification;
- deterministic fault plans for endpoint outage, index lag, expired/missing evidence, wrong input root, service timeout and correlated disagreement;
- machine-readable manifest, per-query JSONL and summary output.

Run a quick smoke experiment:

```bash
npm run exp:semantic-query -- --quick --out /tmp/semantic-query-p0
```

Run the default experiment (5 runs, 20 queries per scenario per run):

```bash
npm run exp:semantic-query
```

Evidence boundary: the P0 runner performs real DAG execution, hashing, SQLite writes, reconstruction and bounded retry. Its adapters, semantic service and receipt anchor are local deterministic test doubles. It must not be reported as a live Fabric/FISCO fault-injection or on-chain cost experiment.

## Live Fabric/FISCO path

The live path never falls back to generated evidence. It requires both chains, two FISCO contracts and correctly seeded business records.

1. Deploy the dedicated contracts:

```bash
npm run deploy:semantic-audit-anchor
npm run deploy:supply-chain-evidence
```

2. Put the returned addresses in the enabled FISCO chain configuration:

```json
{
  "contracts": {
    "semanticAuditAnchor": "0x...",
    "supplyChainEvidence": "0x..."
  }
}
```

3. Seed one matching Fabric/FISCO workload:

```bash
npm run exp:semantic-query:seed -- \
  --batch BATCH-FINANCE-001 \
  --supplier SUPPLIER-001 \
  --order ORDER-001
```

4. Execute and anchor one live query:

```bash
npm run exp:semantic-query:live -- \
  --batch BATCH-FINANCE-001 \
  --supplier SUPPLIER-001 \
  --order ORDER-001
```

The Fabric adapter evaluates `GetOrchardRecord` and selects the order and invoice subdocuments. The FISCO adapter calls `SupplyChainEvidenceRegistry.getRecord` for identity and logistics. The engine then executes the DAG, persists the normalized receipt and submits its root to `SemanticQueryAuditAnchor`.

The current Fabric evidence locator records the gateway-evaluation height and state resource, not a Fabric transaction inclusion proof. This limitation must remain explicit in the paper.
