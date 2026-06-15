/**
 * GET /api/tasks/:taskId/evidence
 *
 * 供链驱动模式的 agent 拉取链下 evidence bundle。
 * Relayer 仅作数据服务器；agent 用链上 evidenceHash 独立验证完整性，
 * 无需信任 relayer 的返回值。
 */

function createEvidenceRoutes(router, { evidenceStore }) {
    router.get('/tasks/:taskId/evidence', (req, res) => {
        const { taskId } = req.params;
        const bundle = typeof evidenceStore.get === 'function'
            ? evidenceStore.get(taskId)
            : evidenceStore[taskId];

        if (!bundle) {
            return res.status(404).json({ success: false, error: 'Evidence not found', taskId });
        }
        res.json({ success: true, taskId, evidenceBundle: bundle });
    });

    return router;
}

module.exports = { createEvidenceRoutes };
