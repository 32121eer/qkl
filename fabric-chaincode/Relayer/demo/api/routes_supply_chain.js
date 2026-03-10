/**
 * 供应链演示 seed API — 一键写入当前场景的所有示例数据到 Fabric
 */

function attachSupplyChainRoutes(app, demo) {
    // POST /demo/app/supply-chain/seed
    // body: { records: [ { orchardBatchId, eventType, eventAt, sourceSystem, data, ... }, ... ] }
    app.post('/demo/app/supply-chain/seed', async (req, res) => {
        try {
            const body = req.body || {};
            const records = Array.isArray(body.records) ? body.records : [];
            if (!records.length) {
                return res.status(400).json({ success: false, error: 'records array is empty' });
            }

            const results = [];
            for (const raw of records) {
                const batchId = demo.normalizeBatchId(raw.orchardBatchId);
                const payload = {
                    payloadVersion: String(raw.payloadVersion || '1.0'),
                    orchardBatchId: batchId,
                    eventType: String(raw.eventType || 'unknown'),
                    eventAt: raw.eventAt || new Date().toISOString(),
                    sourceSystem: raw.sourceSystem || 'supply-chain-demo',
                    data: raw.data && typeof raw.data === 'object' ? raw.data : {}
                };

                const validation = demo.validateOrchardPayload(payload);
                if (!validation.valid) {
                    results.push({ orchardBatchId: batchId, success: false, error: 'validation failed', details: validation.errors });
                    continue;
                }

                try {
                    const txId = await demo.triggerService.putOrchardRecord(batchId, payload);
                    results.push({ orchardBatchId: batchId, success: true, txId });
                } catch (err) {
                    results.push({ orchardBatchId: batchId, success: false, error: err.message });
                }
            }

            const successCount = results.filter(r => r.success).length;
            return res.json({
                success: successCount > 0,
                total: records.length,
                successCount,
                failCount: records.length - successCount,
                results
            });
        } catch (error) {
            return res.status(500).json({
                success: false,
                error: error.message || 'Failed to seed supply chain records'
            });
        }
    });
}

module.exports = { attachSupplyChainRoutes };
