function attachProofCardRoutes(app, demo) {
    app.get('/demo/app/proof-cards', async (req, res) => {
        const parsedLimit = demo.parseProofCardLimit(req.query.limit);
        if (parsedLimit.error) {
            return res.status(400).json({
                success: false,
                error: parsedLimit.error
            });
        }
        const items = await demo.buildProofCards(parsedLimit.value);
        return res.json({
            items,
            updatedAt: new Date().toISOString()
        });
    });

    app.get('/demo/app/proof-cards/:cardId', async (req, res) => {
        const cardId = String(req.params.cardId || '');
        const cards = await demo.buildProofCards(demo.PROOF_MAX_LIMIT || 100);
        const item = cards.find((card) => card.cardId === cardId);
        if (!item) {
            return res.status(404).json({
                success: false,
                error: `Proof card '${cardId}' not found`
            });
        }
        return res.json({
            item,
            updatedAt: new Date().toISOString()
        });
    });
}

module.exports = { attachProofCardRoutes };
