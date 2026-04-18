const express = require('express');
const router = express.Router();
const portManagementService = require('../services/portManagementService');
const { validateRequest } = require('../middleware/validation');

/**
 * POST /api/ports/allocate
 * Allocate a port for a deployment
 */
router.post('/allocate', validateRequest(['deploymentId']), async (req, res) => {
    try {
        const { deploymentId, preferredPort } = req.body;

        const mapping = await portManagementService.allocatePort(deploymentId, {
            preferredPort
        });

        res.json({
            success: true,
            message: 'Port allocated',
            port: mapping.containerPort,
            mapping
        });
    } catch (error) {
        console.error('[v0] Error allocating port:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/ports/:deploymentId
 * Get port mapping for a deployment
 */
router.get('/:deploymentId', async (req, res) => {
    try {
        const { deploymentId } = req.params;
        const mapping = await portManagementService.getPortMapping(deploymentId);

        if (!mapping) {
            return res.status(404).json({
                success: false,
                error: 'Port mapping not found'
            });
        }

        res.json({
            success: true,
            port: mapping.containerPort,
            mapping
        });
    } catch (error) {
        console.error('[v0] Error getting port mapping:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/ports/:deploymentId/release
 * Release a port
 */
router.post('/:deploymentId/release', async (req, res) => {
    try {
        const { deploymentId } = req.params;
        const mapping = await portManagementService.releasePort(deploymentId);

        if (!mapping) {
            return res.status(404).json({
                success: false,
                error: 'Port mapping not found'
            });
        }

        res.json({
            success: true,
            message: 'Port released',
            mapping
        });
    } catch (error) {
        console.error('[v0] Error releasing port:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/ports
 * Get all active port mappings
 */
router.get('/', async (req, res) => {
    try {
        const mappings = await portManagementService.getAllActiveMappings();

        res.json({
            success: true,
            mappings,
            count: mappings.length
        });
    } catch (error) {
        console.error('[v0] Error getting port mappings:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/ports/stats
 * Get port utilization statistics
 */
router.get('/stats/utilization', async (req, res) => {
    try {
        const stats = await portManagementService.getPortStats();

        res.json({
            success: true,
            stats
        });
    } catch (error) {
        console.error('[v0] Error getting port stats:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;
