const { spawn } = require('child_process');

class DockerManager {
    constructor() {
        this.containers = new Map();
    }

    /**
     * Check if Docker is available
     */
    async isDockerAvailable() {
        return new Promise((resolve) => {
            const process = spawn('docker', ['--version']);
            
            process.on('close', (code) => {
                resolve(code === 0);
            });

            process.on('error', () => {
                resolve(false);
            });
        });
    }

    /**
     * Build Docker image
     */
    async buildImage(imageName, workspaceDir, options = {}) {
        return new Promise((resolve, reject) => {
            const args = [
                'build',
                '-t', imageName,
            ];

            if (options.memory) args.push('--memory=' + options.memory);
            if (options.cpus) args.push('--cpus=' + options.cpus);

            args.push('.');

            const process = spawn('docker', args, { cwd: workspaceDir });

            let output = '';
            let error = '';

            process.stdout.on('data', (data) => {
                output += data.toString();
            });

            process.stderr.on('data', (data) => {
                error += data.toString();
            });

            process.on('close', (code) => {
                if (code === 0) {
                    resolve({ imageName, output });
                } else {
                    reject(new Error(`Docker build failed: ${error}`));
                }
            });

            process.on('error', reject);
        });
    }

    /**
     * Run Docker container
     */
    async runContainer(imageName, options = {}) {
        return new Promise((resolve, reject) => {
            const args = [
                'run',
                '--rm',
                '--detach'
            ];

            if (options.name) args.push('--name', options.name);
            if (options.memory) args.push('--memory=' + options.memory);
            if (options.cpus) args.push('--cpus=' + options.cpus);
            if (options.port) args.push('-p', options.port);
            if (options.env) {
                for (const [key, value] of Object.entries(options.env)) {
                    args.push('-e', `${key}=${value}`);
                }
            }

            args.push(imageName);

            const process = spawn('docker', args);

            let containerId = '';
            let error = '';

            process.stdout.on('data', (data) => {
                containerId += data.toString();
            });

            process.stderr.on('data', (data) => {
                error += data.toString();
            });

            process.on('close', (code) => {
                if (code === 0) {
                    const id = containerId.trim();
                    this.containers.set(id, { imageName, options });
                    resolve(id);
                } else {
                    reject(new Error(`Docker run failed: ${error}`));
                }
            });

            process.on('error', reject);
        });
    }

    /**
     * Stop and remove container
     */
    async stopContainer(containerId, timeout = 10) {
        return new Promise((resolve, reject) => {
            const process = spawn('docker', ['stop', '-t', timeout.toString(), containerId]);

            process.on('close', (code) => {
                if (code === 0) {
                    this.containers.delete(containerId);
                    resolve();
                } else {
                    reject(new Error(`Failed to stop container: ${containerId}`));
                }
            });

            process.on('error', reject);
        });
    }

    /**
     * Remove image
     */
    async removeImage(imageName) {
        return new Promise((resolve, reject) => {
            const process = spawn('docker', ['rmi', imageName]);

            process.on('close', (code) => {
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`Failed to remove image: ${imageName}`));
                }
            });

            process.on('error', reject);
        });
    }

    /**
     * Get container logs
     */
    async getContainerLogs(containerId, options = {}) {
        return new Promise((resolve, reject) => {
            const args = ['logs'];
            if (options.tail) args.push('--tail', options.tail.toString());
            if (options.timestamps) args.push('-t');
            args.push(containerId);

            const process = spawn('docker', args);

            let logs = '';

            process.stdout.on('data', (data) => {
                logs += data.toString();
            });

            process.on('close', (code) => {
                if (code === 0) {
                    resolve(logs);
                } else {
                    reject(new Error(`Failed to get logs for container: ${containerId}`));
                }
            });

            process.on('error', reject);
        });
    }

    /**
     * Cleanup all containers
     */
    async cleanup() {
        const promises = [];
        
        for (const [containerId] of this.containers) {
            promises.push(
                this.stopContainer(containerId).catch(error => {
                    console.warn(`[v0] Failed to stop container ${containerId}:`, error.message);
                })
            );
        }

        await Promise.all(promises);
        this.containers.clear();
    }
}

module.exports = DockerManager;
