#!/usr/bin/env node

/**
 * 跨链中继服务主入口
 */

const { RelayerService } = require('./relayer');
const { RelayerConfig } = require('./config');
const express = require('express');

// 加载配置
const configPath = process.argv[2] || './config.json';
console.log(`[Main] Loading configuration from: ${configPath}`);

let config;
try {
    config = RelayerConfig.fromFile(configPath);
} catch (error) {
    console.error(`[Main] Failed to load config:`, error.message);
    process.exit(1);
}

// 创建中继服务
const relayer = new RelayerService(config);

// 监听事件
relayer.on('blockRelayed', (data) => {
    console.log(`[Main] Block relayed: ${data.sourceChainId} #${data.blockNumber} -> ${data.targetsCount} chains`);
});

relayer.on('messageRelayed', (data) => {
    console.log(`[Main] Message relayed: ${data.from} -> ${data.to}, tx: ${data.txHash}`);
});

relayer.on('error', (data) => {
    console.error(`[Main] Error:`, data.error.message);
});

// API服务器（可选）
let app;
if (config.api && config.api.enabled) {
    app = express();
    app.use(express.json());
    
    // 健康检查
    app.get('/health', (req, res) => {
        res.json({ status: 'ok', service: 'crosschain-relayer' });
    });
    
    // 获取状态
    app.get('/status', (req, res) => {
        const status = relayer.getStatus();
        res.json(status);
    });
    
    // 手动触发区块头同步
    app.post('/sync/:chainId', async (req, res) => {
        try {
            const { chainId } = req.params;
            // TODO: 实现手动同步逻辑
            res.json({ success: true, chainId });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });
    
    app.listen(config.api.port, config.api.host, () => {
        console.log(`[Main] API server listening on ${config.api.host}:${config.api.port}`);
    });
}

// 优雅退出
const shutdown = async () => {
    console.log('[Main] Shutting down...');
    await relayer.stop();
    if (app) {
        // 关闭API服务器
    }
    process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// 启动服务
(async () => {
    try {
        console.log('[Main] Starting CrossChain Relayer Service...');
        await relayer.initialize();
        await relayer.start();
        console.log('[Main] Relayer service is running');
    } catch (error) {
        console.error('[Main] Failed to start relayer:', error);
        process.exit(1);
    }
})();
