#!/usr/bin/env node

const { RelayerService } = require('./relayer');
const { RelayerConfig } = require('./config');
const { DemoApiServer } = require('./demo/api_server');

function resolveApiSettings(configData) {
    const apiConfig = configData.api || {};
    const demoEnabled = String(process.env.DEMO_API_ENABLED || '').toLowerCase() === 'true';
    const enabled = demoEnabled || apiConfig.enabled === true;
    const host = process.env.DEMO_API_HOST || apiConfig.host || '0.0.0.0';

    const defaultPort = demoEnabled ? 18080 : 8080;
    const rawPort = process.env.DEMO_API_PORT || apiConfig.port || defaultPort;
    const port = Number.parseInt(rawPort, 10);

    return {
        enabled,
        host,
        port: Number.isNaN(port) ? defaultPort : port
    };
}

async function main() {
    const configPath = process.argv[2] || './config.json';
    console.log(`[Main] Loading configuration from: ${configPath}`);

    let config;
    try {
        config = RelayerConfig.fromFile(configPath);
    } catch (error) {
        console.error('[Main] Failed to load config:', error.message);
        process.exit(1);
    }

    const relayer = new RelayerService(config);
    let demoApiServer = null;
    let shuttingDown = false;

    relayer.on('blockRelayed', (data) => {
        console.log(`[Main] Block relayed: ${data.sourceChainId} #${data.blockNumber} -> ${data.targetsCount} chains`);
    });
    relayer.on('messageRelayed', (data) => {
        console.log(`[Main] Message relayed: ${data.from} -> ${data.to}, tx: ${data.txHash}`);
    });
    relayer.on('error', (data) => {
        console.error('[Main] Error:', data.error.message);
    });

    const shutdown = async () => {
        if (shuttingDown) {
            return;
        }
        shuttingDown = true;
        console.log('[Main] Shutting down...');
        try {
            if (demoApiServer) {
                await demoApiServer.stop();
            }
            await relayer.stop();
        } catch (error) {
            console.error('[Main] Shutdown error:', error.message);
        } finally {
            process.exit(0);
        }
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    try {
        console.log('[Main] Starting CrossChain Relayer Service...');
        await relayer.initialize();
        await relayer.start();
        console.log('[Main] Relayer service is running');

        const apiSettings = resolveApiSettings(config);
        if (apiSettings.enabled) {
            demoApiServer = new DemoApiServer(relayer, config);
            await demoApiServer.start(apiSettings.host, apiSettings.port);
            console.log(`[Main] Demo API server listening on ${apiSettings.host}:${apiSettings.port}`);
        }
    } catch (error) {
        console.error('[Main] Failed to start relayer:', error);
        process.exit(1);
    }
}

main();
