function attachOrchardRoutes(app, demo) {
    app.get('/demo/app/orchard', async (req, res) => {
        try {
            const parsedLimit = demo.parseExplorerLimit(req.query.limit);
            if (parsedLimit.error) {
                return res.status(400).json({
                    success: false,
                    error: parsedLimit.error
                });
            }
            const bookmark = String(req.query.bookmark || '');
            const result = await demo.triggerService.listOrchardRecords(parsedLimit.value, bookmark);
            return res.json({
                success: true,
                ...result
            });
        } catch (error) {
            return res.status(500).json({
                success: false,
                error: error.message || 'Failed to list orchard records'
            });
        }
    });

    app.get('/demo/app/orchard/:batchId', async (req, res) => {
        try {
            const batchId = demo.normalizeBatchId(req.params.batchId);
            const record = await demo.triggerService.getOrchardRecord(batchId);
            return res.json({
                success: true,
                orchardBatchId: batchId,
                record
            });
        } catch (error) {
            const message = String(error?.message || '');
            const statusCode = /not found/i.test(message) ? 404 : 500;
            return res.status(statusCode).json({
                success: false,
                error: message || 'Failed to query orchard record'
            });
        }
    });

    app.post('/demo/app/orchard/upsert', async (req, res) => {
        try {
            const body = req.body || {};
            const batchId = demo.normalizeBatchId(body.orchardBatchId || body.payload?.orchardBatchId);
            const rawPayload = (body.payload && typeof body.payload === 'object') ? body.payload : body;
            const payload = {
                payloadVersion: String(rawPayload.payloadVersion || '1.0'),
                orchardBatchId: batchId,
                eventType: String(rawPayload.eventType || 'unknown'),
                eventAt: rawPayload.eventAt || new Date().toISOString(),
                sourceSystem: rawPayload.sourceSystem || 'orchard-demo',
                data: rawPayload.data && typeof rawPayload.data === 'object' ? rawPayload.data : {}
            };

            const validation = demo.validateOrchardPayload(payload);
            if (!validation.valid) {
                return res.status(400).json({
                    success: false,
                    error: 'OrchardPayloadV1 validation failed',
                    details: validation.errors
                });
            }

            const txId = await demo.triggerService.putOrchardRecord(batchId, payload);
            return res.json({
                success: true,
                orchardBatchId: batchId,
                txId
            });
        } catch (error) {
            return res.status(500).json({
                success: false,
                error: error.message || 'Failed to upsert orchard record'
            });
        }
    });
}

module.exports = { attachOrchardRoutes };

