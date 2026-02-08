function attachExplorerRoutes(app, demo) {
    app.get('/demo/explorer/overview', async (_req, res) => {
        try {
            const overview = await demo.relayer.getExplorerOverview();
            res.json({
                chains: overview?.chains || [],
                recentRelayMarkers: demo.buildRelayMarkers(120),
                updatedAt: new Date().toISOString()
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message || 'Failed to query explorer overview'
            });
        }
    });

    app.get('/demo/explorer/blocks', async (req, res) => {
        const chainId = String(req.query.chainId || '');
        if (!demo.EXPLORER_CHAIN_IDS.has(chainId)) {
            return res.status(400).json({
                success: false,
                error: `Invalid chainId '${chainId}', must be one of: ${Array.from(demo.EXPLORER_CHAIN_IDS).join(', ')}`
            });
        }

        const parsedLimit = demo.parseExplorerLimit(req.query.limit);
        if (parsedLimit.error) {
            return res.status(400).json({
                success: false,
                error: parsedLimit.error
            });
        }
        const limit = parsedLimit.value;

        const monitor = demo.relayer.getMonitor(chainId);
        if (!monitor) {
            return res.status(404).json({
                success: false,
                error: `Monitor for chain '${chainId}' is unavailable`
            });
        }

        if (typeof monitor.getRecentBlocks !== 'function') {
            return res.status(500).json({
                success: false,
                error: `Chain '${chainId}' does not support explorer blocks`
            });
        }

        try {
            const items = await monitor.getRecentBlocks(limit);
            return res.json({
                chainId,
                limit,
                items: Array.isArray(items) ? items : [],
                updatedAt: new Date().toISOString()
            });
        } catch (error) {
            return res.status(500).json({
                success: false,
                error: error.message || 'Failed to fetch explorer blocks'
            });
        }
    });
}

module.exports = { attachExplorerRoutes };

