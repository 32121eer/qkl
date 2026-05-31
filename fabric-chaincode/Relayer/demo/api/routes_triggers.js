function attachTriggerRoutes(app, demo) {
    app.post('/demo/trigger/fabric-to-fisco', async (req, res) => {
        try {
            const payload = demo.normalizeRequestPayload(req.body || {});
            const result = await demo.executeTrigger('FABRIC_TO_FISCO', async () => {
                return demo.triggerService.triggerFabricToFisco(payload);
            });
            res.json(result);
        } catch (error) {
            const statusCode = error.statusCode || 500;
            const errorCode = demo.mapErrorCode(error.message);
            demo.eventStore.addEvent({
                level: 'error',
                type: 'trigger',
                direction: 'FABRIC_TO_FISCO',
                relayState: 'FAILED',
                errorCode,
                message: error.message,
                data: { details: error.details || [] }
            });
            res.status(statusCode).json({
                success: false,
                error: error.message,
                errorCode,
                details: error.details || []
            });
        }
    });

    app.post('/demo/trigger/fisco-to-fabric', async (req, res) => {
        try {
            const payload = demo.normalizeRequestPayload(req.body || {});
            const result = await demo.executeTrigger('FISCO_TO_FABRIC', async () => {
                return demo.triggerService.triggerFiscoToFabric(payload);
            });
            res.json(result);
        } catch (error) {
            const statusCode = error.statusCode || 500;
            const errorCode = demo.mapErrorCode(error.message);
            demo.eventStore.addEvent({
                level: 'error',
                type: 'trigger',
                direction: 'FISCO_TO_FABRIC',
                relayState: 'FAILED',
                errorCode,
                message: error.message,
                data: { details: error.details || [] }
            });
            res.status(statusCode).json({
                success: false,
                error: error.message,
                errorCode,
                details: error.details || []
            });
        }
    });
}

module.exports = { attachTriggerRoutes };

