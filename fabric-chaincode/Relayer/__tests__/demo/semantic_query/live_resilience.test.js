const {
    correlatedFailureVerified,
    failoverVerified,
    materialFailureVerified,
    parseArgs,
    primaryProbeVerified,
    resultsCsv,
    summarize,
    waitForFiscoResync
} = require('../../../demo/semantic_query/experiments/run_live_resilience');

function result({ terminalState = 'ANCHORED', outcome = 'SATISFIED', nodes = [], verified = true } = {}) {
    return {
        receipt: { terminalState, outcome },
        execution: { nodes },
        verification: { ok: verified }
    };
}

describe('live resilience experiment helpers', () => {
    test('parses defaults and rejects unsafe node selections', () => {
        expect(parseArgs([])).toMatchObject({
            repetitions: 1,
            scenarios: [
                'fabric_network_partition',
                'fisco_node_resync',
                'fisco_correlated_pause',
                'material_store_outage',
                'audit_store_outage'
            ],
            fabricNetwork: 'fabric_test',
            fiscoPrimaryNode: 'node0',
            fiscoSecondaryNode: 'node1'
        });
        expect(() => parseArgs(['--repetitions', '0'])).toThrow('positive integer');
        expect(() => parseArgs(['--fisco-primary-node', 'node2', '--fisco-secondary-node', 'node2']))
            .toThrow('must differ');
    });

    test('checks physical failover and post-recovery primary endpoints', () => {
        const fabric = result({ nodes: [
            { nodeId: 'order_fabric', status: 'SUCCEEDED', attemptCount: 2, endpoint: 'fabric-peer-1' },
            { nodeId: 'invoice_fabric', status: 'SUCCEEDED', attemptCount: 2, endpoint: 'fabric-peer-1' }
        ] });
        expect(failoverVerified(fabric, 'fabric')).toBe(true);

        const fisco = result({ nodes: [
            { nodeId: 'identity_fisco', status: 'SUCCEEDED', attemptCount: 2, endpoint: 'fisco-node-1' },
            { nodeId: 'logistics_fisco', status: 'SUCCEEDED', attemptCount: 2, endpoint: 'fisco-node-1' }
        ] });
        expect(failoverVerified(fisco, 'fisco')).toBe(true);

        const probe = result({ nodes: [
            { nodeId: 'order_fabric', status: 'SUCCEEDED', attemptCount: 1, endpoint: 'fabric-peer-0' },
            { nodeId: 'invoice_fabric', status: 'SUCCEEDED', attemptCount: 1, endpoint: 'fabric-peer-0' },
            { nodeId: 'identity_fisco', status: 'SUCCEEDED', attemptCount: 1, endpoint: 'fisco-node-0' },
            { nodeId: 'logistics_fisco', status: 'SUCCEEDED', attemptCount: 1, endpoint: 'fisco-node-0' }
        ] });
        expect(primaryProbeVerified(probe)).toBe(true);
    });

    test('requires both correlated FISCO branches to terminate and the receipt to verify', () => {
        const failed = result({
            terminalState: 'FAILED',
            outcome: null,
            nodes: [
                { nodeId: 'identity_fisco', status: 'FAILED', attemptCount: 2, endpoint: 'fisco-node-1' },
                { nodeId: 'logistics_fisco', status: 'FAILED', attemptCount: 2, endpoint: 'fisco-node-1' }
            ]
        });
        expect(correlatedFailureVerified(failed)).toBe(true);
        failed.verification.ok = false;
        expect(correlatedFailureVerified(failed)).toBe(false);
    });

    test('requires material-store failure to end conservatively with an auditable receipt', () => {
        const failed = result({
            terminalState: 'FAILED',
            outcome: null,
            nodes: [{
                nodeId: 'quality_document', status: 'FAILED', attemptCount: 1,
                endpoint: 'document-store-0', errorCode: 'MATERIAL_STORE_UNAVAILABLE'
            }]
        });
        expect(materialFailureVerified(failed)).toBe(true);
        failed.execution.nodes[0].errorCode = 'OTHER_ERROR';
        expect(materialFailureVerified(failed)).toBe(false);
    });

    test('polls until a resumed FISCO node reaches the reference height', async () => {
        const heights = [8, 9, 10];
        const readHeight = jest.fn(async (endpoint) => {
            if (endpoint === 'reference') return 10;
            return heights.shift();
        });
        const resync = await waitForFiscoResync({
            primaryEndpoint: 'primary',
            referenceEndpoint: 'reference',
            timeoutMs: 100,
            pollMs: 0,
            readHeight
        });
        expect(resync).toMatchObject({ synchronized: true, primaryHeight: 10, referenceHeight: 10, attempts: 3 });
    });

    test('summarizes expected behavior and emits a flat CSV', () => {
        const rows = [{
            scenario: 'audit_store_outage', repetition: 0, queryId: 'q1', totalMs: 500,
            scenarioVerified: true,
            result: { terminalState: 'ANCHORED', outcome: 'SATISFIED', auditVerified: true, anchorBlockHeight: 7 },
            probe: null,
            recovery: { persistenceRecovered: true },
            error: null
        }];
        expect(summarize(rows, ['audit_store_outage']).audit_store_outage).toMatchObject({
            repetitions: 1,
            completed: 1,
            expectedBehavior: 1,
            auditVerified: 1,
            p50Ms: 500,
            p95Ms: 500
        });
        expect(resultsCsv(rows)).toContain('audit_store_outage,0,q1,500,ANCHORED,SATISFIED,true,true');
    });
});
