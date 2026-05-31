function attachSseRoute(app, eventBus) {
    app.get('/demo/stream', (req, res) => {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive'
        });
        res.write('retry: 2000\n\n');

        eventBus.attachClient(res);
        const timer = setInterval(() => {
            res.write(`event: ping\ndata: ${Date.now()}\n\n`);
        }, 15_000);

        req.on('close', () => {
            clearInterval(timer);
            eventBus.detachClient(res);
        });
    });
}

module.exports = { attachSseRoute };

