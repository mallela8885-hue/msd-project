const fs = require('fs').promises;
const path = require('path');

class DockerfileGenerator {
    /**
     * Detect the project type and generate an appropriate Dockerfile
     * @param {string} workspaceDir - The project directory path
     * @param {object} buildConfig - Build configuration
     * @returns {Promise<string>} - The generated Dockerfile content
     */
    async generateDockerfile(workspaceDir, buildConfig = {}) {
        const projectType = await this.detectProjectType(workspaceDir);
        const packageJson = await this.readPackageJson(workspaceDir);
        const buildCommand = buildConfig.buildCommand || this.detectBuildCommand(packageJson, projectType);
        const outputDir = buildConfig.outputDirectory || this.detectOutputDir(projectType);

        console.log(`[v0] Detected project type: ${projectType}`);
        console.log(`[v0] Build command: ${buildCommand}`);
        console.log(`[v0] Output directory: ${outputDir}`);

        switch (projectType) {
            case 'nextjs':
                return this.generateNextJSDockerfile(packageJson, buildCommand, outputDir, buildConfig);
            case 'react':
                return this.generateReactDockerfile(packageJson, buildCommand, outputDir, buildConfig);
            case 'vue':
                return this.generateVueDockerfile(packageJson, buildCommand, outputDir, buildConfig);
            case 'static':
                return this.generateStaticDockerfile(workspaceDir, buildCommand, outputDir, buildConfig);
            case 'python':
                return this.generatePythonDockerfile(workspaceDir, buildCommand, buildConfig);
            case 'node':
                return this.generateNodeDockerfile(packageJson, buildCommand, buildConfig);
            default:
                return this.generateDefaultDockerfile(buildCommand, buildConfig);
        }
    }

    /**
     * Detect the type of project by examining its dependencies and files
     */
    async detectProjectType(workspaceDir) {
        try {
            const packageJsonPath = path.join(workspaceDir, 'package.json');
            const content = await fs.readFile(packageJsonPath, 'utf-8');
            const packageJson = JSON.parse(content);
            const dependencies = {
                ...packageJson.dependencies,
                ...packageJson.devDependencies
            };

            // Check for specific frameworks in order of specificity
            if (dependencies.next) return 'nextjs';
            if (dependencies.react) return 'react';
            if (dependencies.vue) return 'vue';
            if (packageJson.main || dependencies.express) return 'node';
        } catch (error) {
            // Continue to check for other project types
        }

        // Check for Python project
        try {
            await fs.access(path.join(workspaceDir, 'requirements.txt'));
            return 'python';
        } catch {}

        try {
            await fs.access(path.join(workspaceDir, 'setup.py'));
            return 'python';
        } catch {}

        // Check for static HTML
        try {
            await fs.access(path.join(workspaceDir, 'index.html'));
            return 'static';
        } catch {}

        return 'static';
    }

    /**
     * Read and parse package.json
     */
    async readPackageJson(workspaceDir) {
        try {
            const packageJsonPath = path.join(workspaceDir, 'package.json');
            const content = await fs.readFile(packageJsonPath, 'utf-8');
            return JSON.parse(content);
        } catch (error) {
            console.warn('[v0] Could not read package.json');
            return {};
        }
    }

    /**
     * Detect the build command from package.json or use defaults
     */
    detectBuildCommand(packageJson, projectType) {
        if (packageJson.scripts && packageJson.scripts.build) {
            return packageJson.scripts.build;
        }

        const defaults = {
            nextjs: 'npm run build',
            react: 'npm run build',
            vue: 'npm run build',
            node: 'npm run build',
            python: 'python -m pip install -r requirements.txt && python app.py',
            static: 'true'
        };

        return defaults[projectType] || 'npm run build';
    }

    /**
     * Detect the output directory based on project type
     */
    detectOutputDir(projectType) {
        const defaults = {
            nextjs: '.next',
            react: 'build',
            vue: 'dist',
            node: 'dist',
            python: '.',
            static: '.'
        };

        return defaults[projectType] || 'dist';
    }

    /**
     * Generate Dockerfile for Next.js projects
     */
    generateNextJSDockerfile(packageJson, buildCommand, outputDir, buildConfig) {
        const nodeVersion = buildConfig.nodeVersion || '18-alpine';
        const registry = buildConfig.npmRegistry || 'https://registry.npmjs.org';
        const packageManager = this.detectPackageManager(packageJson);

        return `FROM node:${nodeVersion} AS builder

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache git

# Set NPM registry if custom one is specified
${registry !== 'https://registry.npmjs.org' ? `RUN npm config set registry ${registry}` : ''}

# Copy package files
COPY package*.json ./
${packageManager === 'yarn' ? 'COPY yarn.lock* ./' : ''}
${packageManager === 'pnpm' ? 'COPY pnpm-lock.yaml* ./' : ''}

# Install dependencies
RUN ${this.getInstallCommand(packageManager)}

# Copy application code
COPY . .

# Build application
RUN ${buildCommand}

# Production stage
FROM node:${nodeVersion}

WORKDIR /app

# Install production dependencies only
COPY package*.json ./
${packageManager === 'yarn' ? 'COPY yarn.lock* ./' : ''}
${packageManager === 'pnpm' ? 'COPY pnpm-lock.yaml* ./' : ''}

RUN ${this.getProdInstallCommand(packageManager)}

# Copy built application from builder
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \\
  CMD node -e "require('http').get('http://localhost:3000', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

# Start application
CMD ["npm", "start"]
`;
    }

    /**
     * Generate Dockerfile for React projects (Vite or Create React App)
     */
    generateReactDockerfile(packageJson, buildCommand, outputDir, buildConfig) {
        const nodeVersion = buildConfig.nodeVersion || '18-alpine';
        const packageManager = this.detectPackageManager(packageJson);

        return `FROM node:${nodeVersion} AS builder

WORKDIR /app

COPY package*.json ./
${packageManager === 'yarn' ? 'COPY yarn.lock* ./' : ''}
${packageManager === 'pnpm' ? 'COPY pnpm-lock.yaml* ./' : ''}

RUN ${this.getInstallCommand(packageManager)}

COPY . .

RUN ${buildCommand}

# Production stage with nginx
FROM nginx:alpine

COPY --from=builder /app/${outputDir} /usr/share/nginx/html

# Copy nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \\
  CMD wget --quiet --tries=1 --spider http://localhost/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
`;
    }

    /**
     * Generate Dockerfile for Vue projects
     */
    generateVueDockerfile(packageJson, buildCommand, outputDir, buildConfig) {
        const nodeVersion = buildConfig.nodeVersion || '18-alpine';
        const packageManager = this.detectPackageManager(packageJson);

        return `FROM node:${nodeVersion} AS builder

WORKDIR /app

COPY package*.json ./
${packageManager === 'yarn' ? 'COPY yarn.lock* ./' : ''}
${packageManager === 'pnpm' ? 'COPY pnpm-lock.yaml* ./' : ''}

RUN ${this.getInstallCommand(packageManager)}

COPY . .

RUN ${buildCommand}

# Production stage with nginx
FROM nginx:alpine

COPY --from=builder /app/${outputDir} /usr/share/nginx/html

COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \\
  CMD wget --quiet --tries=1 --spider http://localhost/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
`;
    }

    /**
     * Generate Dockerfile for static HTML projects
     */
    generateStaticDockerfile(workspaceDir, buildCommand, outputDir, buildConfig) {
        return `FROM nginx:alpine

WORKDIR /app

COPY . /usr/share/nginx/html/

COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \\
  CMD wget --quiet --tries=1 --spider http://localhost/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
`;
    }

    /**
     * Generate Dockerfile for Python projects
     */
    generatePythonDockerfile(workspaceDir, buildCommand, buildConfig) {
        const pythonVersion = buildConfig.pythonVersion || '3.11-slim';

        return `FROM python:${pythonVersion}

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*

# Copy requirements
COPY requirements*.txt ./

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Expose port
EXPOSE 5000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \\
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:5000')" || exit 1

# Run application
CMD ["python", "app.py"]
`;
    }

    /**
     * Generate Dockerfile for Node.js projects
     */
    generateNodeDockerfile(packageJson, buildCommand, buildConfig) {
        const nodeVersion = buildConfig.nodeVersion || '18-alpine';
        const packageManager = this.detectPackageManager(packageJson);
        const startCommand = packageJson.scripts?.start || 'node index.js';

        return `FROM node:${nodeVersion} AS builder

WORKDIR /app

COPY package*.json ./
${packageManager === 'yarn' ? 'COPY yarn.lock* ./' : ''}
${packageManager === 'pnpm' ? 'COPY pnpm-lock.yaml* ./' : ''}

RUN ${this.getInstallCommand(packageManager)}

COPY . .

${buildCommand !== 'true' ? `RUN ${buildCommand}` : ''}

# Production stage
FROM node:${nodeVersion}

WORKDIR /app

COPY package*.json ./
${packageManager === 'yarn' ? 'COPY yarn.lock* ./' : ''}
${packageManager === 'pnpm' ? 'COPY pnpm-lock.yaml* ./' : ''}

RUN ${this.getProdInstallCommand(packageManager)}

${buildCommand !== 'true' ? 'COPY --from=builder /app/dist ./dist' : 'COPY --from=builder /app . .'}

EXPOSE 3000

CMD ["${startCommand}"]
`;
    }

    /**
     * Generate default Dockerfile
     */
    generateDefaultDockerfile(buildCommand, buildConfig) {
        const nodeVersion = buildConfig.nodeVersion || '18-alpine';

        return `FROM node:${nodeVersion}

WORKDIR /app

COPY package*.json ./

RUN npm ci

COPY . .

RUN ${buildCommand || 'npm run build'}

EXPOSE 3000

CMD ["npm", "start"]
`;
    }

    /**
     * Detect package manager from lock files
     */
    detectPackageManager(packageJson) {
        if (packageJson.packageManager) {
            if (packageJson.packageManager.includes('yarn')) return 'yarn';
            if (packageJson.packageManager.includes('pnpm')) return 'pnpm';
        }
        return 'npm';
    }

    /**
     * Get install command for the package manager
     */
    getInstallCommand(packageManager) {
        const commands = {
            npm: 'npm ci',
            yarn: 'yarn install --frozen-lockfile',
            pnpm: 'pnpm install --frozen-lockfile'
        };
        return commands[packageManager] || 'npm ci';
    }

    /**
     * Get production install command for the package manager
     */
    getProdInstallCommand(packageManager) {
        const commands = {
            npm: 'npm ci --only=production',
            yarn: 'yarn install --frozen-lockfile --production',
            pnpm: 'pnpm install --frozen-lockfile --production'
        };
        return commands[packageManager] || 'npm ci --only=production';
    }

    /**
     * Generate nginx.conf for SPA projects
     */
    generateNginxConfig() {
        return `server {
    listen 80;
    server_name _;

    gzip on;
    gzip_types text/plain text/css text/xml text/javascript application/x-javascript application/xml+rss application/rss+xml font/truetype font/opentype application/vnd.ms-fontobject image/svg+xml;

    location / {
        root /usr/share/nginx/html;
        index index.html index.htm;
        try_files $uri $uri/ /index.html;
    }

    location ~* \\.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    location ~ /\\. {
        deny all;
    }
}
`;
    }
}

module.exports = new DockerfileGenerator();
