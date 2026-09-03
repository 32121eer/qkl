function clamp(value, lower, upper) {
    return Math.max(lower, Math.min(upper, Number(value) || 0));
}

function normalizedService(service) {
    return {
        ...service,
        reliability: clamp(service.reliability ?? 0.5, 0, 1),
        latencyMs: Math.max(0, Number(service.latencyMs) || 0),
        load: clamp(service.load ?? 0, 0, 1),
        organization: service.organization || 'unknown-organization',
        modelFamily: service.modelFamily || 'unknown-model'
    };
}

function diversityBonus(service, selected) {
    if (!selected.length) return 1;
    const organizations = new Set(selected.map((item) => item.organization));
    const models = new Set(selected.map((item) => item.modelFamily));
    return Number(!organizations.has(service.organization)) + Number(!models.has(service.modelFamily));
}

function scoreService(service, selected, {
    reliabilityWeight = 1,
    latencyWeight = 0.002,
    loadWeight = 0.35,
    diversityWeight = 0.15
} = {}) {
    const normalized = normalizedService(service);
    return (reliabilityWeight * normalized.reliability) -
        (latencyWeight * normalized.latencyMs) -
        (loadWeight * normalized.load) +
        (diversityWeight * diversityBonus(normalized, selected));
}

function selectServices(services, {
    count = 1,
    strategy = 'reliability_load_diversity',
    weights = {}
} = {}) {
    const candidates = (services || []).map(normalizedService);
    if (!candidates.length) return [];
    const limit = Math.min(Math.max(1, Number(count) || 1), candidates.length);
    if (strategy === 'fixed') return candidates.slice(0, limit);

    const selected = [];
    const remaining = [...candidates];
    while (selected.length < limit) {
        remaining.sort((left, right) => {
            const leftScore = strategy === 'reliability'
                ? left.reliability
                : scoreService(left, selected, weights);
            const rightScore = strategy === 'reliability'
                ? right.reliability
                : scoreService(right, selected, weights);
            return rightScore - leftScore || left.serviceId.localeCompare(right.serviceId);
        });
        selected.push(remaining.shift());
    }
    return selected;
}

module.exports = { diversityBonus, normalizedService, scoreService, selectServices };
