const { DagScheduler } = require('../../../demo/semantic_query/dag_scheduler');
const { FaultInjector } = require('../../../demo/semantic_query/fault_injector');
const {
    DEFAULT_REGULATORY_FIXTURE,
    createRegulatoryReviewDag
} = require('../../../demo/semantic_query/regulatory_workload');

describe('regulatory review workload', () => {
    test('returns satisfied for the compliant fixture', async () => {
        const result = await new DagScheduler({ concurrency: 4 }).execute({
            queryId: 'regulatory-normal',
            nodes: createRegulatoryReviewDag({ serviceDelayMs: 0 }),
            rootNodeId: 'regulatory_root'
        });
        expect(result).toMatchObject({ terminalState: 'READY_TO_ANCHOR', outcome: 'SATISFIED' });
    });

    test('returns unsatisfied when the transaction exceeds the policy limit', async () => {
        const fixture = JSON.parse(JSON.stringify(DEFAULT_REGULATORY_FIXTURE));
        fixture.transaction.amount = fixture.policy.maximumAmount + 1;
        const result = await new DagScheduler({ concurrency: 4 }).execute({
            queryId: 'regulatory-limit',
            nodes: createRegulatoryReviewDag({ fixture, serviceDelayMs: 0 }),
            rootNodeId: 'regulatory_root'
        });
        expect(result).toMatchObject({ terminalState: 'READY_TO_ANCHOR', outcome: 'UNSATISFIED' });
    });

    test('returns insufficient evidence when a required field is missing', async () => {
        const fixture = JSON.parse(JSON.stringify(DEFAULT_REGULATORY_FIXTURE));
        delete fixture.disclosure.filed;
        const result = await new DagScheduler({ concurrency: 4 }).execute({
            queryId: 'regulatory-missing',
            nodes: createRegulatoryReviewDag({ fixture, serviceDelayMs: 0 }),
            rootNodeId: 'regulatory_root'
        });
        expect(result).toMatchObject({ terminalState: 'INSUFFICIENT_EVIDENCE', outcome: 'INSUFFICIENT' });
    });

    test('recovers from one FISCO endpoint failure', async () => {
        const injector = new FaultInjector([{
            queryId: 'regulatory-retry', nodeId: 'transaction_fisco', attempt: 1,
            candidate: 'fisco-node-0', action: 'error', code: 'ENDPOINT_UNAVAILABLE', recoverable: true
        }]);
        const result = await new DagScheduler({ concurrency: 4, faultInjector: injector }).execute({
            queryId: 'regulatory-retry',
            nodes: createRegulatoryReviewDag({ serviceDelayMs: 0 }),
            rootNodeId: 'regulatory_root'
        });
        expect(result).toMatchObject({ terminalState: 'READY_TO_ANCHOR', outcome: 'SATISFIED' });
        expect(result.nodes.find((node) => node.nodeId === 'transaction_fisco')).toMatchObject({
            attemptCount: 2, endpoint: 'fisco-node-1'
        });
    });

    test('routes all live evidence nodes through the configured chain adapters', async () => {
        const fabric = { fetch: jest.fn().mockResolvedValue({ value: {} }) };
        const fisco = { fetch: jest.fn().mockResolvedValue({ value: {} }) };
        const evidenceQueries = Object.fromEntries(
            ['entity', 'license', 'transaction', 'policy', 'disclosure'].map((name) => [name, { resource: name }])
        );
        const nodes = createRegulatoryReviewDag({ adapters: { fabric, fisco }, evidenceQueries });
        const invoke = (nodeId) => nodes.find((node) => node.id === nodeId).execute({}, {
            queryId: 'live-regulatory', candidate: 'candidate-0'
        });

        await Promise.all([
            invoke('entity_fabric'), invoke('license_fabric'), invoke('disclosure_document'),
            invoke('transaction_fisco'), invoke('policy_document')
        ]);
        expect(fabric.fetch).toHaveBeenCalledTimes(3);
        expect(fisco.fetch).toHaveBeenCalledTimes(2);
        expect(fabric.fetch).toHaveBeenCalledWith(expect.objectContaining({
            queryId: 'live-regulatory', resource: 'disclosure'
        }));
        expect(fisco.fetch).toHaveBeenCalledWith(expect.objectContaining({
            queryId: 'live-regulatory', resource: 'policy'
        }));
    });
});
