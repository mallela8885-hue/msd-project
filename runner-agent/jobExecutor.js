const axios = require('axios');
const { spawn, exec } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const DockerManager = require('./dockerManager');

class JobExecutor {
    constructor(nodeId, backendUrl) {
        this.nodeId = nodeId;
        this.backendUrl = backendUrl;
        this.client = axios.create({
            baseURL: backendUrl,
            timeout: 600000 // 10 minutes for long-running jobs
        });
        this.dockerManager = new DockerManager();
    }

    /**
     * Execute a deployment job
     */
    async executeJob(job) {
        const deploymentId = job.deploymentId || job.id;
        console.log(`[v0] Executing job: ${deploymentId}`);

        try {
            // Update deployment status to building
            await this.updateDeploymentStatus(deploymentId, 'building');

            // Clone repository
            const workspaceDir = await this.cloneRepository(job);
            console.log(`[v0] Repository cloned to ${workspaceDir}`);

            // Generate Dockerfile
            await this.updateDeploymentStatus(deploymentId, 'dockerfile_generation');
            const dockerfile = await this.generateDockerfile(workspaceDir, job);

            // Build Docker image
            await this.updateDeploymentStatus(deploymentId, 'docker_building');
            const imageTag = await this.buildDockerImage(deploymentId, workspaceDir, dockerfile);
            console.log(`[v0] Docker image built: ${imageTag}`);

            // Run container
            await this.updateDeploymentStatus(deploymentId, 'docker_running');
            const result = await this.runDockerContainer(deploymentId, imageTag);

            // Update deployment status to success
            await this.updateDeploymentStatus(deploymentId, 'success', {
                url: `http://${process.env.NODE_IP || 'localhost'}:${result.port}`,
                imageTag,
                completedAt: new Date()
            });

            // Cleanup
            await this.cleanup(workspaceDir);

            return {
                deploymentId,
                status: 'success',
                url: result.url,
                imageTag
            };
        } catch (error) {
            console.error(`[v0] Job execution error: ${error.message}`);
            await this.updateDeploymentStatus(deploymentId, 'failed', {
                error: error.message,
                completedAt: new Date()
            });
            throw error;
        }
    }

    /**
     * Clone repository from GitHub
     */
    async cloneRepository(job) {
        const deploymentId = job.deploymentId || job.id;
        const branch = job.branch || 'main';
        const repoUrl = job.repositoryUrl || job.gitUrl;
        const accessToken = job.accessToken || process.env.GITHUB_TOKEN;

        if (!repoUrl) {
            throw new Error('Repository URL not provided');
        }

        // Build clone URL with token if available
        let cloneUrl = repoUrl;
        if (accessToken && repoUrl.includes('github.com')) {
            cloneUrl = repoUrl.replace('https://github.com/', `https://${accessToken}@github.com/`);
        }

        const workspaceDir = path.join('/tmp', 'msd-builds', deploymentId);
        await fs.mkdir(workspaceDir, { recursive: true });

        return new Promise((resolve, reject) => {
            const process = spawn('git', ['clone', '--depth', '1', '--branch', branch, cloneUrl, workspaceDir]);

            let stderr = '';
            process.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            process.on('close', (code) => {
                if (code === 0) {
                    console.log(`[v0] Repository cloned successfully`);
                    resolve(workspaceDir);
                } else {
                    reject(new Error(`Git clone failed: ${stderr}`));
                }
            });

            process.on('error', reject);
        });
    }

    /**
     * Generate Dockerfile
     */
    async generateDockerfile(workspaceDir, job) {
        // For now, use a simple Node.js Dockerfile
        // In production, would use the dockerfileGenerator from backend
        
        const dockerfile = `FROM node:18-alpine

WORKDIR /app

COPY package*.json ./

RUN npm ci --only=production

COPY . .

EXPOSE 3000

CMD ["npm", "start"]
`;

        const dockerfilePath = path.join(workspaceDir, 'Dockerfile');
        await fs.writeFile(dockerfilePath, dockerfile);

        return dockerfile;
    }

    /**
     * Build Docker image
     */
    async buildDockerImage(deploymentId, workspaceDir, dockerfile) {
        const imageName = `msd-${deploymentId.toString().slice(-8)}`;
        const imageTag = `${imageName}:latest`;

        return new Promise((resolve, reject) => {
            const process = spawn('docker', [
                'build',
                '-t', imageTag,
                '--memory=256m',
                '--memory-swap=256m',
                '.'
            ], {
                cwd: workspaceDir,
                stdio: ['pipe', 'pipe', 'pipe']
            });

            let output = '';
            process.stdout.on('data', (data) => {
                output += data.toString();
                this.appendLog(deploymentId, data.toString());
            });

            process.stderr.on('data', (data) => {
                output += data.toString();
                this.appendLog(deploymentId, data.toString(), 'error');
            });

            process.on('close', (code) => {
                if (code === 0) {
                    resolve(imageTag);
                } else {
                    reject(new Error(`Docker build failed with code ${code}`));
                }
            });

            process.on('error', reject);
        });
    }

    /**
     * Run Docker container
     */
    async runDockerContainer(deploymentId, imageTag) {
        // Get port from backend
        const port = await this.allocatePort(deploymentId);
        const containerName = `msd-${deploymentId.toString().slice(-8)}`;

        return new Promise((resolve, reject) => {
            const process = spawn('docker', [
                'run',
                '--rm',
                '--name', containerName,
                '--memory=256m',
                '--cpus=0.5',
                '-p', `${port}:3000`,
                '-e', 'NODE_ENV=production',
                imageTag
            ]);

            let output = '';
            process.stdout.on('data', (data) => {
                output += data.toString();
                this.appendLog(deploymentId, data.toString());
            });

            process.stderr.on('data', (data) => {
                output += data.toString();
                this.appendLog(deploymentId, data.toString(), 'error');
            });

            process.on('close', (code) => {
                if (code === 0 || code === 143) { // 143 is SIGTERM
                    resolve({
                        port,
                        url: `http://localhost:${port}`,
                        containerName
                    });
                } else {
                    reject(new Error(`Docker run failed with code ${code}`));
                }
            });

            process.on('error', reject);

            // Monitor container and timeout after 10 minutes
            setTimeout(() => {
                console.log(`[v0] Container ${containerName} timeout, stopping...`);
                process.kill('SIGTERM');
            }, 600000);
        });
    }

    /**
     * Allocate a port from backend
     */
    async allocatePort(deploymentId) {
        try {
            const response = await this.client.post('/api/ports/allocate', {
                deploymentId,
                nodeId: this.nodeId
            });
            return response.data?.port || 3001;
        } catch (error) {
            console.error('[v0] Failed to allocate port:', error.message);
            // Fallback to default port
            return 3001;
        }
    }

    /**
     * Update deployment status
     */
    async updateDeploymentStatus(deploymentId, status, updates = {}) {
        try {
            await this.client.post(`/api/deployments/${deploymentId}/status`, {
                status,
                ...updates
            });
        } catch (error) {
            console.error(`[v0] Failed to update deployment status: ${error.message}`);
        }
    }

    /**
     * Append log to deployment
     */
    async appendLog(deploymentId, message, level = 'info') {
        try {
            await this.client.post(`/api/deployments/${deploymentId}/logs`, {
                message: message.trim(),
                level,
                timestamp: new Date()
            });
        } catch (error) {
            // Silently fail on log errors to avoid blocking execution
            console.log(`[v0] Log append error: ${error.message}`);
        }
    }

    /**
     * Cleanup workspace
     */
    async cleanup(workspaceDir) {
        try {
            await fs.rm(workspaceDir, { recursive: true, force: true });
            console.log(`[v0] Workspace cleaned: ${workspaceDir}`);
        } catch (error) {
            console.warn(`[v0] Failed to cleanup workspace: ${error.message}`);
        }
    }
}

module.exports = JobExecutor;
