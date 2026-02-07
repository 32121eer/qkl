/**
 * 区块头提取器
 * 将不同链的区块格式转换为标准化格式
 */

class BlockHeaderExtractor {

    toHex(bytes) {
        if (!bytes) return '';
        if (typeof bytes === 'string') return bytes;
        // Buffer / Uint8Array
        return Buffer.from(bytes).toString('hex');
    }

    /**
     * 将输入转换为 bytes32 形式的 0x...（不足左侧补 0）
     * 注意：这里只做格式归一化，不保证其语义等同于链原生 block hash
     */
    toBytes32Hex(input) {
        let hex = this.toHex(input);
        if (!hex) return '0x' + '0'.repeat(64);
        if (hex.startsWith('0x')) hex = hex.slice(2);
        // 截断或补齐到 32 bytes
        if (hex.length > 64) hex = hex.slice(hex.length - 64);
        if (hex.length < 64) hex = hex.padStart(64, '0');
        return '0x' + hex;
    }
    
    /**
     * 提取标准化区块头
     */
    async extractBlockHeader(chainId, block, chainConfig) {
        switch (chainConfig.type) {
            case 'FISCO_BCOS':
                return this.extractFiscoBcosHeader(chainId, block);
            case 'FABRIC':
                return this.extractFabricHeader(chainId, block);
            default:
                throw new Error(`Unsupported chain type: ${chainConfig.type}`);
        }
    }
    
    /**
     * 提取FISCO-BCOS区块头
     */
    extractFiscoBcosHeader(chainId, block) {
        // FISCO-BCOS区块结构
        const header = block.header || block;

        const parseMaybeHexNumber = (v) => {
            if (typeof v === 'string') {
                if (v.startsWith('0x') || v.startsWith('0X')) return parseInt(v, 16);
                return parseInt(v, 10);
            }
            if (typeof v === 'number') return v;
            // ethers may return BigInt
            if (typeof v === 'bigint') return Number(v);
            return Number(v);
        };

        return {
            chainId: chainId,
            blockNumber: parseMaybeHexNumber(header.number),
            timestamp: parseMaybeHexNumber(header.timestamp),
            blockHash: header.hash || header.blockHash,
            previousHash: header.parentHash || header.previousHash,
            transactionsRoot: header.transactionsRoot || header.txRoot,
            stateRoot: header.stateRoot,
            consensusProof: header.extraData || header.consensusProof || '0x',
            consensusType: 'PBFT', // FISCO-BCOS使用PBFT
            validatorSignatures: this.extractFiscoBcosSignatures(header),
            extraData: header.extraData || '0x'
        };
    }
    
    /**
     * 提取FISCO-BCOS验证者签名
     */
    extractFiscoBcosSignatures(header) {
        const signatures = [];
        
        // FISCO-BCOS的签名在extraData中
        if (header.extraData && header.extraData.length > 2) {
            // extraData格式: 0x + vanity(32字节) + signatures + seal(65字节)
            // 这里简化处理，实际需要根据具体格式解析
            const extraData = header.extraData.slice(2); // 移除0x
            
            // 每个签名65字节
            const signatureLength = 130; // 65 * 2 (hex)
            for (let i = 64; i < extraData.length - 130; i += signatureLength) {
                if (i + signatureLength <= extraData.length - 130) {
                    signatures.push('0x' + extraData.slice(i, i + signatureLength));
                }
            }
        }
        
        return signatures;
    }
    
    /**
     * 提取Fabric区块头
     */
    extractFabricHeader(chainId, block) {
        // Fabric区块结构（支持完整区块和简化区块）
        const header = block.header || {};
        const metadata = block.metadata || [];
        
        // 解析区块号：优先从 block.number，否则从 header.number
        let blockNumber = 0;
        const rawNumber = block.number !== undefined ? block.number : header.number;
        if (rawNumber != null) {
            if (typeof rawNumber === 'number') {
                blockNumber = rawNumber;
            } else if (typeof rawNumber === 'bigint') {
                blockNumber = Number(rawNumber);
            } else if (typeof rawNumber === 'string') {
                blockNumber = parseInt(rawNumber, 10);
            } else if (typeof rawNumber === 'object' && typeof rawNumber.toString === 'function') {
                // Long 对象（protobufjs）
                blockNumber = parseInt(rawNumber.toString(), 10);
            }
        }
        
        // 计算交易数量（安全访问）
        let txCount = 0;
        if (block.data && block.data.data && Array.isArray(block.data.data)) {
            txCount = block.data.data.length;
        }
        
        return {
            chainId: chainId,
            blockNumber: blockNumber,
            // 优先使用 monitor 传入的 timestamp，否则使用当前时间
            timestamp: block.timestamp || Date.now(),
            // 统一输出 bytes32 hex（0x...）
            previousHash: this.toBytes32Hex(header.previous_hash || Buffer.alloc(32)),
            // transactionsRoot：优先使用 monitor 计算的 Merkle root
            transactionsRoot: block.transactionsRoot
                ? this.toBytes32Hex(block.transactionsRoot)
                : this.toBytes32Hex(header.data_hash || Buffer.alloc(32)),
            // Fabric 没有原生 stateRoot，使用占位值
            stateRoot: this.toBytes32Hex(this.calculateFabricStateRoot(block)),
            consensusProof: metadata.length > 0 ? this.extractFabricConsensusProof(metadata) : '0x',
            consensusType: 'RAFT',
            validatorSignatures: metadata.length > 0 ? this.extractFabricSignatures(metadata) : [],
            extraData: JSON.stringify({
                chainType: block.chainType || 'FABRIC',
                txCount: txCount
            })
        };
    }
    
    /**
     * 提取Fabric时间戳
     */
    extractFabricTimestamp(block) {
        // 简化处理：如果没有提供 timestamp，返回当前时间
        // 对于完整区块，可以从交易中提取，但这里简化处理
        return Date.now();
    }
    
    /**
     * 计算Fabric状态根
     */
    calculateFabricStateRoot(block) {
        // Fabric没有显式的状态根，使用data_hash作为替代
        if (block.header && block.header.data_hash) {
            return Buffer.from(block.header.data_hash).toString('hex');
        }
        // 如果没有 data_hash，返回空哈希
        return Buffer.alloc(32).toString('hex');
    }
    
    /**
     * 提取Fabric共识证明
     */
    extractFabricConsensusProof(metadata) {
        if (!metadata || !metadata.metadata) {
            return '0x';
        }
        
        // metadata[0]包含signatures
        const signaturesMetadata = metadata.metadata[0];
        if (signaturesMetadata) {
            return Buffer.from(signaturesMetadata).toString('hex');
        }
        
        return '0x';
    }
    
    /**
     * 提取Fabric签名
     */
    extractFabricSignatures(metadata) {
        const signatures = [];
        
        if (!metadata || !metadata.metadata || !metadata.metadata[0]) {
            return signatures;
        }
        
        try {
            // 解析signatures metadata
            // 实际需要使用protobuf解析
            // 这里简化处理
            const sigData = metadata.metadata[0];
            if (sigData && sigData.signatures) {
                for (const sig of sigData.signatures) {
                    signatures.push(Buffer.from(sig.signature).toString('hex'));
                }
            }
        } catch (error) {
            console.warn('[Extractor] Failed to extract Fabric signatures:', error);
        }
        
        return signatures;
    }
    
    /**
     * 验证提取的区块头
     */
    validateBlockHeader(header) {
        const required = [
            'chainId',
            'blockNumber',
            'timestamp',
            'previousHash',
            'transactionsRoot',
            'stateRoot',
            'consensusType'
        ];
        
        for (const field of required) {
            if (!header[field] && header[field] !== 0) {
                throw new Error(`Missing required field: ${field}`);
            }
        }
        
        return true;
    }
}

module.exports = { BlockHeaderExtractor };
