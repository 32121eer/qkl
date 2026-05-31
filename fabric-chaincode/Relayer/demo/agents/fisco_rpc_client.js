/**
 * FISCO-BCOS RPC Client for AgentRegistry
 * Direct HTTP RPC calls compatible with FISCO 3.x
 */

const crypto = require('crypto');

class FiscoRpcClient {
    constructor({
        rpcEndpoint = 'http://127.0.0.1:20200',
        privateKey = null,
        groupId = 1
    } = {}) {
        this.rpcEndpoint = rpcEndpoint;
        this.privateKey = privateKey;
        this.groupId = groupId;
    }

    async _callRpc(method, params) {
        const response = await fetch(this.rpcEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                method,
                params,
                id: Date.now()
            })
        });

        if (!response.ok) {
            throw new Error(`RPC error: ${response.status}`);
        }

        const data = await response.json();
        if (data.error) {
            throw new Error(`RPC error: ${data.error.message}`);
        }

        return data.result;
    }

    /**
     * Call contract function (read-only)
     */
    async callContract(contractAddress, abi, functionName, args = []) {
        // Find function ABI
        const funcAbi = abi.find(item =>
            item.type === 'function' &&
            (item.name === functionName || item.name === functionName.split('(')[0])
        );

        if (!funcAbi) {
            throw new Error(`Function ${functionName} not found in ABI`);
        }

        // Encode function call
        const selector = this._encodeSelector(funcAbi);
        const encodedArgs = this._encodeArgs(args, funcAbi.inputs);
        const data = selector + encodedArgs;

        // Call via FISCO call RPC
        const result = await this._callRpc('call', [{
            groupId: this.groupId,
            from: '0x0000000000000000000000000000000000000000',
            to: contractAddress,
            data: data
        }]);

        return this._decodeResult(result, funcAbi.outputs);
    }

    /**
     * Send transaction to contract
     */
    async sendTransaction(contractAddress, abi, functionName, args = []) {
        if (!this.privateKey) {
            throw new Error('Private key required for transactions');
        }

        const funcAbi = abi.find(item =>
            item.type === 'function' && item.name === functionName
        );

        if (!funcAbi) {
            throw new Error(`Function ${functionName} not found in ABI`);
        }

        const selector = this._encodeSelector(funcAbi);
        const encodedArgs = this._encodeArgs(args, funcAbi.inputs);
        const data = selector + encodedArgs;

        // Get transaction count (FISCO uses getBlockNumber or specific API)
        // For now, use a simpler approach with FISCO's sendTransaction
        const txData = {
            groupId: this.groupId,
            to: contractAddress,
            data: data,
            value: '0x0'
        };

        // FISCO 3.x supports eth_sendTransaction with managed accounts
        // But for external accounts, we need to sign the transaction
        // This is a simplified version - production should use proper signing
        const result = await this._callRpc('sendTransaction', [this.groupId, txData]);
        return result;
    }

    _encodeSelector(funcAbi) {
        const signature = `${funcAbi.name}(${funcAbi.inputs.map(i => i.type).join(',')})`;
        return crypto.createHash('sha3-256').update(signature).digest('hex').substring(0, 8);
    }

    _encodeArgs(args, inputs) {
        // Simplified encoding - production should use proper ABI encoding
        let encoded = '';
        for (let i = 0; i < args.length; i++) {
            const arg = args[i];
            const type = inputs[i].type;

            if (type === 'string') {
                // String encoding: offset (32 bytes) + length (32 bytes) + data (padded)
                // Simplified - just return placeholder
                encoded += '0000000000000000000000000000000000000000000000000000000000000000';
            } else if (type.startsWith('uint')) {
                const hex = BigInt(arg).toString(16).padStart(64, '0');
                encoded += hex;
            } else if (type === 'bool') {
                encoded += arg ? '0000000000000000000000000000000000000000000000000000000000000001'
                               : '0000000000000000000000000000000000000000000000000000000000000000';
            } else if (type === 'bytes32') {
                encoded += arg.replace('0x', '').padStart(64, '0');
            }
        }
        return encoded;
    }

    _decodeResult(result, outputs) {
        if (!result || result.status !== 0) {
            return null;
        }
        // Simplified decoding
        return result.output || result;
    }
}

module.exports = { FiscoRpcClient };
