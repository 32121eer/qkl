const os = require('node:os');
const { ORCHARD_PAYLOAD_V1_SCHEMA } = require('../payload_schema');

function getWslIpCandidates() {
    const interfaces = os.networkInterfaces();
    const result = [];
    for (const records of Object.values(interfaces)) {
        for (const record of records || []) {
            if (record.family === 'IPv4' && !record.internal) {
                result.push(record.address);
            }
        }
    }
    return result;
}

function attachBasicRoutes(app, demo) {
    app.get('/health', (_req, res) => {
        res.json({
            status: 'ok',
            service: 'crosschain-relayer-demo-api',
            ts: new Date().toISOString()
        });
    });

    app.get('/status', (_req, res) => {
        res.json(demo.relayer.getStatus());
    });

    app.get('/demo/schema/orchard-v1', (_req, res) => {
        res.json(ORCHARD_PAYLOAD_V1_SCHEMA);
    });

    app.get('/demo/status', (_req, res) => {
        res.json({
            relayer: demo.relayer.getStatus(),
            activeTriggers: Array.from(demo.activeTriggers || []),
            activeQuerySessions: Array.from(demo.activeQuerySessions || []),
            sseClients: demo.eventStore.getClientCount(),
            recentEvents: demo.eventStore.getEvents(20),
            windowsAccess: {
                preferred: 'http://localhost:15173',
                fallbackCandidates: getWslIpCandidates().map((ip) => `http://${ip}:15173`)
            }
        });
    });

    app.get('/demo/events', (req, res) => {
        const limit = Number.parseInt(req.query.limit, 10);
        res.json({
            items: demo.eventStore.getEvents(Number.isNaN(limit) ? 200 : limit)
        });
    });
}

module.exports = { attachBasicRoutes };

