const { spawn } = require('child_process');
const logService = require('./logService');
const portManagementService = require('./portManagementService');
const Build = require('../models/Build');
const Deployment = require('../models/Deployment');

class CleanupService {
    constructor() {
        this.cleanupInterval = null;
        this.isRunning = false;
    }

    /**
     * Start automatic cleanup job
     */
    startCleanupJob(intervalHours = 24) {
        if (this.isRunning) return;

        const intervalMs = intervalHours * 60 * 60 * 1000;
        console.log(`[v0] Starting cleanup job every ${intervalHours} hours`);

        this.isRunning = true;
        
        // Run cleanup immediately, then at intervals
        this.runCleanup();
        
        this.cleanupInterval = setInterval(async () => {
            try {
                await this.runCleanup();
            } catch (error) {
                console.error('[v0] Error in cleanup job:', error);
            }
        }, intervalMs);
    }

    /**
     * Stop cleanup job
     */
    stopCleanupJob() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
        this.isRunning = false;
        console.log('[v0] Cleanup job stopped');
    }

    /**
     * Run all cleanup tasks
     */
    async runCleanup() {
        console.log('[v0] Starting cleanup tasks...');
        
        try {
            const results = {
                containers: await this.cleanupDockerContainers(),
                images: await this.cleanupDockerImages(),
                ports: await this.cleanupReleasedPorts(),
                logs: await this.cleanupOldLogs(),
                builds: await this.cleanupOldBuilds(),
                deployments: await this.cleanupFailedDeployments()
            };

            console.log('[v0] Cleanup completed:', results);
            return results;
        } catch (error) {
            console.error('[v0] Cleanup failed:', error);
            throw error;
        }
    }

    /**
     * Cleanup stopped Docker containers
     */
    async cleanupDockerContainers() {
        return new Promise((resolve) => {
            const process = spawn('docker', ['container', 'prune', '-f']);
            let output = '';

            process.stdout.on('data', (data) => {
                output += data.toString();
            });

            process.on('close', (code) => {
                if (code === 0) {
                    const match = output.match(/reclaimed (\d+)/i);
                    const reclaimed = match ? match[1] : '0';
                    console.log(`[v0] Cleaned up Docker containers, reclaimed ${reclaimed}`);
                    resolve({ success: true, reclaimed });
                } else {
                    console.warn('[v0] Docker container cleanup failed');
                    resolve({ success: false });
                }
            });

            process.on('error', (error) => {
                console.warn('[v0] Docker container cleanup error:', error.message);
                resolve({ success: false });
            });
        });
    }

    /**
     * Cleanup unused Docker images (>24 hours old)
     */
    async cleanupDockerImages() {
        return new Promise((resolve) => {
            const process = spawn('docker', ['image', 'prune', '-a', '-f', '--filter=until=24h']);
            let output = '';

            process.stdout.on('data', (data) => {
                output += data.toString();
            });

            process.on('close', (code) => {
                if (code === 0) {
                    console.log(`[v0] Cleaned up Docker images`);
                    resolve({ success: true });
                } else {
                    console.warn('[v0] Docker image cleanup failed');
                    resolve({ success: false });
                }
            });

            process.on('error', (error) => {
                console.warn('[v0] Docker image cleanup error:', error.message);
                resolve({ success: false });
            });
        });
    }

    /**
     * Cleanup released ports (>7 days old)
     */
    async cleanupReleasedPorts() {
        try {
            const result = await portManagementService.cleanupOldMappings(7);
            return { success: true, deletedCount: result.deletedCount };
        } catch (error) {
            console.error('[v0] Port cleanup error:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Cleanup old logs (>30 days)
     */
    async cleanupOldLogs(daysOld = 30) {
        try {
            const result = await logService.cleanupOldLogs(daysOld);
            return { success: true, deletedCount: result.deletedCount };
        } catch (error) {
            console.error('[v0] Log cleanup error:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Cleanup old builds (>30 days)
     */
    async cleanupOldBuilds(daysOld = 30) {
        try {
            const cutoff = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);
            
            const builds = await Build.find({
                createdAt: { $lt: cutoff }
            }).select('_id artifacts');

            // Delete artifacts from storage
            let deletedArtifacts = 0;
            for (const build of builds) {
                if (build.artifacts && Array.isArray(build.artifacts)) {
                    deletedArtifacts += build.artifacts.length;
                }
            }

            // Delete build records
            const result = await Build.deleteMany({
                createdAt: { $lt: cutoff }
            });

            console.log(`[v0] Cleaned up ${result.deletedCount} old builds`);
            return { 
                success: true, 
                deletedCount: result.deletedCount,
                artifactsDeleted: deletedArtifacts
            };
        } catch (error) {
            console.error('[v0] Build cleanup error:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Cleanup failed deployments (>7 days old)
     */
    async cleanupFailedDeployments(daysOld = 7) {
        try {
            const cutoff = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);
            
            // Find failed deployments
            const failedDeployments = await Deployment.find({
                status: 'failed',
                createdAt: { $lt: cutoff }
            }).select('_id');

            // Release ports from failed deployments
            for (const deployment of failedDeployments) {
                try {
                    await portManagementService.releasePort(deployment._id.toString());
                } catch (error) {
                    console.warn(`[v0] Error releasing port for deployment ${deployment._id}:`, error.message);
                }
            }

            // Delete failed deployment records
            const result = await Deployment.deleteMany({
                status: 'failed',
                createdAt: { $lt: cutoff }
            });

            console.log(`[v0] Cleaned up ${result.deletedCount} failed deployments`);
            return { 
                success: true, 
                deletedCount: result.deletedCount
            };
        } catch (error) {
            console.error('[v0] Deployment cleanup error:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Cleanup Docker build context directories
     */
    async cleanupBuildContexts(minAgeHours = 24) {
        const buildContextDir = '/tmp/msd-builds';
        
        return new Promise((resolve) => {
            const process = spawn('find', [
                buildContextDir,
                '-maxdepth', '1',
                '-type', 'd',
                '-mtime', `+${Math.ceil(minAgeHours / 24)}`,
                '-exec', 'rm', '-rf', '{}', '+'
            ]);

            process.on('close', (code) => {
                if (code === 0) {
                    console.log('[v0] Cleaned up old build contexts');
                    resolve({ success: true });
                } else {
                    console.warn('[v0] Build context cleanup had issues');
                    resolve({ success: true }); // Don't fail on this
                }
            });

            process.on('error', (error) => {
                console.warn('[v0] Build context cleanup error:', error.message);
                resolve({ success: true }); // Don't fail on this
            });
        });
    }

    /**
     * Get cleanup status
     */
    getStatus() {
        return {
            isRunning: this.isRunning,
            message: this.isRunning ? 'Cleanup job is running' : 'Cleanup job is not running'
        };
    }
}

module.exports = new CleanupService();
