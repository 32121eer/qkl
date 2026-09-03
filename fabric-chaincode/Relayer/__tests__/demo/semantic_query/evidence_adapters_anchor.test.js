const { FabricEvidenceAdapter, FiscoEvidenceAdapter } = require('../../../demo/semantic_query/evidence_adapters');
const { buildAuditReceipt, hashValue } = require('../../../demo/semantic_query/audit_receipt');
const {
    LocalReceiptAnchor,
    FiscoReceiptAnchor,
    FiscoReceiptAnchorPool,
    TERMINAL_STATE_CODES,
    OUTCOME_CODES
} = require('../../../demo/semantic_query/receipt_anchor');
const { DagScheduler } = require('../../../demo/semantic_query/dag_scheduler');
const { createSupplyFinanceDag } = require('../../../demo/semantic_query/supply_finance_workload');

function receipt() {
    return buildAuditReceipt({
        queryId: 'query-anchor-1',
        queryDigest: hashValue({ predicate: 'eligible' }),
        dagVersion: 'dag-v1',
        rootNodeId: 'root',
        terminalState: 'ANCHORED',
        outcome: 'SATISFIED',
        nodes: [{ id: 'root', kind: 'root', deps: [], output: true, status: 'SUCCEEDED', version: 'v1' }]
    });
}

describe('real-chain evidence adapter boundary', () => {
    test('normalizes Fabric gateway output with an observed ledger height', async () => {
        const evaluate = jest.fn().mockResolvedValue(Buffer.from(JSON.stringify({
            payload: { data: { order: { orderId: 'O-1', amount: 10 } } }
        })));
        const adapter = new FabricEvidenceAdapter({
            evaluate,
            getLatestBlockNumber: async () => 88,
            chainId: 'FABRIC_NET_01',
            channelName: 'mychannel',
            chaincodeName: 'gateway_cc',
            issuer: 'Org1MSP'
        });

        const result = await adapter.fetch({
            queryId: 'q-fabric',
            functionName: 'GetOrder',
            args: ['O-1'],
            resource: 'order:O-1',
            payloadPath: 'payload.data.order',
            predicateBinding: 'invoice.amount<=order.amount',
            candidate: 'fabric-peer-0'
        });

        expect(result.value).toEqual({ orderId: 'O-1', amount: 10 });
        expect(result.evidence).toMatchObject({
            queryId: 'q-fabric',
            sourceChain: 'FABRIC_NET_01:mychannel',
            sourceType: 'FABRIC_STATE',
            issuer: 'Org1MSP',
            finality: { committed: true, blockNumber: 88 },
            locator: {
                chaincode: 'gateway_cc', function: 'GetOrder', resource: 'order:O-1',
                payloadPath: 'payload.data.order'
            }
        });
        expect(evaluate).toHaveBeenCalledWith(expect.objectContaining({ candidate: 'fabric-peer-0' }));
    });

    test('normalizes a FISCO contract call and preserves the contract locator', async () => {
        const callContract = jest.fn().mockResolvedValue(JSON.stringify({ orderId: 'O-1', status: 'DELIVERED' }));
        const adapter = new FiscoEvidenceAdapter({
            callContract,
            getLatestBlockNumber: async () => 120,
            chainId: 'FISCO_NET_01',
            groupId: 'group0'
        });

        const result = await adapter.fetch({
            queryId: 'q-fisco',
            contractName: 'LogisticsRegistry',
            contractAddress: '0x0000000000000000000000000000000000000011',
            functionName: 'getLogistics',
            args: ['O-1'],
            predicateBinding: 'delivered_on_time',
            candidate: 'fisco-node-0'
        });

        expect(result.value.status).toBe('DELIVERED');
        expect(result.evidence).toMatchObject({
            sourceChain: 'FISCO_NET_01:group0',
            sourceType: 'FISCO_CONTRACT_STATE',
            finality: { committed: true, blockNumber: 120 },
            locator: {
                contractName: 'LogisticsRegistry',
                contractAddress: '0x0000000000000000000000000000000000000011',
                function: 'getLogistics'
            }
        });
    });

    test('passes normalized adapter evidence into scheduler artifacts', async () => {
        const fabric = new FabricEvidenceAdapter({
            evaluate: async ({ functionName }) => {
                if (functionName === 'GetOrder') {
                    return JSON.stringify({ orderId: 'ORDER-001', amount: 125000, currency: 'CNY', dueDate: '2026-08-20' });
                }
                return JSON.stringify({ invoiceId: 'INV-001', orderId: 'ORDER-001', amount: 125000, currency: 'CNY' });
            },
            getLatestBlockNumber: async () => 90
        });
        const fisco = new FiscoEvidenceAdapter({
            callContract: async ({ functionName }) => {
                if (functionName === 'getIdentity') {
                    return { companyId: 'SUPPLIER-001', active: true, creditEligible: true };
                }
                return { orderId: 'ORDER-001', deliveredAt: '2026-08-18', status: 'DELIVERED' };
            },
            getLatestBlockNumber: async () => 121
        });
        const evidenceQueries = {
            identity: {
                contractName: 'IdentityRegistry', contractAddress: '0x0000000000000000000000000000000000000010',
                functionName: 'getIdentity', args: ['SUPPLIER-001']
            },
            order: { functionName: 'GetOrder', args: ['ORDER-001'] },
            invoice: { functionName: 'GetInvoice', args: ['INV-001'] },
            logistics: {
                contractName: 'LogisticsRegistry', contractAddress: '0x0000000000000000000000000000000000000011',
                functionName: 'getLogistics', args: ['ORDER-001']
            }
        };
        const scheduler = new DagScheduler({ concurrency: 4, deadlineMs: 1000, defaultTimeoutMs: 100 });
        const result = await scheduler.execute({
            queryId: 'adapter-dag-query',
            nodes: createSupplyFinanceDag({ adapters: { fabric, fisco }, evidenceQueries, serviceDelayMs: 0 }),
            rootNodeId: 'financing_root'
        });

        expect(result.terminalState).toBe('READY_TO_ANCHOR');
        expect(result.outcome).toBe('SATISFIED');
        expect(result.artifacts.order_fabric.evidence.sourceType).toBe('FABRIC_STATE');
        expect(result.artifacts.logistics_fisco.evidence.sourceType).toBe('FISCO_CONTRACT_STATE');
    });
});

describe('receipt anchoring boundary', () => {
    test('creates a clearly labelled local test anchor', async () => {
        await expect(new LocalReceiptAnchor().anchor(receipt())).resolves.toMatchObject({
            chainId: 'LOCAL_TEST_ANCHOR', mode: 'local-test-anchor', blockHeight: null
        });
    });

    test('submits the exact receipt commitment through the FISCO anchor contract', async () => {
        const wait = jest.fn().mockResolvedValue({ blockNumber: 456, gasUsed: 32100n });
        const anchorReceipt = jest.fn().mockResolvedValue({ hash: '0xtx', wait });
        const anchorer = new FiscoReceiptAnchor({ contract: { anchorReceipt }, chainId: 'FISCO_NET_01' });
        const auditReceipt = receipt();

        const result = await anchorer.anchor(auditReceipt);

        expect(anchorReceipt).toHaveBeenCalledWith(
            hashValue(auditReceipt.queryId),
            auditReceipt.queryDigest,
            auditReceipt.receiptRoot,
            TERMINAL_STATE_CODES.ANCHORED,
            OUTCOME_CODES.SATISFIED
        );
        expect(wait).toHaveBeenCalledWith(1);
        expect(result).toMatchObject({
            chainId: 'FISCO_NET_01', txHash: '0xtx', blockHeight: 456,
            gasUsed: '32100', mode: 'fisco-contract-anchor'
        });
    });

    test('serializes concurrent transactions from the same FISCO wallet', async () => {
        let active = 0;
        let maxActive = 0;
        let blockNumber = 500;
        const anchorReceipt = jest.fn().mockImplementation(async () => {
            active += 1;
            maxActive = Math.max(maxActive, active);
            await new Promise((resolve) => setTimeout(resolve, 5));
            active -= 1;
            blockNumber += 1;
            return {
                hash: `0xtx${blockNumber}`,
                wait: async () => ({ blockNumber, gasUsed: 35166n })
            };
        });
        const anchorer = new FiscoReceiptAnchor({ contract: { anchorReceipt }, chainId: 'FISCO_NET_01' });

        const results = await Promise.all([
            anchorer.anchor(receipt()),
            anchorer.anchor(receipt()),
            anchorer.anchor(receipt())
        ]);

        expect(maxActive).toBe(1);
        expect(results).toHaveLength(3);
        expect(results[1].queueWaitMs).toBeGreaterThan(0);
        expect(results.every((item) => item.serviceMs > 0)).toBe(true);
    });

    test('dispatches concurrent anchors round-robin across independent wallet anchors', async () => {
        const active = [0, 0];
        const maxActive = [0, 0];
        const makeAnchor = (index) => ({
            anchor: jest.fn(async () => {
                active[index] += 1;
                maxActive[index] = Math.max(maxActive[index], active[index]);
                await new Promise((resolve) => setTimeout(resolve, 5));
                active[index] -= 1;
                return { txHash: `0xtx-${index}` };
            })
        });
        const pool = new FiscoReceiptAnchorPool({
            anchors: [makeAnchor(0), makeAnchor(1)],
            signerAddresses: ['0xwallet0', '0xwallet1']
        });

        const results = await Promise.all(Array.from({ length: 4 }, () => pool.anchor(receipt())));

        expect(results.map((item) => item.anchorPoolIndex)).toEqual([0, 1, 0, 1]);
        expect(results.map((item) => item.anchorSigner)).toEqual([
            '0xwallet0', '0xwallet1', '0xwallet0', '0xwallet1'
        ]);
        expect(maxActive).toEqual([2, 2]);
    });
});
