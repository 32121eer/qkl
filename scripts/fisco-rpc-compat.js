#!/usr/bin/env node

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

const HOST = process.env.FISCO_COMPAT_HOST || '127.0.0.1';
const PORT = Number(process.env.FISCO_COMPAT_PORT || process.env.FISCO_RPC_COMPAT_PORT || 8545);
const ROOT_DIR = path.resolve(__dirname, '..');
const CONSOLE_DIR = process.env.FISCO_CONSOLE_DIR || path.join(ROOT_DIR, 'fisco-bcos', 'console');
const CONSOLE_BIN = path.join(CONSOLE_DIR, 'console.sh');
const JAVA_USER_HOME = process.env.FISCO_JAVA_USER_HOME || '/tmp/cross-chain-home';
const ZERO_HASH = `0x${'0'.repeat(64)}`;
const ZERO_BLOOM = `0x${'0'.repeat(512)}`;
const ZERO_ADDR = `0x${'0'.repeat(40)}`;
const DEFAULT_GAS_LIMIT = '0xb2d05e00';
const CHAIN_ID = process.env.FISCO_COMPAT_CHAIN_ID || '0x4ee8';
const NET_VERSION = process.env.FISCO_COMPAT_NET_VERSION || '20200';
const CLIENT_VERSION = process.env.FISCO_COMPAT_CLIENT_VERSION || 'FISCO-BCOS-Compat/1.0';
const RELAYER_CONFIG_PATH = path.join(ROOT_DIR, 'fabric-chaincode', 'Relayer', 'config.json');

const {
    Interface,
    getAddress,
    isHexString,
} = require(path.join(ROOT_DIR, 'fabric-chaincode', 'Relayer', 'node_modules', 'ethers'));

const blockCache = new Map();
const blockHashCache = new Map();
const receiptCache = new Map();
const txCache = new Map();

function loadRelayerConfig() {
    try {
        return JSON.parse(fs.readFileSync(RELAYER_CONFIG_PATH, 'utf8'));
    } catch (_error) {
        return {};
    }
}

const relayerConfig = loadRelayerConfig();
const fiscoChainConfig = Array.isArray(relayerConfig.chains)
    ? relayerConfig.chains.find((item) => item?.chainId === 'FISCO_NET_01')
    : null;

const LIGHT_CLIENT_INTERFACE = new Interface([
    'function getLatestBlockNumber(string chainId) view returns (uint64)',
    'function getBlockHash(string chainId, uint64 blockNumber) view returns (bytes32)',
    'function isBlockVerified(string chainId, uint64 blockNumber) view returns (bool)',
    'function latestBlockNumber(string chainId) view returns (uint64)',
    'function blockHashes(string chainId, uint64 blockNumber) view returns (bytes32)',
    'function trustedRelayers(address relayer) view returns (bool)',
    'function admin() view returns (address)',
    'function registryContract() view returns (address)'
]);

const GATEWAY_INTERFACE = new Interface([
    'function chainRegistry() view returns (address)',
    'function lightClient() view returns (address)',
    'function processedCalls(bytes32 callId) view returns (bool)'
]);

function normalizeAddressKey(value) {
    if (!value) {
        return null;
    }
    try {
        return getAddress(String(value)).toLowerCase();
    } catch (_error) {
        return String(value).toLowerCase();
    }
}

function buildEthCallRegistry() {
    const registry = new Map();
    const contracts = fiscoChainConfig?.contracts || {};

    const lightClientAddress = normalizeAddressKey(contracts.lightClient);
    if (lightClientAddress) {
        registry.set(lightClientAddress, {
            contractName: contracts.lightClientName || 'LightClientAir',
            iface: LIGHT_CLIENT_INTERFACE
        });
    }

    const gatewayAddress = normalizeAddressKey(contracts.gateway);
    if (gatewayAddress) {
        registry.set(gatewayAddress, {
            contractName: contracts.gatewayName || 'GatewayAir',
            iface: GATEWAY_INTERFACE
        });
    }

    return registry;
}

const ETH_CALL_REGISTRY = buildEthCallRegistry();

function sanitizeConsoleOutput(output) {
    return String(output || '')
        .replace(/^Picked up JAVA_TOOL_OPTIONS:.*$/gm, '')
        .trim();
}

function ensureHex(value, fallback = ZERO_HASH) {
    if (!value) {
        return fallback;
    }
    return value.startsWith('0x') ? value : `0x${value}`;
}

function ensureAddress(value, { nullable = false } = {}) {
    if (!value) {
        return nullable ? null : ZERO_ADDR;
    }
    return value.startsWith('0x') ? value : `0x${value}`;
}

function parseReturnValuesText(output) {
    const normalized = sanitizeConsoleOutput(output);
    const match = normalized.match(/Return values:\(([^)]*)\)/i);
    if (match) {
        return match[1].trim();
    }
    return normalized;
}

function stripQuotes(value) {
    const text = String(value || '').trim();
    if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
        return text.slice(1, -1);
    }
    return text;
}

function normalizeConsoleBytesValue(value) {
    const text = stripQuotes(value);
    if (!text) {
        return '0x';
    }
    if (text.startsWith('hex://')) {
        return ensureHex(text.slice('hex://'.length), '0x');
    }
    return ensureHex(text, '0x');
}

function encodeConsoleArg(input, type) {
    if (type.endsWith(']')) {
        throw new Error(`Unsupported eth_call array argument type: ${type}`);
    }

    if (type === 'string') {
        return String(input);
    }
    if (type === 'bool') {
        return input ? 'true' : 'false';
    }
    if (type === 'address') {
        return ensureAddress(String(input));
    }
    if (type.startsWith('uint') || type.startsWith('int')) {
        return String(input);
    }
    if (type.startsWith('bytes')) {
        return ensureHex(String(input), '0x');
    }
    throw new Error(`Unsupported eth_call argument type: ${type}`);
}

function decodeConsoleResult(rawValue, type) {
    const value = stripQuotes(rawValue);

    if (type === 'string') {
        return value;
    }
    if (type === 'bool') {
        return /^true$/i.test(value);
    }
    if (type === 'address') {
        return ensureAddress(value);
    }
    if (type.startsWith('uint') || type.startsWith('int')) {
        if (!value) {
            return 0n;
        }
        return BigInt(value);
    }
    if (type.startsWith('bytes')) {
        return normalizeConsoleBytesValue(value);
    }
    throw new Error(`Unsupported eth_call return type: ${type}`);
}

async function handleEthCall(call = {}) {
    const targetAddress = normalizeAddressKey(call.to);
    if (!targetAddress) {
        throw new Error('eth_call requires a target address');
    }

    const data = ensureHex(String(call.data || '0x'), '0x');
    if (!isHexString(data)) {
        throw new Error('eth_call data must be hex');
    }

    const contract = ETH_CALL_REGISTRY.get(targetAddress);
    if (!contract) {
        throw new Error(`Unsupported eth_call target: ${call.to}`);
    }

    const fragment = contract.iface.getFunction(data.slice(0, 10));
    if (!fragment) {
        throw new Error(`Unsupported eth_call selector: ${data.slice(0, 10)}`);
    }

    const decodedArgs = contract.iface.decodeFunctionData(fragment, data);
    const consoleArgs = decodedArgs.map((value, index) => encodeConsoleArg(value, fragment.inputs[index].type));
    const output = await execConsole(
        ['call', contract.contractName, ensureAddress(call.to), fragment.name, ...consoleArgs],
        30_000
    );

    const outputs = fragment.outputs || [];
    if (!outputs.length) {
        return '0x';
    }

    if (outputs.length > 1) {
        throw new Error(`Unsupported eth_call multi-value return for ${fragment.name}`);
    }

    const decodedResult = decodeConsoleResult(parseReturnValuesText(output), outputs[0].type);
    return contract.iface.encodeFunctionResult(fragment, [decodedResult]);
}

function toQuantity(value) {
    if (value === null || value === undefined || value === '') {
        return '0x0';
    }
    let parsed;
    if (typeof value === 'bigint') {
        parsed = value;
    } else if (typeof value === 'number') {
        parsed = BigInt(Math.max(0, Math.trunc(value)));
    } else if (typeof value === 'string') {
        parsed = value.startsWith('0x') ? BigInt(value) : BigInt(value);
    } else {
        parsed = BigInt(value);
    }
    return `0x${parsed.toString(16)}`;
}

function getTimestampQuantity(rawValue) {
    const numeric = Number(rawValue || 0);
    if (!Number.isFinite(numeric) || numeric <= 0) {
        return '0x0';
    }
    const normalized = numeric > 1e12 ? Math.floor(numeric / 1000) : Math.floor(numeric);
    return toQuantity(normalized);
}

function captureQuoted(text, field) {
    const match = text.match(new RegExp(`${field}='([^']*)'`));
    return match ? match[1] : null;
}

function captureBare(text, field) {
    const match = text.match(new RegExp(`${field}=([^,\\n]+)`));
    return match ? match[1].trim() : null;
}

function parseConsoleBlock(text) {
    return {
        number: Number(captureQuoted(text, 'number') || 0),
        hash: captureQuoted(text, 'hash') || ZERO_HASH,
        logsBloom: captureQuoted(text, 'logsBloom'),
        transactionsRoot: captureQuoted(text, 'transactionsRoot') || ZERO_HASH,
        receiptRoot: captureQuoted(text, 'receiptRoot') || ZERO_HASH,
        stateRoot: captureQuoted(text, 'stateRoot') || ZERO_HASH,
        extraData: captureBare(text, 'extraData') || '0x',
        gasUsed: captureQuoted(text, 'gasUsed') || '0',
        timestamp: captureQuoted(text, 'timestamp') || '0',
        transactions: [...text.matchAll(/TransactionHash\{\s*value='(0x[0-9a-fA-F]+)'/gms)].map((match) => match[1]),
    };
}

function parseConsoleTransaction(text) {
    return {
        hash: captureQuoted(text, 'hash') || ZERO_HASH,
        nonce: captureQuoted(text, 'nonce') || '0',
        to: captureQuoted(text, 'to') || '',
        from: captureQuoted(text, 'from') || '',
        input: captureQuoted(text, 'input') || '0x',
        blockLimit: captureBare(text, 'blockLimit') || '0',
    };
}

async function execConsole(args, timeout = 30_000) {
    const env = { ...process.env };
    env.FISCO_JAVA_USER_HOME = JAVA_USER_HOME;
    env.HOME = JAVA_USER_HOME;
    const userHomeFlag = `-Duser.home=${JAVA_USER_HOME}`;
    if (!env.JAVA_TOOL_OPTIONS || !env.JAVA_TOOL_OPTIONS.includes('-Duser.home=')) {
        env.JAVA_TOOL_OPTIONS = env.JAVA_TOOL_OPTIONS ? `${env.JAVA_TOOL_OPTIONS} ${userHomeFlag}` : userHomeFlag;
    }

    const { stdout, stderr } = await execFileAsync(CONSOLE_BIN, args, {
        cwd: CONSOLE_DIR,
        env,
        timeout,
        maxBuffer: 20 * 1024 * 1024,
    });

    const output = sanitizeConsoleOutput(stdout || stderr);
    if (!output) {
        throw new Error(`Empty output from console.sh ${args.join(' ')}`);
    }
    return output;
}

// Cache the latest block number for up to 15 seconds to avoid hammering
// console.sh on every ethers.js poll (each call takes ~8-15 s on macOS).
let _latestBlockNumberCache = null;
let _latestBlockNumberTs = 0;
const BLOCK_NUMBER_CACHE_MS = 15_000;

async function getLatestBlockNumber() {
    const now = Date.now();
    if (_latestBlockNumberCache !== null && (now - _latestBlockNumberTs) < BLOCK_NUMBER_CACHE_MS) {
        return _latestBlockNumberCache;
    }
    const output = await execConsole(['getBlockNumber']);
    const match = output.match(/(\d+)/);
    if (!match) {
        throw new Error(`Unable to parse block number: ${output}`);
    }
    _latestBlockNumberCache = Number(match[1]);
    _latestBlockNumberTs = now;
    return _latestBlockNumberCache;
}

async function getBlockHashByNumber(blockNumber) {
    const key = Number(blockNumber);
    if (blockHashCache.has(key)) {
        return blockHashCache.get(key);
    }
    const output = await execConsole(['getBlockHashByNumber', String(key)]);
    const hash = ensureHex(output.split(/\s+/).pop(), ZERO_HASH);
    blockHashCache.set(key, hash);
    return hash;
}

async function getBlockByNumber(blockNumber) {
    const key = Number(blockNumber);
    if (blockCache.has(key)) {
        return blockCache.get(key);
    }
    const output = await execConsole(['getBlockByNumber', String(key), 'true']);
    const parsed = parseConsoleBlock(output);
    blockCache.set(key, parsed);
    blockHashCache.set(key, parsed.hash);
    return parsed;
}

async function getBlockByHash(blockHash) {
    const output = await execConsole(['getBlockByHash', ensureHex(blockHash)]);
    const parsed = parseConsoleBlock(output);
    blockCache.set(parsed.number, parsed);
    blockHashCache.set(parsed.number, parsed.hash);
    return parsed;
}

async function getTransactionReceipt(txHash) {
    const normalized = ensureHex(txHash);
    if (receiptCache.has(normalized)) {
        return receiptCache.get(normalized);
    }
    const output = await execConsole(['getTransactionReceipt', normalized]);
    const parsed = JSON.parse(output);
    receiptCache.set(normalized, parsed);
    return parsed;
}

async function getTransactionByHash(txHash) {
    const normalized = ensureHex(txHash);
    if (txCache.has(normalized)) {
        return txCache.get(normalized);
    }
    const output = await execConsole(['getTransactionByHash', normalized]);
    const parsed = parseConsoleTransaction(output);
    txCache.set(normalized, parsed);
    return parsed;
}

async function getCode(address) {
    const output = await execConsole(['getCode', ensureAddress(address)]);
    return ensureHex(output, '0x');
}

function parseBlockTag(tag) {
    if (tag === undefined || tag === null || tag === 'latest' || tag === 'safe' || tag === 'finalized' || tag === 'pending') {
        return null;
    }
    if (typeof tag === 'number') {
        return tag;
    }
    if (typeof tag === 'string' && tag.startsWith('0x')) {
        return Number(BigInt(tag));
    }
    return Number(tag);
}

function topicMatches(logTopics, filterTopics = []) {
    for (let index = 0; index < filterTopics.length; index += 1) {
        const expected = filterTopics[index];
        const actual = logTopics[index];
        if (expected === null || expected === undefined) {
            continue;
        }
        if (Array.isArray(expected)) {
            const normalized = expected.map((item) => String(item).toLowerCase());
            if (!actual || !normalized.includes(String(actual).toLowerCase())) {
                return false;
            }
            continue;
        }
        if (!actual || String(actual).toLowerCase() !== String(expected).toLowerCase()) {
            return false;
        }
    }
    return true;
}

function addressMatches(actualAddress, requestedAddress) {
    if (!requestedAddress) {
        return true;
    }
    const normalizedActual = String(actualAddress).toLowerCase();
    if (Array.isArray(requestedAddress)) {
        return requestedAddress.some((item) => normalizedActual === String(item).toLowerCase());
    }
    return normalizedActual === String(requestedAddress).toLowerCase();
}

async function buildRpcBlock(block, includeTransactions) {
    const parentHash = block.number > 0 ? await getBlockHashByNumber(block.number - 1) : ZERO_HASH;
    const txs = includeTransactions
        ? await Promise.all(block.transactions.map((txHash) => buildRpcTransaction(txHash)))
        : block.transactions;

    return {
        number: toQuantity(block.number),
        hash: ensureHex(block.hash),
        parentHash,
        nonce: '0x0000000000000000',
        sha3Uncles: ZERO_HASH,
        logsBloom: ZERO_BLOOM,
        transactionsRoot: ensureHex(block.transactionsRoot),
        stateRoot: ensureHex(block.stateRoot),
        receiptsRoot: ensureHex(block.receiptRoot),
        miner: ZERO_ADDR,
        difficulty: '0x0',
        totalDifficulty: '0x0',
        extraData: ensureHex(block.extraData, '0x'),
        size: '0x0',
        gasLimit: DEFAULT_GAS_LIMIT,
        gasUsed: toQuantity(block.gasUsed),
        timestamp: getTimestampQuantity(block.timestamp),
        transactions: txs,
        uncles: [],
        baseFeePerGas: null,
        withdrawals: [],
        withdrawalsRoot: null,
        blobGasUsed: null,
        excessBlobGas: null,
    };
}

async function buildRpcTransaction(txHash, blockHint = null, txIndexHint = null) {
    const tx = await getTransactionByHash(txHash);
    const receipt = await getTransactionReceipt(txHash);
    const blockNumber = receipt.blockNumber ?? blockHint?.number ?? null;
    const blockHash = blockNumber !== null ? await getBlockHashByNumber(blockNumber) : null;
    const txIndex = txIndexHint ?? 0;

    return {
        blockHash,
        blockNumber: blockNumber !== null ? toQuantity(blockNumber) : null,
        from: ensureAddress(tx.from),
        gas: DEFAULT_GAS_LIMIT,
        gasPrice: '0x0',
        maxFeePerGas: null,
        maxPriorityFeePerGas: null,
        hash: ensureHex(tx.hash),
        input: ensureHex(tx.input, '0x'),
        nonce: toQuantity(tx.nonce),
        to: ensureAddress(tx.to, { nullable: true }),
        transactionIndex: toQuantity(txIndex),
        value: '0x0',
        type: '0x0',
        chainId: CHAIN_ID,
        v: '0x0',
        r: ZERO_HASH,
        s: ZERO_HASH,
    };
}

async function buildRpcReceipt(txHash, blockHint = null, txIndexHint = null) {
    const receipt = await getTransactionReceipt(txHash);
    const blockNumber = receipt.blockNumber ?? blockHint?.number ?? 0;
    const blockHash = await getBlockHashByNumber(blockNumber);
    const txIndex = txIndexHint ?? 0;
    const logs = (receipt.logEntries || []).map((entry, index) => ({
        address: ensureAddress(entry.address),
        topics: (entry.topics || []).map((topic) => ensureHex(topic)),
        data: ensureHex(entry.data, '0x'),
        blockNumber: toQuantity(blockNumber),
        transactionHash: ensureHex(receipt.transactionHash),
        transactionIndex: toQuantity(txIndex),
        blockHash,
        logIndex: toQuantity(index),
        removed: false,
    }));

    return {
        transactionHash: ensureHex(receipt.transactionHash),
        transactionIndex: toQuantity(txIndex),
        blockHash,
        blockNumber: toQuantity(blockNumber),
        from: ensureAddress(receipt.from),
        to: ensureAddress(receipt.to, { nullable: true }),
        cumulativeGasUsed: toQuantity(receipt.gasUsed),
        gasUsed: toQuantity(receipt.gasUsed),
        contractAddress: ensureAddress(receipt.contractAddress, { nullable: true }),
        logs,
        logsBloom: ZERO_BLOOM,
        status: toQuantity(receipt.status),
        effectiveGasPrice: '0x0',
        type: '0x0',
    };
}

async function getLogs(filter = {}) {
    let fromBlock;
    let toBlock;

    if (filter.blockHash) {
        const block = await getBlockByHash(filter.blockHash);
        fromBlock = block.number;
        toBlock = block.number;
    } else {
        const latest = await getLatestBlockNumber();
        fromBlock = parseBlockTag(filter.fromBlock);
        toBlock = parseBlockTag(filter.toBlock);
        if (fromBlock === null) {
            fromBlock = latest;
        }
        if (toBlock === null) {
            toBlock = latest;
        }
    }

    const results = [];

    for (let blockNumber = fromBlock; blockNumber <= toBlock; blockNumber += 1) {
        const block = await getBlockByNumber(blockNumber);
        for (let txIndex = 0; txIndex < block.transactions.length; txIndex += 1) {
            const txHash = block.transactions[txIndex];
            const receipt = await buildRpcReceipt(txHash, block, txIndex);
            for (const log of receipt.logs) {
                if (!addressMatches(log.address, filter.address)) {
                    continue;
                }
                if (!topicMatches(log.topics, filter.topics || [])) {
                    continue;
                }
                results.push(log);
            }
        }
    }

    return results;
}

async function handleRpc(method, params = []) {
    switch (method) {
        case 'web3_clientVersion':
            return CLIENT_VERSION;
        case 'net_version':
            return NET_VERSION;
        case 'net_listening':
            return true;
        case 'eth_chainId':
            return CHAIN_ID;
        case 'eth_syncing':
            return false;
        case 'eth_blockNumber':
            return toQuantity(await getLatestBlockNumber());
        case 'eth_getBlockByNumber': {
            const blockTag = params[0];
            const includeTransactions = Boolean(params[1]);
            const blockNumber = parseBlockTag(blockTag);
            const block = await getBlockByNumber(blockNumber === null ? await getLatestBlockNumber() : blockNumber);
            return buildRpcBlock(block, includeTransactions);
        }
        case 'eth_getBlockByHash': {
            const includeTransactions = Boolean(params[1]);
            const block = await getBlockByHash(params[0]);
            return buildRpcBlock(block, includeTransactions);
        }
        case 'eth_getTransactionReceipt':
            return buildRpcReceipt(params[0]);
        case 'eth_getTransactionByHash':
            return buildRpcTransaction(params[0]);
        case 'eth_getCode':
            return getCode(params[0]);
        case 'eth_call':
            return handleEthCall(params[0] || {});
        case 'eth_getLogs':
            return getLogs(params[0] || {});
        case 'eth_gasPrice':
            return '0x0';
        default:
            throw new Error(`Unsupported method: ${method}`);
    }
}

function writeJson(response, statusCode, payload) {
    response.writeHead(statusCode, { 'content-type': 'application/json' });
    response.end(JSON.stringify(payload));
}

function buildRpcSuccess(id, result) {
    return {
        jsonrpc: '2.0',
        id: id ?? null,
        result,
    };
}

function buildRpcError(id, code, message) {
    return {
        jsonrpc: '2.0',
        id: id ?? null,
        error: {
            code,
            message,
        },
    };
}

async function handleRpcPayload(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return buildRpcError(null, -32600, 'Invalid Request');
    }

    try {
        const result = await handleRpc(payload.method, payload.params);
        return buildRpcSuccess(payload.id, result);
    } catch (error) {
        const message = error?.message || String(error);
        const code = /Unsupported method/i.test(message) ? -32601 : -32000;
        return buildRpcError(payload.id, code, message);
    }
}

const server = http.createServer(async (request, response) => {
    if (request.method !== 'POST') {
        writeJson(response, 405, { error: 'Method Not Allowed' });
        return;
    }

    let body = '';
    request.on('data', (chunk) => {
        body += chunk;
    });

    request.on('end', async () => {
        try {
            const payload = JSON.parse(body || '{}');
            if (Array.isArray(payload)) {
                if (payload.length === 0) {
                    writeJson(response, 200, buildRpcError(null, -32600, 'Invalid Request'));
                    return;
                }
                const results = await Promise.all(payload.map((item) => handleRpcPayload(item)));
                writeJson(response, 200, results);
                return;
            }

            const result = await handleRpcPayload(payload);
            writeJson(response, 200, result);
        } catch (error) {
            const message = error?.message || String(error);
            writeJson(response, 500, buildRpcError(null, -32700, message));
        }
    });
});

server.listen(PORT, HOST, () => {
    console.log(`[fisco-rpc-compat] listening on http://${HOST}:${PORT}`);
    console.log(`[fisco-rpc-compat] console=${CONSOLE_BIN}`);
});
