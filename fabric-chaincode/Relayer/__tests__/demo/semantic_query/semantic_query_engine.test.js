const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SemanticAuditStore } = require('../../../demo/semantic_query/audit_store');
const { DagScheduler } = require('../../../demo/semantic_query/dag_scheduler');
const { LocalReceiptAnchor } = require('../../../demo/semantic_query/receipt_anchor');
const { SemanticQueryEngine } = require('../../../demo/semantic_query/semantic_query_engine');
const { createSupplyFinanceDag } = require('../../../demo/semantic_query/supply_finance_workload');

describe('SemanticQueryEngine', () => {
    let tempDir;
    let store;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'semantic-engine-test-'));
        store = new SemanticAuditStore({ dbPath: path.join(tempDir, 'audit.db') });
    });

    afterEach(async () => {
        await store.close();
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test('executes, anchors, persists and verifies one complete query', async () => {
        const engine = new SemanticQueryEngine({
            scheduler: new DagScheduler({ concurrency: 4, deadlineMs: 1000, defaultTimeoutMs: 100 }),
            auditStore: store,
            receiptAnchor: new LocalReceiptAnchor()
        });
        const result = await engine.execute({
            queryId: 'engine-query-1',
            queryDefinition: { predicate: 'supply-chain-financing-eligible' },
            dagVersion: 'supply-finance-dag-v1',
            nodes: createSupplyFinanceDag({ serviceDelayMs: 0 }),
            rootNodeId: 'financing_root'
        });

        expect(result.execution).toMatchObject({ terminalState: 'READY_TO_ANCHOR', outcome: 'SATISFIED' });
        expect(result.receipt).toMatchObject({ terminalState: 'ANCHORED', outcome: 'SATISFIED' });
        expect(result.anchor.mode).toBe('local-test-anchor');
        expect(result.verification.ok).toBe(true);
        expect(result.receipt.evidence).toHaveLength(5);
        expect(new Set(result.receipt.evidence.map((item) => item.nodeId))).toEqual(new Set([
            'identity_fisco', 'order_fabric', 'invoice_fabric', 'logistics_fisco', 'quality_document'
        ]));
        expect(result.receipt.serviceOutputs).toEqual([
            expect.objectContaining({ nodeId: 'quality_semantic' })
        ]);
        await expect(store.loadReceipt('engine-query-1')).resolves.toEqual(result.receipt);
    });

    test('does not claim persistence success when anchoring fails', async () => {
        const engine = new SemanticQueryEngine({
            scheduler: new DagScheduler({ deadlineMs: 1000, defaultTimeoutMs: 100 }),
            auditStore: store,
            receiptAnchor: { anchor: async () => { throw new Error('chain unavailable'); } }
        });

        await expect(engine.execute({
            queryId: 'engine-anchor-failure',
            queryDefinition: { predicate: 'supply-chain-financing-eligible' },
            dagVersion: 'supply-finance-dag-v1',
            nodes: createSupplyFinanceDag({ serviceDelayMs: 0 }),
            rootNodeId: 'financing_root'
        })).rejects.toMatchObject({ code: 'RECEIPT_ANCHOR_FAILED' });
        await expect(store.loadReceipt('engine-anchor-failure')).resolves.toBeNull();
    });

    test('preserves receipt and anchor context when persistence fails after anchoring', async () => {
        const anchor = new LocalReceiptAnchor();
        const failingStore = {
            saveReceipt: async () => { throw new Error('database unavailable'); },
            verifyStoredReceipt: jest.fn()
        };
        const engine = new SemanticQueryEngine({
            scheduler: new DagScheduler({ deadlineMs: 1000, defaultTimeoutMs: 100 }),
            auditStore: failingStore,
            receiptAnchor: anchor
        });

        let failure;
        try {
            await engine.execute({
                queryId: 'engine-persistence-failure',
                queryDefinition: { predicate: 'supply-chain-financing-eligible' },
                dagVersion: 'supply-finance-dag-v1',
                nodes: createSupplyFinanceDag({ serviceDelayMs: 0 }),
                rootNodeId: 'financing_root'
            });
        } catch (error) {
            failure = error;
        }

        expect(failure).toMatchObject({
            code: 'AUDIT_PERSISTENCE_FAILED',
            execution: expect.objectContaining({ outcome: 'SATISFIED' }),
            receipt: expect.objectContaining({
                queryId: 'engine-persistence-failure',
                terminalState: 'ANCHORED'
            }),
            anchor: expect.objectContaining({ mode: 'local-test-anchor' })
        });
        expect(failingStore.verifyStoredReceipt).not.toHaveBeenCalled();
    });
});
