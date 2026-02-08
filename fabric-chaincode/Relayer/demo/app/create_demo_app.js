const express = require('express');
const { attachSseRoute } = require('../events/sse');
const { attachBasicRoutes } = require('../api/routes_basic');
const { attachTriggerRoutes } = require('../api/routes_triggers');
const { attachOrchardRoutes } = require('../api/routes_orchard');
const { attachQueryRoutes } = require('../api/routes_query');
const { attachProofCardRoutes } = require('../api/routes_proof_cards');
const { attachExplorerRoutes } = require('../api/routes_explorer');

function createDemoApp(demo) {
    const app = express();

    // Keep payload size consistent with the old implementation.
    app.use(express.json({ limit: '2mb' }));

    attachBasicRoutes(app, demo);
    attachOrchardRoutes(app, demo);
    attachQueryRoutes(app, demo);
    attachProofCardRoutes(app, demo);
    attachExplorerRoutes(app, demo);
    attachTriggerRoutes(app, demo);
    attachSseRoute(app, demo.eventStore);

    return app;
}

module.exports = { createDemoApp };

