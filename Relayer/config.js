/**
 * 中继服务配置
 */

class RelayerConfig {
    constructor(configData) {
        this.chains = configData.chains || [];
        this.relayer = configData.relayer || {};
        this.chainsMap = new Map();
        
        // 建立chainId到配置的映射
        for (const chain of this.chains) {
            this.chainsMap.set(chain.chainId, chain);
        }
    }
    
    /**
     * 获取链配置
     */
    getChainConfig(chainId) {
        return this.chainsMap.get(chainId);
    }
    
    /**
     * 获取所有链ID
     */
    getAllChainIds() {
        return Array.from(this.chainsMap.keys());
    }
    
    /**
     * 从JSON文件加载配置
     */
    static fromFile(filepath) {
        const fs = require('fs');
        const data = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
        return new RelayerConfig(data);
    }
}

module.exports = { RelayerConfig };
