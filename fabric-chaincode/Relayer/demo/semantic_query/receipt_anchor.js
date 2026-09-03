const { hashValue } = require('./audit_receipt');

const TERMINAL_STATE_CODES = Object.freeze({
    FAILED: 1,
    INSUFFICIENT_EVIDENCE: 2,
    ANCHORED: 3
});

const OUTCOME_CODES = Object.freeze({
    NONE: 0,
    SATISFIED: 1,
    UNSATISFIED: 2,
    INSUFFICIENT: 3
});

function asBytes32(value) {
    if (typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value)) return value;
    return hashValue(value);
}

class LocalReceiptAnchor {
    async anchor(receipt) {
        return {
            anchorId: `local:${receipt.queryId}`,
            chainId: 'LOCAL_TEST_ANCHOR',
            txHash: hashValue({ queryId: receipt.queryId, receiptRoot: receipt.receiptRoot }),
            blockHeight: null,
            mode: 'local-test-anchor',
            anchoredAt: new Date().toISOString()
        };
    }
}

class FiscoReceiptAnchor {
    constructor({ contract, chainId = 'FISCO_NET_01', confirmations = 1 } = {}) {
        if (!contract || typeof contract.anchorReceipt !== 'function') {
            throw new Error('FiscoReceiptAnchor requires a contract with anchorReceipt');
        }
        this.contract = contract;
        this.chainId = chainId;
        this.confirmations = confirmations;
        this._anchorTail = Promise.resolve();
    }

    anchor(receipt) {
        const enqueuedAt = process.hrtime.bigint();
        const operation = this._anchorTail.then(async () => {
            const startedAt = process.hrtime.bigint();
            const result = await this._anchor(receipt);
            const completedAt = process.hrtime.bigint();
            return {
                ...result,
                queueWaitMs: Number(startedAt - enqueuedAt) / 1e6,
                serviceMs: Number(completedAt - startedAt) / 1e6
            };
        });
        this._anchorTail = operation.catch(() => undefined);
        return operation;
    }

    async _anchor(receipt) {
        const terminalState = TERMINAL_STATE_CODES[receipt.terminalState];
        const outcome = OUTCOME_CODES[receipt.outcome || 'NONE'];
        if (terminalState === undefined) throw new Error(`Unsupported terminal state '${receipt.terminalState}'`);
        if (outcome === undefined) throw new Error(`Unsupported business outcome '${receipt.outcome}'`);

        const transaction = await this.contract.anchorReceipt(
            asBytes32(receipt.queryId),
            asBytes32(receipt.queryDigest),
            asBytes32(receipt.receiptRoot),
            terminalState,
            outcome
        );
        const transactionHash = transaction?.hash || transaction?.transactionHash || null;
        const transactionReceipt = typeof transaction?.wait === 'function'
            ? await transaction.wait(this.confirmations)
            : transaction;
        const blockHeight = transactionReceipt?.blockNumber === undefined
            ? null
            : Number(transactionReceipt.blockNumber);
        return {
            anchorId: `${this.chainId}:${transactionHash || receipt.receiptRoot}`,
            chainId: this.chainId,
            txHash: transactionHash,
            blockHeight,
            gasUsed: transactionReceipt?.gasUsed?.toString?.() || null,
            mode: 'fisco-contract-anchor',
            anchoredAt: new Date().toISOString(),
            terminalStateCode: terminalState,
            outcomeCode: outcome
        };
    }
}

class FiscoReceiptAnchorPool {
    constructor({ anchors, signerAddresses = [] } = {}) {
        if (!Array.isArray(anchors) || anchors.length < 1
            || anchors.some((anchor) => !anchor || typeof anchor.anchor !== 'function')) {
            throw new Error('FiscoReceiptAnchorPool requires at least one receipt anchor');
        }
        this.anchors = anchors;
        this.signerAddresses = signerAddresses;
        this._cursor = 0;
    }

    anchor(receipt) {
        const poolIndex = this._cursor % this.anchors.length;
        this._cursor += 1;
        return this.anchors[poolIndex].anchor(receipt).then((result) => ({
            ...result,
            anchorPoolIndex: poolIndex,
            anchorPoolSize: this.anchors.length,
            anchorSigner: this.signerAddresses[poolIndex] || null
        }));
    }
}

function createFiscoReceiptAnchorFromRuntime({ config, monitor, confirmations = 1 } = {}) {
    const fiscoChain = config?.chains?.find((chain) => chain.type === 'FISCO_BCOS' && chain.enabled);
    const contractAddress = fiscoChain?.contracts?.semanticAuditAnchor;
    const signer = monitor?.wallet || monitor?.provider;
    if (!contractAddress) throw new Error('FISCO semanticAuditAnchor contract address is not configured');
    if (!signer) throw new Error('An initialized FISCO monitor wallet or provider is required');
    if (!monitor?.wallet) throw new Error('A FISCO relayer wallet is required to anchor receipts');
    const { ethers } = require('ethers');
    const abi = require('../../abi/SemanticQueryAuditAnchor.json');
    const contract = new ethers.Contract(contractAddress, abi, signer);
    return new FiscoReceiptAnchor({ contract, chainId: fiscoChain.chainId, confirmations });
}

function createFiscoReceiptAnchorPoolFromRuntime({
    config,
    monitor,
    confirmations = 1,
    walletCount = 1
} = {}) {
    if (!Number.isInteger(walletCount) || walletCount < 1) {
        throw new Error('walletCount must be a positive integer');
    }
    if (walletCount === 1) return createFiscoReceiptAnchorFromRuntime({ config, monitor, confirmations });
    const fiscoChain = config?.chains?.find((chain) => chain.type === 'FISCO_BCOS' && chain.enabled);
    const contractAddress = fiscoChain?.contracts?.semanticAuditAnchor;
    if (!contractAddress) throw new Error('FISCO semanticAuditAnchor contract address is not configured');
    if (!monitor?.wallet || !monitor?.provider) {
        throw new Error('An initialized FISCO relayer wallet and provider are required');
    }
    const { ethers } = require('ethers');
    const abi = require('../../abi/SemanticQueryAuditAnchor.json');
    const wallets = [monitor.wallet];
    while (wallets.length < walletCount) wallets.push(ethers.Wallet.createRandom().connect(monitor.provider));
    const anchors = wallets.map((wallet) => new FiscoReceiptAnchor({
        contract: new ethers.Contract(contractAddress, abi, wallet),
        chainId: fiscoChain.chainId,
        confirmations
    }));
    return new FiscoReceiptAnchorPool({
        anchors,
        signerAddresses: wallets.map((wallet) => wallet.address)
    });
}

module.exports = {
    LocalReceiptAnchor,
    FiscoReceiptAnchor,
    FiscoReceiptAnchorPool,
    createFiscoReceiptAnchorFromRuntime,
    createFiscoReceiptAnchorPoolFromRuntime,
    TERMINAL_STATE_CODES,
    OUTCOME_CODES,
    asBytes32
};
