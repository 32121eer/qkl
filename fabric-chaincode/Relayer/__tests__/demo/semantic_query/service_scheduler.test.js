const { scoreService, selectServices } = require('../../../demo/semantic_query/service_scheduler');

const SERVICES = [
    { serviceId: 'a', reliability: 0.98, latencyMs: 20, load: 0.8, organization: 'org-1', modelFamily: 'm-1' },
    { serviceId: 'b', reliability: 0.94, latencyMs: 18, load: 0.2, organization: 'org-1', modelFamily: 'm-1' },
    { serviceId: 'c', reliability: 0.91, latencyMs: 25, load: 0.1, organization: 'org-2', modelFamily: 'm-2' }
];

describe('semantic service scheduler', () => {
    test('supports fixed and reliability-only baselines', () => {
        expect(selectServices(SERVICES, { strategy: 'fixed' })[0].serviceId).toBe('a');
        expect(selectServices(SERVICES, { strategy: 'reliability' })[0].serviceId).toBe('a');
    });

    test('accounts for load in the composite strategy', () => {
        expect(selectServices(SERVICES, { strategy: 'reliability_load_diversity' })[0].serviceId).toBe('b');
    });

    test('rewards a second service from a different organization and model family', () => {
        const selected = selectServices(SERVICES, {
            count: 2,
            strategy: 'reliability_load_diversity',
            weights: { diversityWeight: 0.3 }
        });
        expect(selected.map((item) => item.serviceId)).toEqual(['b', 'c']);
        expect(scoreService(selected[1], [selected[0]], { diversityWeight: 0.3 }))
            .toBeGreaterThan(scoreService(SERVICES[0], [selected[0]], { diversityWeight: 0.3 }));
    });
});
