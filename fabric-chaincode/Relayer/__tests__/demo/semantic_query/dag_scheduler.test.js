const { DagScheduler } = require('../../../demo/semantic_query/dag_scheduler');
const { FaultInjector } = require('../../../demo/semantic_query/fault_injector');
const { createSupplyFinanceDag } = require('../../../demo/semantic_query/supply_finance_workload');

describe('dependency-aware semantic-query DAG scheduler', () => {
    test('executes the financing workload to a separate state and business outcome', async () => {
        const scheduler = new DagScheduler({ concurrency: 4, deadlineMs: 1000, defaultTimeoutMs: 100 });
        const result = await scheduler.execute({
            queryId: 'normal-query',
            nodes: createSupplyFinanceDag({ serviceDelayMs: 0 }),
            rootNodeId: 'financing_root'
        });

        expect(result.terminalState).toBe('READY_TO_ANCHOR');
        expect(result.outcome).toBe('SATISFIED');
        expect(result.nodes.every((node) => node.status === 'SUCCEEDED')).toBe(true);
        const rootStart = result.events.find((event) => event.type === 'NODE_STARTED' && event.nodeId === 'financing_root');
        const dependencyFinishes = result.events.filter((event) =>
            event.type === 'NODE_SUCCEEDED' &&
            ['qualification_rule', 'amount_rule', 'delivery_rule', 'quality_semantic'].includes(event.nodeId)
        );
        expect(rootStart.seq).toBeGreaterThan(Math.max(...dependencyFinishes.map((event) => event.seq)));
    });

    test('switches to an alternate endpoint after a recoverable failure', async () => {
        const injector = new FaultInjector([{
            nodeId: 'order_fabric', attempt: 1, candidate: 'fabric-peer-0',
            action: 'error', code: 'ENDPOINT_UNAVAILABLE', recoverable: true
        }]);
        const scheduler = new DagScheduler({ faultInjector: injector, deadlineMs: 1000, defaultTimeoutMs: 100 });
        const result = await scheduler.execute({
            queryId: 'recover-query',
            nodes: createSupplyFinanceDag({ serviceDelayMs: 0 }),
            rootNodeId: 'financing_root'
        });
        const order = result.nodes.find((node) => node.nodeId === 'order_fabric');

        expect(result.terminalState).toBe('READY_TO_ANCHOR');
        expect(order).toMatchObject({ status: 'SUCCEEDED', attemptCount: 2, endpoint: 'fabric-peer-1' });
        expect(injector.applied).toHaveLength(1);
    });

    test('terminates when all endpoint candidates are exhausted', async () => {
        const injector = new FaultInjector([
            {
                nodeId: 'order_fabric', attempt: 1, candidate: 'fabric-peer-0',
                action: 'error', code: 'ENDPOINT_UNAVAILABLE', recoverable: true
            },
            {
                nodeId: 'order_fabric', attempt: 2, candidate: 'fabric-peer-1',
                action: 'error', code: 'ENDPOINT_UNAVAILABLE', recoverable: true
            }
        ]);
        const scheduler = new DagScheduler({ faultInjector: injector, deadlineMs: 1000, defaultTimeoutMs: 100 });
        const result = await scheduler.execute({
            queryId: 'exhaust-query',
            nodes: createSupplyFinanceDag({ serviceDelayMs: 0 }),
            rootNodeId: 'financing_root'
        });

        expect(result.terminalState).toBe('FAILED');
        expect(result.outcome).toBeNull();
        expect(result.nodes.find((node) => node.nodeId === 'order_fabric')).toMatchObject({
            status: 'FAILED', attemptCount: 2, errorCode: 'ENDPOINT_UNAVAILABLE'
        });
        expect(result.nodes.find((node) => node.nodeId === 'financing_root').status).toBe('FAILED');
    });

    test('rejects a wrong semantic input root and retries a candidate service', async () => {
        const injector = new FaultInjector([{
            nodeId: 'quality_semantic', attempt: 1, action: 'mutate',
            mutate: (result) => ({ ...result, inputRoot: '0xwrong' })
        }]);
        const scheduler = new DagScheduler({ faultInjector: injector, deadlineMs: 1000, defaultTimeoutMs: 100 });
        const result = await scheduler.execute({
            queryId: 'wrong-root-query',
            nodes: createSupplyFinanceDag({ serviceDelayMs: 0 }),
            rootNodeId: 'financing_root'
        });
        const semantic = result.nodes.find((node) => node.nodeId === 'quality_semantic');

        expect(result.terminalState).toBe('READY_TO_ANCHOR');
        expect(semantic).toMatchObject({ status: 'SUCCEEDED', attemptCount: 2, endpoint: 'local-semantic-b' });
        expect(result.events).toEqual(expect.arrayContaining([
            expect.objectContaining({ type: 'NODE_RETRYING', nodeId: 'quality_semantic', errorCode: 'WRONG_INPUT_ROOT' })
        ]));
    });

    test('treats unresolved correlated semantic disagreement as insufficient evidence', async () => {
        const injector = new FaultInjector([1, 2].map((attempt) => ({
            nodeId: 'quality_semantic', attempt, action: 'mutate',
            mutate: (result) => ({ ...result, value: { ...result.value, disagreement: true } })
        })));
        const scheduler = new DagScheduler({ faultInjector: injector, deadlineMs: 1000, defaultTimeoutMs: 100 });
        const result = await scheduler.execute({
            queryId: 'correlated-disagreement-query',
            nodes: createSupplyFinanceDag({ serviceDelayMs: 0 }),
            rootNodeId: 'financing_root'
        });

        expect(result.terminalState).toBe('INSUFFICIENT_EVIDENCE');
        expect(result.outcome).toBe('INSUFFICIENT');
        expect(result.nodes.find((node) => node.nodeId === 'quality_semantic')).toMatchObject({
            status: 'INSUFFICIENT', attemptCount: 2, errorCode: 'SEMANTIC_DISAGREEMENT'
        });
    });
});
