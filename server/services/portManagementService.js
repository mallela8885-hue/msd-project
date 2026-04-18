const PortMapping = require('../models/PortMapping');

class PortManagementService {
    constructor() {
        this.portRangeStart = 3001;
        this.portRangeEnd = 4000;
        this.usedPorts = new Set();
    }

    /**
     * Initialize port management - load existing mappings
     */
    async initialize() {
        try {
            const mappings = await PortMapping.find({ status: 'active' });
            mappings.forEach(mapping => {
                this.usedPorts.add(mapping.containerPort);
            });
            console.log(`[v0] Port management initialized with ${this.usedPorts.size} active mappings`);
        } catch (error) {
            console.error('[v0] Error initializing port management:', error);
        }
    }

    /**
     * Allocate a port for a new deployment
     */
    async allocatePort(deploymentId, options = {}) {
        try {
            const preferredPort = options.preferredPort;
            
            // Find an available port
            let port = null;

            if (preferredPort && !this.usedPorts.has(preferredPort) && 
                preferredPort >= this.portRangeStart && preferredPort <= this.portRangeEnd) {
                port = preferredPort;
            } else {
                // Find next available port
                for (let p = this.portRangeStart; p <= this.portRangeEnd; p++) {
                    if (!this.usedPorts.has(p)) {
                        port = p;
                        break;
                    }
                }
            }

            if (!port) {
                throw new Error('No available ports in range');
            }

            // Create mapping in database
            const mapping = await PortMapping.create({
                deploymentId,
                containerPort: port,
                status: 'active',
                allocatedAt: new Date()
            });

            this.usedPorts.add(port);

            console.log(`[v0] Allocated port ${port} for deployment ${deploymentId}`);
            return mapping;
        } catch (error) {
            console.error('[v0] Error allocating port:', error);
            throw error;
        }
    }

    /**
     * Get mapping for a deployment
     */
    async getPortMapping(deploymentId) {
        try {
            return await PortMapping.findOne({ deploymentId, status: 'active' });
        } catch (error) {
            console.error('[v0] Error getting port mapping:', error);
            return null;
        }
    }

    /**
     * Release a port from a deployment
     */
    async releasePort(deploymentId) {
        try {
            const mapping = await PortMapping.findOne({ deploymentId, status: 'active' });
            
            if (mapping) {
                this.usedPorts.delete(mapping.containerPort);
                mapping.status = 'released';
                mapping.releasedAt = new Date();
                await mapping.save();

                console.log(`[v0] Released port ${mapping.containerPort} from deployment ${deploymentId}`);
                return mapping;
            }

            return null;
        } catch (error) {
            console.error('[v0] Error releasing port:', error);
            throw error;
        }
    }

    /**
     * Get all active port mappings
     */
    async getAllActiveMappings() {
        try {
            return await PortMapping.find({ status: 'active' }).sort({ allocatedAt: -1 });
        } catch (error) {
            console.error('[v0] Error getting active mappings:', error);
            return [];
        }
    }

    /**
     * Get port utilization statistics
     */
    async getPortStats() {
        try {
            const totalPorts = this.portRangeEnd - this.portRangeStart + 1;
            const activeMappings = await PortMapping.countDocuments({ status: 'active' });

            return {
                portRangeStart: this.portRangeStart,
                portRangeEnd: this.portRangeEnd,
                totalAvailable: totalPorts,
                activeAllocations: activeMappings,
                availablePorts: totalPorts - activeMappings,
                utilizationPercent: (activeMappings / totalPorts) * 100
            };
        } catch (error) {
            console.error('[v0] Error getting port stats:', error);
            return null;
        }
    }

    /**
     * Build nginx routing configuration
     */
    async generateNginxConfig(nodeIp, mappings) {
        try {
            let config = `# Auto-generated Nginx configuration for port routing
# Generated: ${new Date().toISOString()}

`;

            for (const mapping of mappings) {
                const backendName = `backend_${mapping.deploymentId.toString().slice(-8)}`;
                
                config += `upstream ${backendName} {
    server localhost:${mapping.containerPort} max_fails=3 fail_timeout=30s;
}

server {
    listen 80;
    server_name ${mapping.subdomain || `app-${mapping.deploymentId.toString().slice(-8)}.yourdomain.com`};

    client_max_body_size 100m;

    location / {
        proxy_pass http://${backendName};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # Health check endpoint
    location /health {
        access_log off;
        try_files $uri =204;
    }
}

`;
            }

            return config;
        } catch (error) {
            console.error('[v0] Error generating nginx config:', error);
            return null;
        }
    }

    /**
     * Cleanup old port mappings
     */
    async cleanupOldMappings(daysOld = 7) {
        try {
            const cutoff = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);
            
            const result = await PortMapping.deleteMany({
                status: 'released',
                releasedAt: { $lt: cutoff }
            });

            console.log(`[v0] Cleaned up ${result.deletedCount} old port mappings`);
            return result;
        } catch (error) {
            console.error('[v0] Error cleaning up port mappings:', error);
            throw error;
        }
    }

    /**
     * Check if a specific port is available
     */
    isPortAvailable(port) {
        return !this.usedPorts.has(port) && 
               port >= this.portRangeStart && 
               port <= this.portRangeEnd;
    }

    /**
     * Get next available port
     */
    getNextAvailablePort() {
        for (let port = this.portRangeStart; port <= this.portRangeEnd; port++) {
            if (this.isPortAvailable(port)) {
                return port;
            }
        }
        return null;
    }
}

module.exports = new PortManagementService();
