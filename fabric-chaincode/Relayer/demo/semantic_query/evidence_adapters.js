const { hashValue } = require('./audit_receipt');
const { makeError } = require('./dag_scheduler');

function decodePayload(raw) {
    if (Buffer.isBuffer(raw) || raw instanceof Uint8Array) {
        return decodePayload(Buffer.from(raw).toString('utf8'));
    }
    if (typeof raw === 'bigint') return raw.toString();
    if (Array.isArray(raw)) return raw.map(decodePayload);
    if (raw && typeof raw.toObject === 'function') return decodePayload(raw.toObject());
    if (raw && typeof raw === 'object') {
        return Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, decodePayload(value)]));
    }
    if (typeof raw !== 'string') return raw;
    const text = raw.trim();
    if (!text) return null;
    try {
        return JSON.parse(text);
    } catch (_error) {
        return text;
    }
}

function normalizeHeight(value) {
    const number = Number(value);
    return Number.isInteger(number) && number >= 0 ? number : null;
}

function selectPayload(payload, payloadPath) {
    if (!payloadPath) return payload;
    const segments = Array.isArray(payloadPath) ? payloadPath : String(payloadPath).split('.').filter(Boolean);
    let selected = payload;
    for (const segment of segments) {
        if (selected === null || selected === undefined || typeof selected !== 'object') {
            throw new Error(`Payload path '${segments.join('.')}' is not present`);
        }
        selected = selected[segment];
    }
    if (selected === undefined) throw new Error(`Payload path '${segments.join('.')}' is not present`);
    return selected;
}

function buildEvidence({
    queryId,
    sourceChain,
    sourceType,
    locator,
    payload,
    schemaVersion,
    predicateBinding,
    issuer,
    observedAt,
    validUntil = null,
    finality
}) {
    const payloadHash = hashValue(payload);
    const identity = {
        queryId,
        sourceChain,
        locator,
        schemaVersion,
        payloadHash
    };
    return {
        evidenceId: hashValue(identity),
        queryId,
        sourceChain,
        sourceType,
        locator,
        finality,
        observedAt,
        validUntil,
        schemaVersion,
        predicateBinding,
        payloadHash,
        issuer
    };
}

class FabricEvidenceAdapter {
    constructor({
        evaluate,
        getLatestBlockNumber = async () => null,
        chainId = 'FABRIC_NET_01',
        channelName = 'mychannel',
        chaincodeName = 'gateway_cc',
        schemaVersion = 'fabric-evidence-v1',
        issuer = 'Org1MSP'
    } = {}) {
        if (typeof evaluate !== 'function') throw new Error('FabricEvidenceAdapter requires evaluate');
        this.evaluate = evaluate;
        this.getLatestBlockNumber = getLatestBlockNumber;
        this.chainId = chainId;
        this.channelName = channelName;
        this.chaincodeName = chaincodeName;
        this.schemaVersion = schemaVersion;
        this.issuer = issuer;
    }

    async fetch({
        queryId, functionName, args = [], resource, predicateBinding, candidate,
        validUntil = null, payloadPath = null
    } = {}) {
        if (!queryId || !functionName) throw new Error('Fabric fetch requires queryId and functionName');
        const observedAt = new Date().toISOString();
        let raw;
        try {
            raw = await this.evaluate({ functionName, args, candidate, queryId });
        } catch (cause) {
            const error = makeError('FABRIC_QUERY_FAILED', `Fabric query failed: ${cause.message}`, { recoverable: true });
            error.cause = cause;
            throw error;
        }
        const payload = selectPayload(decodePayload(raw), payloadPath);
        const blockNumber = normalizeHeight(await this.getLatestBlockNumber());
        const locator = {
            channel: this.channelName,
            chaincode: this.chaincodeName,
            function: functionName,
            args: args.map(String),
            resource: resource || `${functionName}:${args.join(':')}`,
            payloadPath,
            evaluatedAtBlock: blockNumber,
            transactionId: null
        };
        const evidence = buildEvidence({
            queryId,
            sourceChain: `${this.chainId}:${this.channelName}`,
            sourceType: 'FABRIC_STATE',
            locator,
            payload,
            schemaVersion: this.schemaVersion,
            predicateBinding,
            issuer: this.issuer,
            observedAt,
            validUntil,
            finality: {
                committed: blockNumber !== null,
                blockNumber,
                proofType: 'gateway-evaluation-at-observed-height'
            }
        });
        return { value: payload, evidence, metadata: { candidate, observedAt } };
    }
}

class FiscoEvidenceAdapter {
    constructor({
        callContract,
        getLatestBlockNumber = async () => null,
        chainId = 'FISCO_NET_01',
        groupId = 'group0',
        schemaVersion = 'fisco-evidence-v1',
        issuer = 'fisco-relayer'
    } = {}) {
        if (typeof callContract !== 'function') throw new Error('FiscoEvidenceAdapter requires callContract');
        this.callContract = callContract;
        this.getLatestBlockNumber = getLatestBlockNumber;
        this.chainId = chainId;
        this.groupId = groupId;
        this.schemaVersion = schemaVersion;
        this.issuer = issuer;
    }

    async fetch({
        queryId,
        contractName,
        contractAddress,
        functionName,
        args = [],
        resource,
        predicateBinding,
        candidate,
        validUntil = null,
        payloadPath = null
    } = {}) {
        if (!queryId || !functionName || !contractAddress) {
            throw new Error('FISCO fetch requires queryId, contractAddress and functionName');
        }
        const observedAt = new Date().toISOString();
        let raw;
        try {
            raw = await this.callContract({
                contractName,
                contractAddress,
                functionName,
                args,
                candidate,
                queryId
            });
        } catch (cause) {
            const error = makeError('FISCO_QUERY_FAILED', `FISCO query failed: ${cause.message}`, { recoverable: true });
            error.cause = cause;
            throw error;
        }
        const payload = selectPayload(decodePayload(raw), payloadPath);
        const blockNumber = normalizeHeight(await this.getLatestBlockNumber());
        const locator = {
            groupId: this.groupId,
            contractName: contractName || null,
            contractAddress,
            function: functionName,
            args: args.map(String),
            resource: resource || `${contractAddress}:${functionName}:${args.join(':')}`,
            payloadPath,
            evaluatedAtBlock: blockNumber,
            transactionHash: null
        };
        const evidence = buildEvidence({
            queryId,
            sourceChain: `${this.chainId}:${this.groupId}`,
            sourceType: 'FISCO_CONTRACT_STATE',
            locator,
            payload,
            schemaVersion: this.schemaVersion,
            predicateBinding,
            issuer: this.issuer,
            observedAt,
            validUntil,
            finality: {
                committed: blockNumber !== null,
                blockNumber,
                proofType: 'contract-call-at-observed-height'
            }
        });
        return { value: payload, evidence, metadata: { candidate, observedAt } };
    }
}

function createFabricAdapterFromRuntime({
    triggerService,
    monitor,
    candidateConnections = {},
    overrides = {}
} = {}) {
    if (!triggerService || typeof triggerService.withFabricGatewayContract !== 'function') {
        throw new Error('A triggerService with withFabricGatewayContract is required');
    }
    const fabricChain = triggerService.getFabricChain();
    return new FabricEvidenceAdapter({
        chainId: fabricChain.chainId,
        channelName: fabricChain.connection?.channelName,
        chaincodeName: fabricChain.contracts?.gateway,
        issuer: fabricChain.connection?.mspId,
        evaluate: ({ functionName, args, candidate }) => triggerService.withFabricGatewayContract(
            async (contract) => contract.evaluateTransaction(functionName, ...args.map(String)),
            candidateConnections[candidate] || {}
        ),
        getLatestBlockNumber: () => {
            const cached = Number(monitor?.latestObservedBlockNumber);
            if (Number.isInteger(cached) && cached >= 0) return cached;
            return monitor?.getLatestBlockNumber?.() ?? null;
        },
        ...overrides
    });
}

function createFiscoAdapterFromRuntime({
    monitor,
    contracts = {},
    candidateEndpoints = {},
    overrides = {}
} = {}) {
    if (!monitor?.provider) throw new Error('An initialized FISCO monitor provider is required');
    const { ethers } = require('ethers');
    const cache = new Map();
    const providers = new Map();
    const providerFor = (candidate) => {
        const endpoint = candidateEndpoints[candidate];
        if (!endpoint) return monitor.provider;
        if (!providers.has(endpoint)) {
            providers.set(endpoint, new ethers.JsonRpcProvider(
                endpoint,
                new ethers.Network('fisco-bcos', 20200),
                { staticNetwork: true, polling: true, batchMaxCount: 1, cacheTimeout: -1 }
            ));
        }
        return providers.get(endpoint);
    };
    const adapter = new FiscoEvidenceAdapter({
        chainId: monitor.config?.chainId,
        groupId: monitor.config?.rpc?.groupId || 'group0',
        getLatestBlockNumber: () => monitor.getLatestBlockNumber?.() ?? null,
        callContract: async ({ contractName, contractAddress, functionName, args, candidate }) => {
            const definition = contracts[contractName] || {};
            const address = contractAddress || definition.address;
            const abi = definition.abi;
            if (!address || !abi) {
                throw new Error(`Missing address or ABI for FISCO contract '${contractName}'`);
            }
            const endpoint = candidateEndpoints[candidate] || 'default';
            const key = `${endpoint}:${contractName}:${address}`;
            if (!cache.has(key)) cache.set(key, new ethers.Contract(address, abi, providerFor(candidate)));
            const contract = cache.get(key);
            if (typeof contract[functionName] !== 'function') {
                throw new Error(`FISCO contract '${contractName}' has no function '${functionName}'`);
            }
            return contract[functionName](...args);
        },
        ...overrides
    });
    adapter.close = () => {
        for (const provider of providers.values()) provider.destroy();
        providers.clear();
        cache.clear();
    };
    return adapter;
}

module.exports = {
    FabricEvidenceAdapter,
    FiscoEvidenceAdapter,
    createFabricAdapterFromRuntime,
    createFiscoAdapterFromRuntime,
    buildEvidence,
    decodePayload,
    selectPayload
};
