# Verifiable Cross-Chain Query Prototype Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a first-stage verifiable cross-chain query prototype for the existing FISCO -> Fabric orchard query flow, including query object generation, commitment generation, proof bundle generation, verification, API exposure, and UI display.

**Architecture:** Keep the current demo query flow intact and layer the new capability alongside it. Implement proof generation and verification in new focused modules under `fabric-chaincode/Relayer/demo/query/`, attach proof fields to query sessions, expose proof summaries via existing API routes, and render proof state in `AppQueryPage.jsx`. Use Jest for backend automated tests and manual UI acceptance for the frontend.

**Tech Stack:** Node.js, Jest, existing Relayer demo services, React/Vite frontend, SQLite/memory session stores

---

## Chunk 1: File Structure And Boundaries

### Task 1: Lock file structure before implementation

**Files:**
- Create: `fabric-chaincode/Relayer/demo/query/query_types.js`
- Create: `fabric-chaincode/Relayer/demo/query/query_object.js`
- Create: `fabric-chaincode/Relayer/demo/query/query_commitment.js`
- Create: `fabric-chaincode/Relayer/demo/query/query_proof_builder.js`
- Create: `fabric-chaincode/Relayer/demo/query/query_verifier.js`
- Create: `fabric-chaincode/Relayer/__tests__/demo/query/query_object.test.js`
- Create: `fabric-chaincode/Relayer/__tests__/demo/query/query_commitment.test.js`
- Create: `fabric-chaincode/Relayer/__tests__/demo/query/query_proof_builder.test.js`
- Create: `fabric-chaincode/Relayer/__tests__/demo/query/query_verifier.test.js`

- [ ] **Step 1: Create the query module directory and constants file**

Expected responsibility split:
- `query_types.js`: field names, version constants, witness type constants
- `query_object.js`: normalize orchard batch query into stable `Q`
- `query_commitment.js`: stable serialization + hash for `C_Q`
- `query_proof_builder.js`: build `query-proof-v1`
- `query_verifier.js`: verify proof bundle self-consistency

- [ ] **Step 2: Create empty Jest test files for each new module**

Run: `cd /home/tr/projects/cross-chain/fabric-chaincode/Relayer && npx jest --listTests`
Expected: test runner lists the four new query test files once they exist

- [ ] **Step 3: Commit structure-only scaffold**

```bash
git add fabric-chaincode/Relayer/demo/query fabric-chaincode/Relayer/__tests__/demo/query
git commit -m "test: scaffold verifiable query modules and tests"
```

## Chunk 2: Query Object And Commitment Core

### Task 2: Implement query object normalization with tests first

**Files:**
- Modify: `fabric-chaincode/Relayer/demo/query/query_types.js`
- Modify: `fabric-chaincode/Relayer/demo/query/query_object.js`
- Test: `fabric-chaincode/Relayer/__tests__/demo/query/query_object.test.js`

- [ ] **Step 1: Write failing tests for query object normalization**

Required cases:
- same batch ID => same query object
- different batch ID => different `key`
- required fields exist
- invalid batch ID => clear error or explicit fallback

- [ ] **Step 2: Run query object tests and verify failure**

Run: `cd /home/tr/projects/cross-chain/fabric-chaincode/Relayer && npx jest __tests__/demo/query/query_object.test.js --runInBand`
Expected: FAIL because module is not implemented

- [ ] **Step 3: Implement `buildQueryObject()` minimally**

Required output shape:

```js
{
  chainId: 'FABRIC_NET_01',
  namespace: 'orchard',
  key: `batch:${orchardBatchId}`,
  queryType: 'single-key-read',
  codec: 'json',
  context: {
    channel: 'mychannel',
    chaincode: 'gateway_cc',
    schema: 'orchard-record-v1'
  }
}
```

- [ ] **Step 4: Re-run query object tests**

Run: `cd /home/tr/projects/cross-chain/fabric-chaincode/Relayer && npx jest __tests__/demo/query/query_object.test.js --runInBand`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add fabric-chaincode/Relayer/demo/query/query_types.js \
        fabric-chaincode/Relayer/demo/query/query_object.js \
        fabric-chaincode/Relayer/__tests__/demo/query/query_object.test.js
git commit -m "feat: add query object normalization"
```

### Task 3: Implement query commitment generation with tests first

**Files:**
- Modify: `fabric-chaincode/Relayer/demo/query/query_commitment.js`
- Test: `fabric-chaincode/Relayer/__tests__/demo/query/query_commitment.test.js`

- [ ] **Step 1: Write failing tests for commitment generation**

Required cases:
- same inputs => same commitment
- result change => different commitment
- source height change => different commitment
- query object change => different commitment

- [ ] **Step 2: Run commitment tests and verify failure**

Run: `cd /home/tr/projects/cross-chain/fabric-chaincode/Relayer && npx jest __tests__/demo/query/query_commitment.test.js --runInBand`
Expected: FAIL because module is not implemented

- [ ] **Step 3: Implement stable serialization + sha256 commitment**

Required exported API:
- `stableStringify(value)`
- `buildQueryCommitment({ queryObject, sourceHeight, sourceHeaderHash, resultValue, meta })`

- [ ] **Step 4: Re-run commitment tests**

Run: `cd /home/tr/projects/cross-chain/fabric-chaincode/Relayer && npx jest __tests__/demo/query/query_commitment.test.js --runInBand`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add fabric-chaincode/Relayer/demo/query/query_commitment.js \
        fabric-chaincode/Relayer/__tests__/demo/query/query_commitment.test.js
git commit -m "feat: add query commitment generator"
```

## Chunk 3: Proof Builder And Verifier

### Task 4: Implement proof bundle builder with tests first

**Files:**
- Modify: `fabric-chaincode/Relayer/demo/query/query_proof_builder.js`
- Test: `fabric-chaincode/Relayer/__tests__/demo/query/query_proof_builder.test.js`

- [ ] **Step 1: Write failing tests for proof bundle builder**

Required cases:
- output includes all required fields
- version is `query-proof-v1`
- `stateWitness.type === 'record-snapshot'`
- commitment matches builder inputs
- missing header or result throws clear error

- [ ] **Step 2: Run proof builder tests and verify failure**

Run: `cd /home/tr/projects/cross-chain/fabric-chaincode/Relayer && npx jest __tests__/demo/query/query_proof_builder.test.js --runInBand`
Expected: FAIL because module is not implemented

- [ ] **Step 3: Implement `buildQueryProof()` minimally**

Required fields:

```js
{
  version: 'query-proof-v1',
  queryObject,
  resultValue,
  sourceChain,
  sourceHeight,
  sourceHeader,
  sourceHeaderHash,
  stateWitness: {
    type: 'record-snapshot',
    recordHash,
    sourceFunction: 'GetOrchardRecord',
    note: 'prototype witness, not full merkle proof'
  },
  meta,
  commitment
}
```

- [ ] **Step 4: Re-run proof builder tests**

Run: `cd /home/tr/projects/cross-chain/fabric-chaincode/Relayer && npx jest __tests__/demo/query/query_proof_builder.test.js --runInBand`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add fabric-chaincode/Relayer/demo/query/query_proof_builder.js \
        fabric-chaincode/Relayer/__tests__/demo/query/query_proof_builder.test.js
git commit -m "feat: add query proof bundle builder"
```

### Task 5: Implement verifier with tests first

**Files:**
- Modify: `fabric-chaincode/Relayer/demo/query/query_verifier.js`
- Test: `fabric-chaincode/Relayer/__tests__/demo/query/query_verifier.test.js`

- [ ] **Step 1: Write failing tests for verifier**

Required cases:
- valid proof => `ok: true`
- query object tampered => `queryObjectMatched: false`
- header hash tampered => `headerMatched: false`
- result hash tampered => `stateWitnessMatched: false`
- commitment tampered => `commitmentMatched: false`

- [ ] **Step 2: Run verifier tests and verify failure**

Run: `cd /home/tr/projects/cross-chain/fabric-chaincode/Relayer && npx jest __tests__/demo/query/query_verifier.test.js --runInBand`
Expected: FAIL because module is not implemented

- [ ] **Step 3: Implement `verifyQueryProof()` minimally**

Required return shape:

```js
{
  ok,
  checks: {
    queryObjectMatched,
    headerMatched,
    stateWitnessMatched,
    commitmentMatched
  },
  commitment,
  verifiedAt
}
```

- [ ] **Step 4: Re-run verifier tests**

Run: `cd /home/tr/projects/cross-chain/fabric-chaincode/Relayer && npx jest __tests__/demo/query/query_verifier.test.js --runInBand`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add fabric-chaincode/Relayer/demo/query/query_verifier.js \
        fabric-chaincode/Relayer/__tests__/demo/query/query_verifier.test.js
git commit -m "feat: add query proof verifier"
```

## Chunk 4: Integrate With Query Sessions And API

### Task 6: Extend QueryBroker to generate and verify proofs

**Files:**
- Modify: `fabric-chaincode/Relayer/demo/broker/query_broker.js`
- Modify: `fabric-chaincode/Relayer/demo/session/query_session_service.js`
- Modify: `fabric-chaincode/Relayer/demo/session/query_session_model.js`
- Test: `fabric-chaincode/Relayer/__tests__/demo/query/query_broker_proof.test.js`

- [ ] **Step 1: Write failing integration test for successful proof generation**

Required assertions:
- session gets `queryObject`
- session gets `queryCommitment`
- session gets `queryProof`
- session gets `queryVerifyStatus: PASS`

- [ ] **Step 2: Write failing integration test for proof mismatch**

Required assertions:
- tampered proof => `queryVerifyStatus` becomes `FAILED` or `MISMATCH`
- original query session still completes business flow

- [ ] **Step 3: Run integration tests and verify failure**

Run: `cd /home/tr/projects/cross-chain/fabric-chaincode/Relayer && npx jest __tests__/demo/query/query_broker_proof.test.js --runInBand`
Expected: FAIL because proof integration is missing

- [ ] **Step 4: Modify QueryBroker to generate proof after `A_CHAIN_FETCHED`**

Required behavior:
- build `Q`
- acquire source header context from existing relay/query data or a dedicated helper
- build proof bundle
- verify proof bundle
- patch session with proof fields

- [ ] **Step 5: Update query session model/service to accept proof fields**

Required fields:
- `queryObject`
- `queryCommitment`
- `queryProof`
- `queryVerifyStatus`
- `queryVerifyChecks`
- `queryProofVersion`

- [ ] **Step 6: Re-run integration test**

Run: `cd /home/tr/projects/cross-chain/fabric-chaincode/Relayer && npx jest __tests__/demo/query/query_broker_proof.test.js --runInBand`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add fabric-chaincode/Relayer/demo/broker/query_broker.js \
        fabric-chaincode/Relayer/demo/session/query_session_service.js \
        fabric-chaincode/Relayer/demo/session/query_session_model.js \
        fabric-chaincode/Relayer/__tests__/demo/query/query_broker_proof.test.js
git commit -m "feat: attach query proof data to query sessions"
```

### Task 7: Expose proof data from API routes

**Files:**
- Modify: `fabric-chaincode/Relayer/demo/api/routes_query.js`
- Modify: `fabric-chaincode/Relayer/demo/api/routes_proof_cards.js`
- Test: `fabric-chaincode/Relayer/__tests__/demo/query/query_api_proof.test.js`

- [ ] **Step 1: Write failing API test for query detail response**

Required assertions:
- response contains `queryObject`
- response contains `queryCommitment`
- response contains `queryVerifyStatus`
- response contains `queryVerifyChecks`

- [ ] **Step 2: Write failing API test for proof-card summary**

Required assertions:
- proof card endpoint includes query-proof summary or compatible shape

- [ ] **Step 3: Run API tests and verify failure**

Run: `cd /home/tr/projects/cross-chain/fabric-chaincode/Relayer && npx jest __tests__/demo/query/query_api_proof.test.js --runInBand`
Expected: FAIL because API fields are missing

- [ ] **Step 4: Modify routes to expose proof summaries**

Constraint:
- avoid returning oversized raw proof JSON by default
- include enough fields for the frontend to render status + summary

- [ ] **Step 5: Re-run API tests**

Run: `cd /home/tr/projects/cross-chain/fabric-chaincode/Relayer && npx jest __tests__/demo/query/query_api_proof.test.js --runInBand`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add fabric-chaincode/Relayer/demo/api/routes_query.js \
        fabric-chaincode/Relayer/demo/api/routes_proof_cards.js \
        fabric-chaincode/Relayer/__tests__/demo/query/query_api_proof.test.js
git commit -m "feat: expose query proof summary through demo api"
```

## Chunk 5: UI Display And End-to-End Verification

### Task 8: Render proof summary in AppQueryPage

**Files:**
- Modify: `demo-ui/src/pages/AppQueryPage.jsx`
- Modify: `demo-ui/src/styles.css`

- [ ] **Step 1: Add UI design for proof summary block**

Must render:
- query object summary
- commitment summary
- source height / header hash
- verify status
- detailed check results
- prototype witness label

- [ ] **Step 2: Ensure UI distinguishes business success from proof success**

Required behavior:
- query can be completed while proof status still displays separately
- proof failure should not be hidden by overall success badge

- [ ] **Step 3: Build frontend**

Run: `cd /home/tr/projects/cross-chain/demo-ui && npm run build`
Expected: build succeeds with no syntax errors

- [ ] **Step 4: Commit**

```bash
git add demo-ui/src/pages/AppQueryPage.jsx demo-ui/src/styles.css
git commit -m "feat: display query proof summary in app query page"
```

### Task 9: Run regression and manual acceptance checks

**Files:**
- Verify only

- [ ] **Step 1: Run all new backend query proof tests**

Run:

```bash
cd /home/tr/projects/cross-chain/fabric-chaincode/Relayer
npx jest __tests__/demo/query --runInBand
```

Expected: PASS

- [ ] **Step 2: Run existing relayer test suite if stable**

Run:

```bash
cd /home/tr/projects/cross-chain/fabric-chaincode/Relayer
npm test -- --runInBand
```

Expected: PASS, or if unrelated failures exist, document them explicitly

- [ ] **Step 3: Build frontend again**

Run:

```bash
cd /home/tr/projects/cross-chain/demo-ui
npm run build
```

Expected: PASS

- [ ] **Step 4: Manual acceptance - successful query**

Run:

```bash
cd /home/tr/projects/cross-chain
bash scripts/start-demo.sh
```

Then verify in browser:
- `/app-query` can submit a valid batch ID
- session completes
- proof summary renders
- proof status shows PASS

- [ ] **Step 5: Manual acceptance - tampered proof**

Procedure:
- use dev-only hook, fixture, or temporary patch to alter `resultValue` or `queryObject`
- reload the query detail

Expected:
- proof check fails
- UI shows FAILED or MISMATCH
- proof failure is visible separately from business status

- [ ] **Step 6: Commit final verified state**

```bash
git add .
git commit -m "feat: add verifiable cross-chain query prototype"
```

## Notes For Implementers

- Do not silently label prototype witness as full state proof.
- Do not block the original query flow on proof generation unless explicitly required.
- Prefer storing proof summaries in session/API responses; keep full proof payload optional.
- If source header acquisition is not directly available from current query path, add a dedicated helper rather than embedding ad hoc logic in `query_broker.js`.

Plan complete and saved to `docs/superpowers/plans/2026-03-27-verifiable-cross-chain-query-prototype.md`. Ready to execute?
