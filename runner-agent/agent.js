const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const NodeRegistry = require('./nodeRegistry');
const JobExecutor = require('./jobExecutor');
const { execSync } = require('child_process');
const os = require('os');

class Agent {
    constructor() {
        this.nodeId = process.env.NODE_ID || uuidv4();
        this.backendUrl = process.env.BACKEND_URL || 'http://localhost:3000';
        this.nodeRegistry = new NodeRegistry(this.nodeId, this.backendUrl);
        this.jobExecutor = new JobExecutor(this.nodeId, this.backendUrl);
        this.isRunning = false;
        this.heartbeatInterval = null;
        this.jobPollInterval = null;
        this.maxConcurrentJobs = parseInt(process.env.MAX_CONCURRENT_JOBS || '2');
        this.activeJobs = new Map();
    }

    /**
     * Start the agent
     */
    async start() {
        console.log(`[v0] Starting MSD Agent (ID: ${this.nodeId})`);
        
        try {
            // Register node with backend
            await this.nodeRegistry.register({
                hostname: os.hostname(),
                region: process.env.REGION || 'us-east-1',
                totalCapacity: {
                    cpu: os.cpus().length,
                    memory: Math.floor(os.totalmem() / 1024 / 1024), // Convert to MB
                    storage: 10240 // Default 10GB
                }
            });

            this.isRunning = true;

            // Start heartbeat
            this.startHeartbeat();

            // Start job polling
            this.startJobPolling();

            // Start monitoring
            this.startMonitoring();

            console.log('[v0] Agent started successfully');
        } catch (error) {
            console.error('[v0] Error starting agent:', error.message);
            throw error;
        }
    }

    /**
     * Start heartbeat to backend
     */
    startHeartbeat(interval = 10000) {
        this.heartbeatInterval = setInterval(async () => {
            try {
                const metrics = this.getSystemMetrics();
                await this.nodeRegistry.sendHeartbeat(metrics);
            } catch (error) {
                console.error('[v0] Heartbeat error:', error.message);
            }
        }, interval);

        console.log('[v0] Heartbeat started');
    }

    /**
     * Start polling for jobs
     */
    startJobPolling(interval = 5000) {
        this.jobPollInterval = setInterval(async () => {
            try {
                // Only poll if we have capacity
                if (this.activeJobs.size < this.maxConcurrentJobs) {
                    await this.pollJobs();
                }
            } catch (error) {
                console.error('[v0] Job polling error:', error.message);
            }
        }, interval);

        console.log('[v0] Job polling started');
    }

    /**
     * Poll for available jobs
     */
    async pollJobs() {
        try {
            const response = await axios.get(`${this.backendUrl}/api/jobs/pull`, {
                params: { nodeId: this.nodeId }
            });

            const jobs = response.data?.jobs || [];
            
            for (const job of jobs) {
                if (this.activeJobs.size >= this.maxConcurrentJobs) break;

                // Execute job asynchronously
                this.executeJobAsync(job);
            }
        } catch (error) {
            if (error.response?.status === 404) {
                // No jobs available
                return;
            }
            console.error('[v0] Error polling for jobs:', error.message);
        }
    }

    /**
     * Execute a job asynchronously
     */
    executeJobAsync(job) {
        const jobId = job.id || job.deploymentId;
        
        // Prevent duplicate execution
        if (this.activeJobs.has(jobId)) {
            console.warn(`[v0] Job ${jobId} already executing`);
            return;
        }

        // Mark as active
        this.activeJobs.set(jobId, {
            startTime: Date.now(),
            job
        });

        console.log(`[v0] Starting job execution: ${jobId}`);

        // Execute without awaiting
        this.jobExecutor.executeJob(job)
            .then((result) => {
                console.log(`[v0] Job ${jobId} completed successfully`);
                this.activeJobs.delete(jobId);
            })
            .catch((error) => {
                console.error(`[v0] Job ${jobId} failed:`, error.message);
                this.activeJobs.delete(jobId);
            });
    }

    /**
     * Get current system metrics
     */
    getSystemMetrics() {
        const cpus = os.cpus();
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const usedMem = totalMem - freeMem;

        // Calculate average CPU usage
        let avgCpuUsage = 0;
        const cpuUsages = cpus.map(cpu => {
            const total = Object.values(cpu.times).reduce((a, b) => a + b, 0);
            const idle = cpu.times.idle;
            return (1 - idle / total) * 100;
        });
        avgCpuUsage = cpuUsages.reduce((a, b) => a + b, 0) / cpuUsages.length;

        return {
            cpuUsage: Math.round(avgCpuUsage),
            memoryUsage: Math.round((usedMem / totalMem) * 100),
            diskUsage: 0, // Would need du command to calculate
            activeContainers: this.activeJobs.size,
            timestamp: new Date()
        };
    }

    /**
     * Start system monitoring
     */
    startMonitoring() {
        // Monitor active jobs for timeouts
        setInterval(() => {
            const now = Date.now();
            const jobTimeout = 600000; // 10 minutes

            for (const [jobId, jobData] of this.activeJobs) {
                const elapsed = now - jobData.startTime;
                if (elapsed > jobTimeout) {
                    console.warn(`[v0] Job ${jobId} exceeded timeout (${elapsed}ms)`);
                    // Job executor should handle this, but we can track it
                }
            }
        }, 60000); // Check every minute
    }

    /**
     * Shutdown the agent gracefully
     */
    async shutdown() {
        console.log('[v0] Shutting down agent...');
        this.isRunning = false;

        // Stop intervals
        if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
        if (this.jobPollInterval) clearInterval(this.jobPollInterval);

        // Wait for active jobs to complete (with timeout)
        const timeout = 30000; // 30 seconds
        const startTime = Date.now();

        while (this.activeJobs.size > 0 && Date.now() - startTime < timeout) {
            console.log(`[v0] Waiting for ${this.activeJobs.size} active jobs to complete...`);
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        if (this.activeJobs.size > 0) {
            console.warn(`[v0] ${this.activeJobs.size} jobs still running, forcing shutdown`);
        }

        console.log('[v0] Agent shutdown complete');
    }
}

module.exports = Agent;
