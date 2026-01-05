/**
 * 区块头提取器
 * 将不同链的区块格式转换为标准化格式
 */

class BlockHeaderExtractor {
    
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
        
        return {
            chainId: chainId,
            blockNumber: parseInt(header.number, 16) || header.number,
            timestamp: parseInt(header.timestamp, 16) || header.timestamp,
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
        // Fabric区块结构
        const header = block.header;
        const metadata = block.metadata;
        
        return {
            chainId: chainId,
            blockNumber: parseInt(header.number),
            timestamp: this.extractFabricTimestamp(block),
            previousHash: Buffer.from(header.previous_hash).toString('hex'),
            transactionsRoot: Buffer.from(header.data_hash).toString('hex'),
            stateRoot: this.calculateFabricStateRoot(block),
            consensusProof: this.extractFabricConsensusProof(metadata),
            consensusType: 'RAFT', // 或根据配置确定
            validatorSignatures: this.extractFabricSignatures(metadata),
            extraData: JSON.stringify({
                channelId: block.channelId,
                txCount: block.data.data.length
            })
        };
    }
    
    /**
     * 提取Fabric时间戳
     */
    extractFabricTimestamp(block) {
        // 从第一个交易的时间戳提取
        if (block.data && block.data.data && block.data.data.length > 0) {
            // 这里需要解析protobuf格式的交易
            // 简化处理
            return Math.floor(Date.now() / 1000);
        }
        return Math.floor(Date.now() / 1000);
    }
    
    /**
     * 计算Fabric状态根
     */
    calculateFabricStateRoot(block) {
        // Fabric没有显式的状态根，使用data_hash作为替代
        return Buffer.from(block.header.data_hash).toString('hex');
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
