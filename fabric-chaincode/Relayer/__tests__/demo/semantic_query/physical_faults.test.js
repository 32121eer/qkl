const {
    expectedPhysicalFailover,
    parseArgs,
    summarize
} = require('../../../demo/semantic_query/experiments/run_live_physical_faults');

function result(nodes) {
    return {
        receipt: { terminalState: 'ANCHORED', outcome: 'SATISFIED' },
        execution: { nodes }
    };
}

describe('physical endpoint fault experiment helpers', () => {
    test('validates physical targets and repetition count', () => {
        expect(parseArgs([])).toMatchObject({
            repetitions: 1,
            scenarios: ['fabric_peer_paused', 'fisco_node_paused'],
            fiscoNode: 'node0'
        });
        expect(() => parseArgs(['--repetitions', '0'])).toThrow('positive integer');
        expect(() => parseArgs(['--fisco-node', 'node9'])).toThrow('node0..node3');
    });

    test('requires both Fabric evidence nodes to recover through the real alternate peer', () => {
        const execution = result([
            { nodeId: 'order_fabric', status: 'SUCCEEDED', attemptCount: 2, endpoint: 'fabric-peer-1' },
            { nodeId: 'invoice_fabric', status: 'SUCCEEDED', attemptCount: 2, endpoint: 'fabric-peer-1' }
        ]);
        expect(expectedPhysicalFailover('fabric_peer_paused', execution)).toBe(true);
        execution.execution.nodes[1].endpoint = 'fabric-peer-0';
        expect(expectedPhysicalFailover('fabric_peer_paused', execution)).toBe(false);
    });

    test('requires both FISCO evidence nodes to recover through the real alternate node', () => {
        const execution = result([
            { nodeId: 'identity_fisco', status: 'SUCCEEDED', attemptCount: 2, endpoint: 'fisco-node-1' },
            { nodeId: 'logistics_fisco', status: 'SUCCEEDED', attemptCount: 2, endpoint: 'fisco-node-1' }
        ]);
        expect(expectedPhysicalFailover('fisco_node_paused', execution)).toBe(true);
        execution.receipt.terminalState = 'FAILED';
        expect(expectedPhysicalFailover('fisco_node_paused', execution)).toBe(false);
    });

    test('summarizes only completed and verified physical failovers', () => {
        const summary = summarize([
            {
                scenario: 'fabric_peer_paused', totalMs: 1000, retryCount: 2,
                physicalFailoverVerified: true, auditVerified: true, error: null
            },
            {
                scenario: 'fabric_peer_paused', totalMs: 2000, retryCount: 2,
                physicalFailoverVerified: true, auditVerified: true, error: null
            }
        ]).fabric_peer_paused;
        expect(summary).toMatchObject({
            queries: 2,
            completed: 2,
            physicalFailoverVerified: 2,
            auditVerified: 2,
            meanMs: 1500,
            p50Ms: 1500,
            p95Ms: 1950,
            meanRetries: 2
        });
    });
});
