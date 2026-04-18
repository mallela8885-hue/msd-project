const express = require('express');
const router = express.Router();
const nodeManagementService = require('../services/nodeManagementService');
const { validateRequest } = require('../middleware/validation');

/**
 * POST /api/nodes/register
 * Register a new worker node
 */
router.post('/register', validateRequest(['nodeId', 'hostname']), async (req, res) => {
    try {
        const { nodeId, hostname, region, totalCapacity } = req.body;

        const node = await nodeManagementService.registerNode({
            nodeId,
            hostname,
            region,
            totalCapacity
        });

        res.json({
            success: true,
            message: 'Node registered successfully',
            node
        });
    } catch (error) {
        console.error('[v0] Error registering node:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/nodes/heartbeat
 * Update node heartbeat and metrics
 */
router.post('/heartbeat', validateRequest(['nodeId']), async (req, res) => {
    try {
        const { nodeId, metrics } = req.body;

        const node = await nodeManagementService.updateNodeHeartbeat(nodeId, metrics);

        res.json({
            success: true,
            message: 'Heartbeat received',
            node
        });
    } catch (error) {
        console.error('[v0] Error updating heartbeat:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/nodes
 * Get all worker nodes
 */
router.get('/', async (req, res) => {
    try {
        const status = req.query.status;
        const nodes = await nodeManagementService.getAllNodes(status);

        res.json({
            success: true,
            nodes,
            count: nodes.length
        });
    } catch (error) {
        console.error('[v0] Error getting nodes:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/nodes/available
 * Get available worker nodes
 */
router.get('/available', async (req, res) => {
    try {
        const nodes = await nodeManagementService.getAvailableNodes();

        res.json({
            success: true,
            nodes,
            count: nodes.length
        });
    } catch (error) {
        console.error('[v0] Error getting available nodes:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/nodes/:nodeId
 * Get node details
 */
router.get('/:nodeId', async (req, res) => {
    try {
        const { nodeId } = req.params;
        const node = await nodeManagementService.getNode(nodeId);

        if (!node) {
            return res.status(404).json({
                success: false,
                error: 'Node not found'
            });
        }

        const capacity = await nodeManagementService.getNodeCapacity(nodeId);

        res.json({
            success: true,
            node,
            capacity
        });
    } catch (error) {
        console.error('[v0] Error getting node:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/nodes/stats
 * Get node statistics
 */
router.get('/stats/overview', async (req, res) => {
    try {
        const stats = await nodeManagementService.getNodeStats();

        res.json({
            success: true,
            stats
        });
    } catch (error) {
        console.error('[v0] Error getting node stats:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * DELETE /api/nodes/:nodeId
 * Delete a node
 */
router.delete('/:nodeId', async (req, res) => {
    try {
        const { nodeId } = req.params;
        const result = await nodeManagementService.deleteNode(nodeId);

        res.json({
            success: true,
            message: 'Node deleted',
            result
        });
    } catch (error) {
        console.error('[v0] Error deleting node:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/nodes/:nodeId/error
 * Report an error from a node
 */
router.post('/:nodeId/error', async (req, res) => {
    try {
        const { nodeId } = req.params;
        const { error, context } = req.body;

        await nodeManagementService.recordNodeError(nodeId, error);

        res.json({
            success: true,
            message: 'Error recorded'
        });
    } catch (error) {
        console.error('[v0] Error recording node error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;
