function attachQueryRoutes(app, demo) {
    function present(session, req) {
        if (typeof demo.presentQuerySession === 'function') {
            return demo.presentQuerySession(session, {
                includeProof: String(req?.query?.includeProof || '') === '1'
            });
        }
        return session;
    }

    app.post('/demo/app/query/request', async (req, res) => {
        try {
            const batchId = demo.normalizeBatchId(req.body?.orchardBatchId);
            const queryId = demo.createQueryId();

            const session = await demo.querySessionService.create({
                queryId,
                orchardBatchId: batchId
            });

            demo.activeQuerySessions.add(queryId);
            demo.eventStore.addEvent({
                type: 'query',
                direction: 'FISCO_TO_FABRIC',
                relayState: 'REQUEST_SENT',
                correlationId: queryId,
                message: `Query request created for ${batchId}`,
                data: {
                    queryId,
                    orchardBatchId: batchId
                }
            });

            demo.queryBroker.run(queryId).catch((error) => {
                demo.eventStore.addEvent({
                    level: 'error',
                    type: 'query',
                    direction: 'FISCO_TO_FABRIC',
                    relayState: 'FAILED',
                    correlationId: queryId,
                    errorCode: demo.mapSessionErrorCode(error),
                    message: error.message || String(error),
                    data: {
                        queryId,
                        orchardBatchId: batchId
                    }
                });
            });

            return res.status(202).json({
                success: true,
                queryId,
                session: present(session, req)
            });
        } catch (error) {
            const statusCode = error.statusCode || 500;
            return res.status(statusCode).json({
                success: false,
                error: error.message || 'Failed to create query session'
            });
        }
    });

    app.get('/demo/app/query/sessions', async (req, res) => {
        const parsedLimit = demo.parseQuerySessionLimit(req.query.limit);
        if (parsedLimit.error) {
            return res.status(400).json({
                success: false,
                error: parsedLimit.error
            });
        }
        return res.json({
            items: (await demo.querySessionService.list(parsedLimit.value)).map((item) => present(item, req)),
            updatedAt: new Date().toISOString()
        });
    });

    app.get('/demo/app/query/sessions/:queryId', async (req, res) => {
        const queryId = String(req.params.queryId || '');
        const session = await demo.querySessionService.get(queryId);
        if (!session) {
            return res.status(404).json({
                success: false,
                error: `Query session '${queryId}' not found`
            });
        }
        return res.json({
            item: present(session, req),
            updatedAt: new Date().toISOString()
        });
    });

    app.get('/demo/app/query/sessions/:queryId/verify', async (req, res) => {
        const queryId = String(req.params.queryId || '');
        const session = await demo.querySessionService.get(queryId);
        if (!session) {
            return res.status(404).json({
                success: false,
                error: `Query session '${queryId}' not found`
            });
        }

        const verified = typeof demo.executeVerifyQuery === 'function'
            ? demo.executeVerifyQuery(session)
            : null;

        if (!verified) {
            return res.status(409).json({
                success: false,
                error: `Query proof '${queryId}' not available`
            });
        }

        return res.json({
            success: true,
            queryId,
            verified,
            session: present(session, req),
            updatedAt: new Date().toISOString()
        });
    });
}

module.exports = { attachQueryRoutes };
