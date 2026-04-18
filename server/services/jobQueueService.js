const redis = require('redis');
const { Queue, Worker, QueueEvents } = require('bullmq');

class JobQueueService {
    constructor() {
        this.client = null;
        this.queue = null;
        this.worker = null;
        this.queueEvents = null;
        this.isConnected = false;
    }

    async initialize() {
        try {
            // Initialize Redis client
            this.client = redis.createClient({
                host: process.env.REDIS_HOST || 'localhost',
                port: process.env.REDIS_PORT || 6379,
                password: process.env.REDIS_PASSWORD || undefined,
                maxRetriesPerRequest: null,
                enableReadyCheck: false,
                enableOfflineQueue: false
            });

            this.client.on('error', (err) => {
                console.error('[v0] Redis client error:', err);
                this.isConnected = false;
            });

            this.client.on('connect', () => {
                console.log('[v0] Redis connected');
                this.isConnected = true;
            });

            // Initialize job queue
            this.queue = new Queue('deployments', {
                connection: this.client,
                defaultJobOptions: {
                    attempts: 3,
                    backoff: {
                        type: 'exponential',
                        delay: 2000
                    },
                    removeOnComplete: {
                        age: 3600 // Keep completed jobs for 1 hour
                    },
                    removeOnFail: {
                        age: 86400 // Keep failed jobs for 24 hours
                    }
                }
            });

            // Initialize queue events
            this.queueEvents = new QueueEvents('deployments', { connection: this.client });

            console.log('[v0] Job queue service initialized');
            this.isConnected = true;
        } catch (error) {
            console.error('[v0] Failed to initialize job queue service:', error);
            this.isConnected = false;
            if (process.env.NODE_ENV === 'production') {
                throw error;
            }
        }
    }

    /**
     * Add a deployment job to the queue
     */
    async queueDeployment(deploymentId, options = {}) {
        if (!this.isConnected || !this.queue) {
            throw new Error('Job queue service not initialized');
        }

        const job = await this.queue.add('deployment', {
            deploymentId,
            ...options
        }, {
            jobId: `deployment-${deploymentId}`,
            priority: options.priority || 5
        });

        console.log(`[v0] Queued deployment job: ${job.id}`);
        return job;
    }

    /**
     * Get job by ID
     */
    async getJob(jobId) {
        if (!this.queue) return null;
        return await this.queue.getJob(jobId);
    }

    /**
     * Get all pending jobs
     */
    async getPendingJobs() {
        if (!this.queue) return [];
        return await this.queue.getJobs(['waiting']);
    }

    /**
     * Get active jobs
     */
    async getActiveJobs() {
        if (!this.queue) return [];
        return await this.queue.getJobs(['active']);
    }

    /**
     * Get completed jobs
     */
    async getCompletedJobs(count = 100) {
        if (!this.queue) return [];
        return await this.queue.getJobs(['completed'], 0, count - 1);
    }

    /**
     * Get failed jobs
     */
    async getFailedJobs(count = 100) {
        if (!this.queue) return [];
        return await this.queue.getJobs(['failed'], 0, count - 1);
    }

    /**
     * Get job status and progress
     */
    async getJobStatus(jobId) {
        const job = await this.getJob(jobId);
        if (!job) return null;

        const state = await job.getState();
        const progress = job._progress;

        return {
            id: job.id,
            state,
            progress,
            data: job.data,
            returnvalue: job.returnvalue,
            failedReason: job.failedReason,
            attemptsMade: job.attemptsMade,
            stacktrace: job.stacktrace,
            createdAt: new Date(job.timestamp),
            processedAt: job.processedOn ? new Date(job.processedOn) : null,
            finishedAt: job.finishedOn ? new Date(job.finishedOn) : null
        };
    }

    /**
     * Update job progress
     */
    async updateJobProgress(jobId, progress) {
        const job = await this.getJob(jobId);
        if (job) {
            await job.updateProgress(progress);
        }
    }

    /**
     * Set up event listeners for job events
     */
    setupEventListeners(eventHandlers = {}) {
        if (!this.queueEvents) return;

        const {
            onCompleted = () => {},
            onFailed = () => {},
            onProgress = () => {},
            onStateChanged = () => {}
        } = eventHandlers;

        this.queueEvents.on('completed', ({ jobId, returnvalue }) => {
            console.log(`[v0] Job ${jobId} completed:`, returnvalue);
            onCompleted({ jobId, returnvalue });
        });

        this.queueEvents.on('failed', ({ jobId, err }) => {
            console.log(`[v0] Job ${jobId} failed:`, err);
            onFailed({ jobId, err: err.message });
        });

        this.queueEvents.on('progress', ({ jobId, data }) => {
            console.log(`[v0] Job ${jobId} progress:`, data);
            onProgress({ jobId, data });
        });

        this.queueEvents.on('drained', () => {
            console.log('[v0] Queue drained - all available jobs processed');
        });
    }

    /**
     * Wait for a job to complete with timeout
     */
    async waitForJobCompletion(jobId, timeout = 600000) {
        const startTime = Date.now();
        const pollInterval = 5000; // Poll every 5 seconds

        while (Date.now() - startTime < timeout) {
            const job = await this.getJob(jobId);
            if (!job) return null;

            const state = await job.getState();
            if (state === 'completed') {
                return job.returnvalue;
            }

            if (state === 'failed') {
                throw new Error(`Job ${jobId} failed: ${job.failedReason}`);
            }

            // Wait before polling again
            await new Promise(resolve => setTimeout(resolve, pollInterval));
        }

        throw new Error(`Job ${jobId} timeout after ${timeout}ms`);
    }

    /**
     * Remove job
     */
    async removeJob(jobId) {
        const job = await this.getJob(jobId);
        if (job) {
            await job.remove();
        }
    }

    /**
     * Clean up old jobs
     */
    async cleanupOldJobs() {
        if (!this.queue) return;

        try {
            // Clean completed jobs older than 1 hour
            await this.queue.clean(3600000, 100, 'completed');
            
            // Clean failed jobs older than 24 hours
            await this.queue.clean(86400000, 100, 'failed');
            
            console.log('[v0] Job queue cleanup completed');
        } catch (error) {
            console.error('[v0] Error cleaning up job queue:', error);
        }
    }

    /**
     * Get queue statistics
     */
    async getQueueStats() {
        if (!this.queue) return null;

        try {
            const counts = await this.queue.getJobCounts(
                'wait',
                'active',
                'completed',
                'failed',
                'delayed'
            );

            return {
                waiting: counts.wait,
                active: counts.active,
                completed: counts.completed,
                failed: counts.failed,
                delayed: counts.delayed,
                total: Object.values(counts).reduce((a, b) => a + b, 0)
            };
        } catch (error) {
            console.error('[v0] Error getting queue stats:', error);
            return null;
        }
    }

    /**
     * Pause queue
     */
    async pauseQueue() {
        if (this.queue) {
            await this.queue.pause();
            console.log('[v0] Job queue paused');
        }
    }

    /**
     * Resume queue
     */
    async resumeQueue() {
        if (this.queue) {
            await this.queue.resume();
            console.log('[v0] Job queue resumed');
        }
    }

    /**
     * Close connection
     */
    async close() {
        try {
            if (this.queueEvents) {
                await this.queueEvents.close();
            }
            if (this.queue) {
                await this.queue.close();
            }
            if (this.client) {
                await this.client.quit();
            }
            this.isConnected = false;
            console.log('[v0] Job queue service closed');
        } catch (error) {
            console.error('[v0] Error closing job queue service:', error);
        }
    }
}

module.exports = new JobQueueService();
