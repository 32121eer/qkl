/**
 * FISCO 本地数据 API — 模拟 FISCO 侧业务数据（采购单、市场预测等）
 * 使用 Demo Store 层存储，无需部署新合约。
 */

function attachFiscoLocalRoutes(app, demo) {
    const store = demo.store;

    // POST /demo/app/fisco-local/seed — 批量写入
    app.post('/demo/app/fisco-local/seed', async (req, res) => {
        try {
            const records = Array.isArray(req.body?.records) ? req.body.records : [];
            if (!records.length) {
                return res.status(400).json({ success: false, error: 'records array is empty' });
            }

            const results = [];
            for (const raw of records) {
                if (!raw.recordId) {
                    results.push({ recordId: null, success: false, error: 'missing recordId' });
                    continue;
                }
                try {
                    const record = {
                        recordId: raw.recordId,
                        category: raw.category || 'general',
                        title: raw.title || raw.recordId,
                        data: raw.data || {},
                        needsCrossChainData: raw.needsCrossChainData || null,
                        createdAt: new Date().toISOString()
                    };
                    await store.saveFiscoLocalRecord(record);
                    results.push({ recordId: raw.recordId, success: true });
                } catch (err) {
                    results.push({ recordId: raw.recordId, success: false, error: err.message });
                }
            }

            const successCount = results.filter(r => r.success).length;
            return res.json({
                success: successCount > 0,
                total: records.length,
                successCount,
                results
            });
        } catch (error) {
            return res.status(500).json({ success: false, error: error.message });
        }
    });

    // GET /demo/app/fisco-local — 列表查询
    app.get('/demo/app/fisco-local', async (req, res) => {
        try {
            const limit = Number(req.query.limit) || 50;
            const category = req.query.category || null;
            const items = await store.listFiscoLocalRecords(limit, category);
            return res.json({ success: true, items });
        } catch (error) {
            return res.status(500).json({ success: false, error: error.message });
        }
    });

    // GET /demo/app/fisco-local/:recordId — 单条查询
    app.get('/demo/app/fisco-local/:recordId', async (req, res) => {
        try {
            const record = await store.getFiscoLocalRecord(req.params.recordId);
            if (!record) {
                return res.status(404).json({ success: false, error: 'not found' });
            }
            return res.json({ success: true, record });
        } catch (error) {
            return res.status(500).json({ success: false, error: error.message });
        }
    });
}

module.exports = { attachFiscoLocalRoutes };
