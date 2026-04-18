const jobQueueService = require('./jobQueueService');
const nodeManagementService = require('./nodeManagementService');

class JobSchedulerService {
    constructor() {
        this.scheduling = false;
        this.schedulingInterval = null;
        this.jobTimeout = 600000; // 10 minutes default
    }

    /**
     * Start the job scheduler
     */
    async startScheduler(pollInterval = 5000) {
        if (this.scheduling) return;

        console.log('[v0] Starting job scheduler...');
        this.scheduling = true;

        // Process jobs immediately
        await this.processJobs();

        // Then set up interval
        this.schedulingInterval = setInterval(async () => {
            try {
                await this.processJobs();
            } catch (error) {
                console.error('[v0] Error in scheduler loop:', error);
            }
        }, pollInterval);
    }

    /**
     * Stop the job scheduler
     */
    stopScheduler() {
        if (this.schedulingInterval) {
            clearInterval(this.schedulingInterval);
            this.schedulingInterval = null;
        }
        this.scheduling = false;
        console.log('[v0] Job scheduler stopped');
    }

    /**
     * Main scheduling loop - process pending jobs
     */
    async processJobs() {
        try {
            const pendingJobs = await jobQueueService.getPendingJobs();
            if (pendingJobs.length === 0) return;

            console.log(`[v0] Processing ${pendingJobs.length} pending jobs...`);

            // Get available nodes
            const availableNodes = await nodeManagementService.getAvailableNodes();
            if (availableNodes.length === 0) {
                console.log('[v0] No available worker nodes, jobs waiting in queue');
                return;
            }

            // Try to assign jobs to nodes
            for (const job of pendingJobs) {
                if (!job) continue;

                const assignedNode = await this.selectBestNode(availableNodes);
                if (!assignedNode) {
                    console.log('[v0] No capacity available, remaining jobs in queue');
                    break;
                }

                // Assign job to node
                try {
                    await this.assignJobToNode(job, assignedNode);
                    
                    // Update node capacity after assignment
                    assignedNode.activeContainers += 1;
                } catch (error) {
                    console.error(`[v0] Error assigning job ${job.id}:`, error.message);
                }
            }
        } catch (error) {
            console.error('[v0] Error in job processing loop:', error);
        }
    }

    /**
     * Select the best node based on capacity and resource utilization
     */
    async selectBestNode(availableNodes) {
        if (availableNodes.length === 0) return null;

        // Calculate capacity score for each node
        let bestNode = null;
        let bestScore = Infinity;

        for (const node of availableNodes) {
            // Check if node has capacity
            if (node.activeContainers >= 10) continue; // Max 10 containers per node
            
            // Calculate CPU and memory utilization
            const cpuLoad = node.cpuUsage || 0;
            const memoryLoad = node.memoryUsage || 0;
            const containerLoad = (node.activeContainers / 10) * 100;

            // Scoring: lower is better
            // Weighted score: 30% CPU + 30% Memory + 40% Container utilization
            const score = (cpuLoad * 0.3) + (memoryLoad * 0.3) + (containerLoad * 0.4);

            if (score < bestScore) {
                bestScore = score;
                bestNode = node;
            }
        }

        return bestNode;
    }

    /**
     * Assign a job to a specific node
     */
    async assignJobToNode(job, node) {
        try {
            console.log(`[v0] Assigning job ${job.id} to node ${node.nodeId}`);

            // Store node assignment in job metadata
            job.data = job.data || {};
            job.data.assignedNodeId = node.nodeId;
            job.data.assignedAt = new Date();

            await job.update(job.data);

            // Update job status to indicate it's been assigned
            await jobQueueService.updateJobProgress(job.id, {
                status: 'assigned',
                nodeId: node.nodeId,
                timestamp: new Date()
            });

            // Update node's active container count
            await nodeManagementService.incrementActiveContainers(node.nodeId);

            console.log(`[v0] Successfully assigned job ${job.id} to node ${node.nodeId}`);
            return true;
        } catch (error) {
            console.error(`[v0] Failed to assign job to node:`, error);
            throw error;
        }
    }

    /**
     * Handle job completion
     */
    async onJobCompleted(jobId, result) {
        try {
            const job = await jobQueueService.getJob(jobId);
            if (!job) return;

            const nodeId = job.data?.assignedNodeId;
            if (nodeId) {
                // Decrement active containers
                await nodeManagementService.decrementActiveContainers(nodeId);
            }

            console.log(`[v0] Job ${jobId} completed successfully`);
        } catch (error) {
            console.error(`[v0] Error handling job completion:`, error);
        }
    }

    /**
     * Handle job failure
     */
    async onJobFailed(jobId, error) {
        try {
            const job = await jobQueueService.getJob(jobId);
            if (!job) return;

            const nodeId = job.data?.assignedNodeId;
            if (nodeId) {
                // Mark node as having an error, but don't immediately fail it
                await nodeManagementService.recordNodeError(nodeId, error.message);
                
                // Decrement active containers
                await nodeManagementService.decrementActiveContainers(nodeId);
            }

            console.log(`[v0] Job ${jobId} failed: ${error.message}`);

            // Check if we should retry
            if (job.attemptsMade < job.opts.attempts) {
                console.log(`[v0] Job ${jobId} will be retried (attempt ${job.attemptsMade + 1}/${job.opts.attempts})`);
            } else {
                console.log(`[v0] Job ${jobId} exhausted all retry attempts`);
            }
        } catch (error) {
            console.error(`[v0] Error handling job failure:`, error);
        }
    }

    /**
     * Reschedule failed jobs
     */
    async rescheduleFailedJobs() {
        try {
            const failedJobs = await jobQueueService.getFailedJobs(100);
            console.log(`[v0] Found ${failedJobs.length} failed jobs to reschedule`);

            for (const job of failedJobs) {
                if (job.attemptsMade < 3) {
                    // Move job back to waiting queue for retry
                    await job.retry();
                    console.log(`[v0] Rescheduled job ${job.id} for retry`);
                }
            }
        } catch (error) {
            console.error('[v0] Error rescheduling failed jobs:', error);
        }
    }

    /**
     * Monitor job timeouts
     */
    async monitorJobTimeouts() {
        try {
            const activeJobs = await jobQueueService.getActiveJobs();
            const now = Date.now();

            for (const job of activeJobs) {
                const elapsedTime = now - job.processedOn;
                
                if (elapsedTime > this.jobTimeout) {
                    console.warn(`[v0] Job ${job.id} exceeded timeout (${elapsedTime}ms), marking as failed`);
                    await job.fail(new Error('Job timeout exceeded'));
                    
                    // Trigger failure handler
                    await this.onJobFailed(job.id, new Error('Job timeout'));
                }
            }
        } catch (error) {
            console.error('[v0] Error monitoring job timeouts:', error);
        }
    }

    /**
     * Get scheduler statistics
     */
    async getSchedulerStats() {
        try {
            const queueStats = await jobQueueService.getQueueStats();
            const nodeStats = await nodeManagementService.getNodeStats();

            return {
                queue: queueStats,
                nodes: nodeStats,
                isRunning: this.scheduling
            };
        } catch (error) {
            console.error('[v0] Error getting scheduler stats:', error);
            return null;
        }
    }

    /**
     * Set job timeout
     */
    setJobTimeout(timeout) {
        this.jobTimeout = timeout;
        console.log(`[v0] Job timeout set to ${timeout}ms`);
    }
}

module.exports = new JobSchedulerService();
