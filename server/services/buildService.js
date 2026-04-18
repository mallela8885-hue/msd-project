const mongoose = require('mongoose');
const Build = require('../models/Build');
const Project = require('../models/Project');
const { spawn, exec } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const archiver = require('archiver');
const crypto = require('crypto');
const dockerfileGenerator = require('./dockerfileGenerator');

class BuildService {
    constructor() {
        this.activeBuildProcesses = new Map();
    }

    async createBuild(projectId, options = {}) {
        const {
            branch = 'main',
            commitSha = null,
            deploymentId = null,
            buildConfig = {},
            triggeredBy = 'manual',
            userId = null
        } = options;

        const project = await Project.findById(projectId);
        if (!project) throw new Error('Project not found');

        const build = await Build.create({
            projectId,
            branch,
            commitSha,
            deploymentId,
            status: 'pending',
            buildConfig: {
                ...project.buildSettings,
                ...buildConfig
            },
            triggeredBy,
            userId,
            startTime: new Date(),
            logs: [],
            artifacts: []
        });

        // Start build process
        this.processBuild(build._id).catch(error => {
            console.error(`Build ${build._id} failed:`, error);
        });

        return build;
    }

    async processBuild(buildId) {
        const build = await Build.findById(buildId).populate('projectId');
        if (!build) throw new Error('Build not found');

        try {
            // Check if Docker build is enabled
            if (build.buildConfig.useDocker && process.env.DOCKER_ENABLED === 'true') {
                console.log(`[v0] Using Docker execution for build ${buildId}`);
                await this.dockerBuild(build);
            } else {
                // Use traditional build process
                await this.traditionalBuild(build, buildId);
            }
        } catch (error) {
            await this.updateBuildStatus(buildId, 'failed', {
                error: error.message,
                endTime: new Date(),
                duration: Date.now() - build.startTime.getTime()
            });
            throw error;
        } finally {
            this.activeBuildProcesses.delete(buildId);
        }
    }

    async traditionalBuild(build, buildId) {
        const buildId_ = build._id;
        const workspaceDir = await this.cloneRepository(build);
        
        await this.updateBuildStatus(buildId_, 'installing');
        
        // Install dependencies
        await this.installDependencies(build, workspaceDir);
        
        await this.updateBuildStatus(buildId_, 'building');
        
        // Run build
        const buildResult = await this.runBuild(build, workspaceDir);
        
        await this.updateBuildStatus(buildId_, 'packaging');
        
        // Package artifacts
        const artifacts = await this.packageArtifacts(build, workspaceDir, buildResult);
        
        await this.updateBuildStatus(buildId_, 'success', {
            artifacts,
            endTime: new Date(),
            duration: Date.now() - build.startTime.getTime(),
            buildSize: artifacts.reduce((sum, a) => sum + (a.size || 0), 0)
        });

        // Cleanup workspace
        await this.cleanupWorkspace(workspaceDir);
    }

    async dockerBuild(build) {
        const buildId = build._id;
        const workspaceDir = await this.cloneRepository(build);

        try {
            await this.updateBuildStatus(buildId, 'dockerfile_generation');
            
            // Generate Dockerfile
            const dockerfile = await dockerfileGenerator.generateDockerfile(
                workspaceDir,
                build.buildConfig
            );
            
            // Write Dockerfile to workspace
            const dockerfilePath = path.join(workspaceDir, 'Dockerfile');
            await fs.writeFile(dockerfilePath, dockerfile);

            // Write nginx.conf for SPA projects if needed
            const nginxConfig = dockerfileGenerator.generateNginxConfig();
            const nginxPath = path.join(workspaceDir, 'nginx.conf');
            await fs.writeFile(nginxPath, nginxConfig);

            await this.updateBuildStatus(buildId, 'docker_building');
            
            // Build Docker image
            const imageName = `msd-build-${build.projectId._id.toString().slice(-8)}-${buildId.toString().slice(-8)}`;
            const imageTag = `${imageName}:${build.commitSha?.slice(0, 7) || 'latest'}`;
            
            await this.buildDockerImage(buildId, workspaceDir, imageTag);

            await this.updateBuildStatus(buildId, 'docker_running');
            
            // Run container and capture output
            const container = await this.runDockerContainer(buildId, imageTag, workspaceDir);
            
            await this.updateBuildStatus(buildId, 'packaging');
            
            // Package artifacts from container output directory
            const artifacts = await this.packageDockerArtifacts(build, imageTag, workspaceDir);
            
            await this.updateBuildStatus(buildId, 'success', {
                artifacts,
                endTime: new Date(),
                duration: Date.now() - build.startTime.getTime(),
                buildSize: artifacts.reduce((sum, a) => sum + (a.size || 0), 0),
                executionMethod: 'docker',
                imageName: imageTag
            });

            // Cleanup Docker resources
            await this.cleanupDockerResources(imageTag);

        } catch (error) {
            await this.addBuildLog(buildId, `Docker build error: ${error.message}`, 'error');
            // Cleanup on error
            try {
                await this.cleanupDockerResources(`msd-build-*`);
            } catch (cleanupError) {
                console.error('[v0] Cleanup error:', cleanupError);
            }
            throw error;
        } finally {
            await this.cleanupWorkspace(workspaceDir);
        }
    }

    async buildDockerImage(buildId, workspaceDir, imageTag) {
        return new Promise((resolve, reject) => {
            const dockerCmd = `docker build -t ${imageTag} --memory=256m --memory-swap=256m .`;
            
            const process = spawn('docker', ['build', '-t', imageTag, '--memory=256m', '--memory-swap=256m', '.'], {
                cwd: workspaceDir,
                stdio: ['pipe', 'pipe', 'pipe']
            });

            let output = '';

            process.stdout.on('data', (data) => {
                const message = data.toString();
                output += message;
                this.addBuildLog(buildId, message.trim(), 'info');
            });

            process.stderr.on('data', (data) => {
                const message = data.toString();
                output += message;
                this.addBuildLog(buildId, message.trim(), 'error');
            });

            process.on('close', (code) => {
                if (code === 0) {
                    console.log(`[v0] Docker image built successfully: ${imageTag}`);
                    resolve({ output, code });
                } else {
                    reject(new Error(`Docker build failed with code ${code}`));
                }
            });

            process.on('error', reject);
        });
    }

    async runDockerContainer(buildId, imageTag, workspaceDir) {
        return new Promise((resolve, reject) => {
            const containerName = `build-${buildId.toString().slice(-8)}`;
            
            // Run container with environment variables and memory limits
            const dockerArgs = [
                'run',
                '--rm',
                '--name', containerName,
                '--memory=256m',
                '--cpus=0.5',
                '-e', 'NODE_ENV=production',
                imageTag
            ];

            const process = spawn('docker', dockerArgs, {
                stdio: ['pipe', 'pipe', 'pipe']
            });

            let output = '';

            process.stdout.on('data', (data) => {
                const message = data.toString();
                output += message;
                this.addBuildLog(buildId, message.trim(), 'info');
            });

            process.stderr.on('data', (data) => {
                const message = data.toString();
                output += message;
                this.addBuildLog(buildId, message.trim(), 'error');
            });

            process.on('close', (code) => {
                if (code === 0) {
                    resolve({ containerName, output, code });
                } else {
                    reject(new Error(`Docker run failed with code ${code}`));
                }
            });

            process.on('error', reject);
        });
    }

    async packageDockerArtifacts(build, imageTag, workspaceDir) {
        const artifacts = [];
        const artifactsDir = path.join(process.cwd(), 'storage', 'artifacts', build._id.toString());
        
        await fs.mkdir(artifactsDir, { recursive: true });

        // For Docker builds, we primarily care about the build metadata
        const buildMetadata = {
            type: 'docker-build',
            imageTag,
            timestamp: new Date(),
            projectId: build.projectId._id,
            commitSha: build.commitSha,
            outputDirectory: build.buildConfig.outputDirectory || 'dist'
        };

        // Create a manifest file with build information
        const manifestPath = path.join(artifactsDir, 'manifest.json');
        await fs.writeFile(manifestPath, JSON.stringify(buildMetadata, null, 2));

        const stats = await fs.stat(manifestPath);
        artifacts.push({
            type: 'manifest',
            path: manifestPath,
            size: stats.size,
            hash: await this.calculateFileHash(manifestPath),
            createdAt: new Date()
        });

        return artifacts;
    }

    async cleanupDockerResources(imageTag) {
        return new Promise((resolve) => {
            // Remove Docker image
            const process = spawn('docker', ['rmi', imageTag]);
            
            process.on('close', () => {
                console.log(`[v0] Cleaned up Docker image: ${imageTag}`);
                resolve();
            });

            process.on('error', (error) => {
                console.warn('[v0] Error cleaning up Docker image:', error.message);
                resolve(); // Don't fail on cleanup errors
            });
        });
    }

    async cloneRepository(build) {
        const project = build.projectId;
        const workspaceDir = path.join(process.cwd(), 'tmp', 'builds', build._id.toString());
        
        await fs.mkdir(workspaceDir, { recursive: true });
        
        const cloneCommand = this.buildGitCloneCommand(project, build.branch, workspaceDir);
        await this.executeCommand(build._id, cloneCommand, workspaceDir);
        
        // Checkout specific commit if provided
        if (build.commitSha) {
            await this.executeCommand(build._id, ['git', 'checkout', build.commitSha], workspaceDir);
        }
        
        return workspaceDir;
    }

    buildGitCloneCommand(project, branch, workspaceDir) {
        const repoUrl = this.buildRepositoryUrl(project);
        return ['git', 'clone', '--depth', '1', '--branch', branch, repoUrl, workspaceDir];
    }

    buildRepositoryUrl(project) {
        const { gitProvider, repositoryUrl, accessToken } = project.gitIntegration;
        
        if (accessToken && gitProvider === 'github') {
            return repositoryUrl.replace('https://github.com/', `https://${accessToken}@github.com/`);
        }
        
        return repositoryUrl;
    }

    async installDependencies(build, workspaceDir) {
        const packageManager = await this.detectPackageManager(workspaceDir);
        const installCommand = this.getInstallCommand(packageManager);
        
        await this.addBuildLog(build._id, `Installing dependencies with ${packageManager}`);
        await this.executeCommand(build._id, installCommand, workspaceDir);
    }

    async detectPackageManager(workspaceDir) {
        try {
            await fs.access(path.join(workspaceDir, 'yarn.lock'));
            return 'yarn';
        } catch {}
        
        try {
            await fs.access(path.join(workspaceDir, 'pnpm-lock.yaml'));
            return 'pnpm';
        } catch {}
        
        return 'npm';
    }

    getInstallCommand(packageManager) {
        const commands = {
            npm: ['npm', 'ci'],
            yarn: ['yarn', 'install', '--frozen-lockfile'],
            pnpm: ['pnpm', 'install', '--frozen-lockfile']
        };
        return commands[packageManager] || commands.npm;
    }

    async runBuild(build, workspaceDir) {
        const buildConfig = build.buildConfig;
        const buildCommand = buildConfig.buildCommand || 'npm run build';
        const command = buildCommand.split(' ');
        
        await this.addBuildLog(build._id, `Running build command: ${buildCommand}`);
        
        // Set environment variables
        const env = {
            ...process.env,
            NODE_ENV: 'production',
            ...buildConfig.environmentVariables
        };
        
        await this.executeCommand(build._id, command, workspaceDir, { env });
        
        // Verify build output
        const outputDir = path.join(workspaceDir, buildConfig.outputDirectory || 'dist');
        try {
            await fs.access(outputDir);
            return { outputDir, success: true };
        } catch {
            throw new Error(`Build output directory not found: ${outputDir}`);
        }
    }

    async packageArtifacts(build, workspaceDir, buildResult) {
        const artifacts = [];
        const artifactsDir = path.join(process.cwd(), 'storage', 'artifacts', build._id.toString());
        
        await fs.mkdir(artifactsDir, { recursive: true });
        
        // Package build output
        const buildArtifact = await this.createArtifactArchive(
            buildResult.outputDir,
            path.join(artifactsDir, 'build.tar.gz'),
            'build'
        );
        artifacts.push(buildArtifact);
        
        // Package source code if needed
        if (build.buildConfig.includeSource) {
            const sourceArtifact = await this.createArtifactArchive(
                workspaceDir,
                path.join(artifactsDir, 'source.tar.gz'),
                'source',
                ['node_modules', '.git', 'tmp']
            );
            artifacts.push(sourceArtifact);
        }
        
        return artifacts;
    }

    async createArtifactArchive(sourceDir, outputPath, type, excludePatterns = []) {
        return new Promise((resolve, reject) => {
            const output = require('fs').createWriteStream(outputPath);
            const archive = archiver('tar', { gzip: true });
            
            output.on('close', async () => {
                const stats = await fs.stat(outputPath);
                const hash = await this.calculateFileHash(outputPath);
                
                resolve({
                    type,
                    path: outputPath,
                    size: stats.size,
                    hash,
                    createdAt: new Date()
                });
            });
            
            archive.on('error', reject);
            archive.pipe(output);
            
            archive.glob('**/*', {
                cwd: sourceDir,
                ignore: excludePatterns
            });
            
            archive.finalize();
        });
    }

    async calculateFileHash(filePath) {
        const hash = crypto.createHash('sha256');
        const data = await fs.readFile(filePath);
        hash.update(data);
        return hash.digest('hex');
    }

    async executeCommand(buildId, command, cwd, options = {}) {
        return new Promise((resolve, reject) => {
            const process = spawn(command[0], command.slice(1), {
                cwd,
                stdio: ['pipe', 'pipe', 'pipe'],
                ...options
            });

            this.activeBuildProcesses.set(buildId, process);

            let stdout = '';
            let stderr = '';

            process.stdout.on('data', (data) => {
                const output = data.toString();
                stdout += output;
                this.addBuildLog(buildId, output.trim(), 'info');
            });

            process.stderr.on('data', (data) => {
                const output = data.toString();
                stderr += output;
                this.addBuildLog(buildId, output.trim(), 'error');
            });

            process.on('close', (code) => {
                this.activeBuildProcesses.delete(buildId);
                if (code === 0) {
                    resolve({ stdout, stderr, code });
                } else {
                    reject(new Error(`Command failed with code ${code}: ${stderr}`));
                }
            });

            process.on('error', (error) => {
                this.activeBuildProcesses.delete(buildId);
                reject(error);
            });
        });
    }

    async updateBuildStatus(buildId, status, updates = {}) {
        const build = await Build.findByIdAndUpdate(
            buildId,
            { status, ...updates },
            { new: true }
        );

        await this.addBuildLog(buildId, `Build status changed to: ${status}`);
        return build;
    }

    async addBuildLog(buildId, message, level = 'info') {
        await Build.findByIdAndUpdate(buildId, {
            $push: {
                logs: {
                    timestamp: new Date(),
                    level,
                    message
                }
            }
        });
    }

    async cancelBuild(buildId) {
        const build = await Build.findById(buildId);
        if (!build) throw new Error('Build not found');

        if (!['pending', 'cloning', 'installing', 'building', 'packaging'].includes(build.status)) {
            throw new Error('Cannot cancel build in current status');
        }

        // Kill active process
        const process = this.activeBuildProcesses.get(buildId);
        if (process) {
            process.kill('SIGTERM');
            this.activeBuildProcesses.delete(buildId);
        }

        await this.updateBuildStatus(buildId, 'cancelled', {
            endTime: new Date(),
            duration: Date.now() - build.startTime.getTime()
        });

        return build;
    }

    async getBuild(buildId) {
        const build = await Build.findById(buildId)
            .populate('projectId', 'name')
            .populate('deploymentId', 'status');
        
        if (!build) throw new Error('Build not found');
        return build;
    }

    async getBuilds(projectId, options = {}) {
        const {
            page = 1,
            limit = 20,
            status = null,
            branch = null
        } = options;

        const query = { projectId };
        if (status) query.status = status;
        if (branch) query.branch = branch;

        const builds = await Build.find(query)
            .populate('deploymentId', 'status')
            .sort({ createdAt: -1 })
            .limit(limit)
            .skip((page - 1) * limit)
            .select('-logs')
            .lean();

        const total = await Build.countDocuments(query);

        return {
            builds,
            pagination: {
                page,
                limit,
                total,
                pages: Math.ceil(total / limit)
            }
        };
    }

    async getBuildLogs(buildId) {
        const build = await Build.findById(buildId).select('logs');
        if (!build) throw new Error('Build not found');
        return build.logs;
    }

    async getBuildStats(projectId, timeRange = 30) {
        const since = new Date(Date.now() - timeRange * 24 * 60 * 60 * 1000);

        const stats = await Build.aggregate([
            {
                $match: {
                    projectId: mongoose.Types.ObjectId(projectId),
                    createdAt: { $gte: since }
                }
            },
            {
                $group: {
                    _id: null,
                    total: { $sum: 1 },
                    successful: { $sum: { $cond: [{ $eq: ['$status', 'success'] }, 1, 0] } },
                    failed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
                    avgDuration: { $avg: '$duration' },
                    totalBuildTime: { $sum: '$duration' }
                }
            }
        ]);

        const result = stats[0] || { total: 0, successful: 0, failed: 0, avgDuration: 0, totalBuildTime: 0 };
        result.successRate = result.total > 0 ? (result.successful / result.total) * 100 : 0;
        result.avgDuration = Math.round(result.avgDuration / 1000); // Convert to seconds
        result.totalBuildTime = Math.round(result.totalBuildTime / 1000);

        return result;
    }

    async cleanupWorkspace(workspaceDir) {
        try {
            await fs.rm(workspaceDir, { recursive: true, force: true });
        } catch (error) {
            console.error(`Failed to cleanup workspace ${workspaceDir}:`, error);
        }
    }

    async cleanupOldBuilds(projectId, daysOld = 30) {
        const cutoff = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);
        
        const oldBuilds = await Build.find({
            projectId,
            createdAt: { $lt: cutoff }
        }).select('_id artifacts');

        // Cleanup artifacts
        for (const build of oldBuilds) {
            for (const artifact of build.artifacts) {
                try {
                    await fs.unlink(artifact.path);
                } catch (error) {
                    console.error(`Failed to delete artifact ${artifact.path}:`, error);
                }
            }
        }

        // Delete build records
        const result = await Build.deleteMany({
            projectId,
            createdAt: { $lt: cutoff }
        });

        return result;
    }

    async retryBuild(buildId) {
        const originalBuild = await this.getBuild(buildId);
        
        const newBuild = await this.createBuild(originalBuild.projectId._id, {
            branch: originalBuild.branch,
            commitSha: originalBuild.commitSha,
            deploymentId: originalBuild.deploymentId,
            buildConfig: originalBuild.buildConfig,
            triggeredBy: 'retry'
        });

        return newBuild;
    }
}

module.exports = new BuildService();
