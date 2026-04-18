const express = require('express');
const router = express.Router();
const jobQueueService = require('../services/jobQueueService');
const jobSchedulerService = require('../services/jobSchedulerService');
const { validateRequest } = require('../middleware/validation');

/**
 * POST /api/jobs/queue
 * Queue a new deployment job
 */
router.post('/queue', validateRequest(['deploymentId']), async (req, res) => {
    try {
        const { deploymentId, options } = req.body;

        if (!jobQueueService.isConnected) {
            return res.status(503).json({
                success: false,
                error: 'Job queue service not available'
            });
        }

        const job = await jobQueueService.queueDeployment(deploymentId, options);

        res.json({
            success: true,
            message: 'Job queued',
            jobId: job.id,
            job
        });
    } catch (error) {
        console.error('[v0] Error queuing job:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/jobs/pull?nodeId=xxx
 * Pull available jobs for a worker node
 */
router.get('/pull', validateRequest(['nodeId']), async (req, res) => {
    try {
        const { nodeId } = req.query;
        const pendingJobs = await jobQueueService.getPendingJobs();

        if (pendingJobs.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'No jobs available'
            });
        }

        // Get a small batch of jobs (max 2)
        const jobs = pendingJobs.slice(0, 2).map(job => ({
            id: job.id,
            deploymentId: job.data.deploymentId,
            data: job.data
        }));

        res.json({
            success: true,
            jobs,
            count: jobs.length
        });
    } catch (error) {
        console.error('[v0] Error pulling jobs:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/jobs/:jobId
 * Get job status and progress
 */
router.get('/:jobId', async (req, res) => {
    try {
        const { jobId } = req.params;
        const status = await jobQueueService.getJobStatus(jobId);

        if (!status) {
            return res.status(404).json({
                success: false,
                error: 'Job not found'
            });
        }

        res.json({
            success: true,
            job: status
        });
    } catch (error) {
        console.error('[v0] Error getting job status:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/jobs
 * Get all jobs with optional filters
 */
router.get('/', async (req, res) => {
    try {
        const status = req.query.status;

        let jobs = [];
        if (status === 'pending') {
            jobs = await jobQueueService.getPendingJobs();
        } else if (status === 'active') {
            jobs = await jobQueueService.getActiveJobs();
        } else if (status === 'completed') {
            jobs = await jobQueueService.getCompletedJobs(100);
        } else if (status === 'failed') {
            jobs = await jobQueueService.getFailedJobs(100);
        }

        res.json({
            success: true,
            jobs: jobs.map(job => ({
                id: job.id,
                deploymentId: job.data?.deploymentId,
                state: job._state,
                progress: job._progress,
                attempts: job.attemptsMade
            })),
            count: jobs.length
        });
    } catch (error) {
        console.error('[v0] Error getting jobs:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/jobs/stats
 * Get queue statistics
 */
router.get('/stats/queue', async (req, res) => {
    try {
        const stats = await jobQueueService.getQueueStats();

        res.json({
            success: true,
            stats
        });
    } catch (error) {
        console.error('[v0] Error getting queue stats:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/jobs/:jobId/progress
 * Update job progress
 */
router.post('/:jobId/progress', async (req, res) => {
    try {
        const { jobId } = req.params;
        const { progress } = req.body;

        await jobQueueService.updateJobProgress(jobId, progress);

        res.json({
            success: true,
            message: 'Progress updated'
        });
    } catch (error) {
        console.error('[v0] Error updating job progress:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/jobs/:jobId/cancel
 * Cancel a job
 */
router.post('/:jobId/cancel', async (req, res) => {
    try {
        const { jobId } = req.params;
        const job = await jobQueueService.getJob(jobId);

        if (!job) {
            return res.status(404).json({
                success: false,
                error: 'Job not found'
            });
        }

        await job.remove();

        res.json({
            success: true,
            message: 'Job cancelled'
        });
    } catch (error) {
        console.error('[v0] Error cancelling job:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;
