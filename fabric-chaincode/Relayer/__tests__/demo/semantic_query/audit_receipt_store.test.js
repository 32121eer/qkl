const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildAuditReceipt, verifyAuditReceipt, hashValue } = require('../../../demo/semantic_query/audit_receipt');
const { SemanticAuditStore } = require('../../../demo/semantic_query/audit_store');

function sampleReceipt(queryId = 'query-audit-1') {
    return buildAuditReceipt({
        queryId,
        queryDigest: hashValue({ predicate: 'eligible' }),
        dagVersion: 'dag-v1',
        rootNodeId: 'root',
        terminalState: 'ANCHORED',
        outcome: 'SATISFIED',
        nodes: [
            {
                id: 'source', kind: 'evidence', deps: [], output: { amount: 10 },
                status: 'SUCCEEDED', version: 'adapter-v1', attemptCount: 1
            },
            {
                id: 'root', kind: 'root', deps: ['source'], output: { outcome: 'SATISFIED' },
                status: 'SUCCEEDED', version: 'policy-v1', attemptCount: 1
            }
        ],
        evidence: [{ evidenceId: 'ev-1', nodeId: 'source', payloadHash: hashValue({ amount: 10 }) }],
        serviceOutputs: [],
        events: [{ seq: 0, type: 'QUERY_STATE', state: 'CREATED' }],
        startedAt: '2026-08-24T00:00:00.000Z',
        completedAt: '2026-08-24T00:00:01.000Z'
    });
}

describe('semantic audit receipt and store', () => {
    let tempDir;
    let store;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'semantic-audit-test-'));
        store = new SemanticAuditStore({ dbPath: path.join(tempDir, 'audit.db') });
    });

    afterEach(async () => {
        if (store) await store.close();
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test('persists, reconstructs and verifies a normalized receipt', async () => {
        const receipt = sampleReceipt();
        await store.saveReceipt(receipt, {
            anchorId: 'local:1', chainId: 'LOCAL_TEST_ANCHOR', txHash: '0xtest', mode: 'local-test-anchor'
        });

        const reconstructed = await store.loadReceipt(receipt.queryId);
        expect(reconstructed).toEqual(receipt);
        await expect(store.verifyStoredReceipt(receipt.queryId, receipt.receiptRoot)).resolves.toMatchObject({ ok: true });
        await expect(store.listAnchors(receipt.queryId)).resolves.toEqual([
            expect.objectContaining({ anchorId: 'local:1', receiptRoot: receipt.receiptRoot })
        ]);
    });

    test('detects and localizes a modified node', () => {
        const receipt = sampleReceipt();
        const tampered = JSON.parse(JSON.stringify(receipt));
        tampered.nodes.find((node) => node.nodeId === 'source').outputHash = hashValue({ amount: 999 });

        const result = verifyAuditReceipt(tampered, { anchoredRoot: receipt.receiptRoot });
        expect(result.ok).toBe(false);
        expect(result.issues).toEqual(expect.arrayContaining([
            expect.objectContaining({ code: 'RECEIPT_ROOT_MISMATCH' }),
            expect.objectContaining({ code: 'NODE_HASH_MISMATCH', nodeId: 'source' })
        ]));
    });

    test('produces the same root regardless of input node ordering', () => {
        const receipt = sampleReceipt('stable-1');
        const reordered = buildAuditReceipt({
            ...receipt,
            nodes: receipt.nodes.slice().reverse().map((node) => ({ ...node, nodeHash: undefined })),
            evidence: receipt.evidence.map((record) => ({ ...record, evidenceHash: undefined })),
            receiptRoot: undefined
        });
        expect(reordered.receiptRoot).toBe(receipt.receiptRoot);
    });

    test('serializes concurrent transactional receipt writes', async () => {
        const receipts = Array.from({ length: 8 }, (_, index) => sampleReceipt(`concurrent-${index}`));
        await Promise.all(receipts.map((receipt, index) => store.saveReceipt(receipt, {
            anchorId: `local:${index}`,
            chainId: 'LOCAL_TEST_ANCHOR',
            txHash: `0x${index}`,
            mode: 'local-test-anchor'
        })));

        const reconstructed = await Promise.all(receipts.map((receipt) => store.loadReceipt(receipt.queryId)));
        expect(reconstructed).toEqual(receipts);
    });
});
