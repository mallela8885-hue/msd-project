const WorkerNode = require('../models/WorkerNode');

class NodeManagementService {
    constructor() {
        this.heartbeatTimeout = 30000; // 30 seconds
        this.healthCheckInterval = null;
    }

    /**
     * Register a new worker node
     */
    async registerNode(nodeData) {
        try {
            const {
                nodeId,
                hostname,
                region = 'us-east-1',
                totalCapacity = {
                    cpu: 2,
                    memory: 2048, // MB
                    storage: 10240 // MB
                }
            } = nodeData;

            // Check if node already exists
            let node = await WorkerNode.findOne({ nodeId });
            
            if (node) {
                // Update existing node
                node.status = 'active';
                node.lastHeartbeat = new Date();
                node.hostname = hostname;
                node.region = region;
                node.totalCapacity = totalCapacity;
            } else {
                // Create new node
                node = await WorkerNode.create({
                    nodeId,
                    hostname,
                    region,
                    status: 'active',
                    lastHeartbeat: new Date(),
                    cpuUsage: 0,
                    memoryUsage: 0,
                    diskUsage: 0,
                    activeContainers: 0,
                    totalCapacity,
                    registeredAt: new Date()
                });
            }

            console.log(`[v0] Node registered: ${nodeId} (${region})`);
            return node;
        } catch (error) {
            console.error('[v0] Error registering node:', error);
            throw error;
        }
    }

    /**
     * Update node heartbeat and metrics
     */
    async updateNodeHeartbeat(nodeId, metrics = {}) {
        try {
            const node = await WorkerNode.findOne({ nodeId });
            if (!node) {
                throw new Error(`Node ${nodeId} not found`);
            }

            // Update metrics
            node.lastHeartbeat = new Date();
            node.cpuUsage = metrics.cpuUsage || 0;
            node.memoryUsage = metrics.memoryUsage || 0;
            node.diskUsage = metrics.diskUsage || 0;
            node.activeContainers = metrics.activeContainers || 0;
            
            // Node is healthy if recent heartbeat
            if (node.status === 'inactive' || node.status === 'failed') {
                node.status = 'active';
            }

            await node.save();

            console.log(`[v0] Heartbeat received from ${nodeId}: CPU=${node.cpuUsage}%, Memory=${node.memoryUsage}%`);
            return node;
        } catch (error) {
            console.error('[v0] Error updating node heartbeat:', error);
            throw error;
        }
    }

    /**
     * Get a specific node
     */
    async getNode(nodeId) {
        try {
            const node = await WorkerNode.findOne({ nodeId });
            if (!node) return null;

            // Check if node is still active based on heartbeat
            const timeSinceHeartbeat = Date.now() - node.lastHeartbeat.getTime();
            if (timeSinceHeartbeat > this.heartbeatTimeout && node.status === 'active') {
                node.status = 'inactive';
                await node.save();
                console.log(`[v0] Node marked inactive: ${nodeId} (no heartbeat for ${timeSinceHeartbeat}ms)`);
            }

            return node;
        } catch (error) {
            console.error('[v0] Error getting node:', error);
            return null;
        }
    }

    /**
     * Get all nodes with optional status filter
     */
    async getAllNodes(status = null) {
        try {
            const query = status ? { status } : {};
            const nodes = await WorkerNode.find(query).sort({ createdAt: -1 });

            // Check heartbeats for all nodes
            const updatedNodes = await Promise.all(
                nodes.map(async (node) => {
                    const timeSinceHeartbeat = Date.now() - node.lastHeartbeat.getTime();
                    if (timeSinceHeartbeat > this.heartbeatTimeout && node.status === 'active') {
                        node.status = 'inactive';
                        await node.save();
                    }
                    return node;
                })
            );

            return updatedNodes;
        } catch (error) {
            console.error('[v0] Error getting all nodes:', error);
            return [];
        }
    }

    /**
     * Get available (active) nodes
     */
    async getAvailableNodes() {
        try {
            const nodes = await this.getAllNodes('active');
            return nodes.filter(node => {
                // Node is available if not at capacity
                return node.activeContainers < 10; // Max 10 containers per node
            });
        } catch (error) {
            console.error('[v0] Error getting available nodes:', error);
            return [];
        }
    }

    /**
     * Increment active container count
     */
    async incrementActiveContainers(nodeId) {
        try {
            const node = await WorkerNode.findOne({ nodeId });
            if (!node) throw new Error(`Node ${nodeId} not found`);

            node.activeContainers += 1;
            await node.save();

            console.log(`[v0] Node ${nodeId} active containers: ${node.activeContainers}`);
            return node;
        } catch (error) {
            console.error('[v0] Error incrementing active containers:', error);
            throw error;
        }
    }

    /**
     * Decrement active container count
     */
    async decrementActiveContainers(nodeId) {
        try {
            const node = await WorkerNode.findOne({ nodeId });
            if (!node) throw new Error(`Node ${nodeId} not found`);

            if (node.activeContainers > 0) {
                node.activeContainers -= 1;
            }
            await node.save();

            console.log(`[v0] Node ${nodeId} active containers: ${node.activeContainers}`);
            return node;
        } catch (error) {
            console.error('[v0] Error decrementing active containers:', error);
            throw error;
        }
    }

    /**
     * Record an error on a node
     */
    async recordNodeError(nodeId, errorMessage) {
        try {
            const node = await WorkerNode.findOne({ nodeId });
            if (!node) return;

            // Store error in database or log
            console.warn(`[v0] Node ${nodeId} error: ${errorMessage}`);
            
            // If too many consecutive errors, mark as failed
            // This is simplified - in production, implement proper error tracking
            if (!node.errors) {
                node.errors = [];
            }
            node.errors.push({
                timestamp: new Date(),
                message: errorMessage
            });

            // Keep only recent errors
            if (node.errors.length > 10) {
                node.errors = node.errors.slice(-10);
            }

            // If 5+ errors in last 5 minutes, mark as failed
            const recentErrors = node.errors.filter(e => {
                const age = Date.now() - e.timestamp.getTime();
                return age < 300000; // 5 minutes
            });

            if (recentErrors.length >= 5) {
                node.status = 'failed';
                console.error(`[v0] Node ${nodeId} marked as failed due to repeated errors`);
            }

            await node.save();
        } catch (error) {
            console.error('[v0] Error recording node error:', error);
        }
    }

    /**
     * Get node capacity information
     */
    async getNodeCapacity(nodeId) {
        try {
            const node = await this.getNode(nodeId);
            if (!node) return null;

            const cpuCapacity = node.totalCapacity?.cpu || 2;
            const memoryCapacity = node.totalCapacity?.memory || 2048;
            const storageCapacity = node.totalCapacity?.storage || 10240;

            return {
                nodeId,
                status: node.status,
                cpu: {
                    total: cpuCapacity,
                    used: (node.cpuUsage / 100) * cpuCapacity,
                    available: ((100 - node.cpuUsage) / 100) * cpuCapacity,
                    percentUsed: node.cpuUsage
                },
                memory: {
                    total: memoryCapacity,
                    used: (node.memoryUsage / 100) * memoryCapacity,
                    available: ((100 - node.memoryUsage) / 100) * memoryCapacity,
                    percentUsed: node.memoryUsage
                },
                storage: {
                    total: storageCapacity,
                    used: (node.diskUsage / 100) * storageCapacity,
                    available: ((100 - node.diskUsage) / 100) * storageCapacity,
                    percentUsed: node.diskUsage
                },
                activeContainers: node.activeContainers,
                containerCapacity: 10
            };
        } catch (error) {
            console.error('[v0] Error getting node capacity:', error);
            return null;
        }
    }

    /**
     * Get statistics for all nodes
     */
    async getNodeStats() {
        try {
            const nodes = await this.getAllNodes();
            
            const stats = {
                totalNodes: nodes.length,
                activeNodes: nodes.filter(n => n.status === 'active').length,
                inactiveNodes: nodes.filter(n => n.status === 'inactive').length,
                failedNodes: nodes.filter(n => n.status === 'failed').length,
                totalCapacity: {
                    cpu: 0,
                    memory: 0,
                    storage: 0
                },
                avgCpuUsage: 0,
                avgMemoryUsage: 0,
                totalActiveContainers: 0
            };

            let totalCpuUsage = 0;
            let totalMemoryUsage = 0;

            for (const node of nodes) {
                stats.totalCapacity.cpu += node.totalCapacity?.cpu || 0;
                stats.totalCapacity.memory += node.totalCapacity?.memory || 0;
                stats.totalCapacity.storage += node.totalCapacity?.storage || 0;
                totalCpuUsage += node.cpuUsage || 0;
                totalMemoryUsage += node.memoryUsage || 0;
                stats.totalActiveContainers += node.activeContainers || 0;
            }

            if (nodes.length > 0) {
                stats.avgCpuUsage = totalCpuUsage / nodes.length;
                stats.avgMemoryUsage = totalMemoryUsage / nodes.length;
            }

            return stats;
        } catch (error) {
            console.error('[v0] Error getting node stats:', error);
            return null;
        }
    }

    /**
     * Start health check monitoring
     */
    startHealthCheck(interval = 30000) {
        if (this.healthCheckInterval) return;

        console.log('[v0] Starting node health check monitoring...');
        
        this.healthCheckInterval = setInterval(async () => {
            try {
                const nodes = await this.getAllNodes();
                const now = Date.now();

                for (const node of nodes) {
                    const timeSinceHeartbeat = now - node.lastHeartbeat.getTime();
                    
                    if (timeSinceHeartbeat > this.heartbeatTimeout && node.status === 'active') {
                        node.status = 'inactive';
                        await node.save();
                        console.warn(`[v0] Node ${node.nodeId} marked inactive (no heartbeat)`);
                    }
                }
            } catch (error) {
                console.error('[v0] Error in health check:', error);
            }
        }, interval);
    }

    /**
     * Stop health check monitoring
     */
    stopHealthCheck() {
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
            this.healthCheckInterval = null;
        }
        console.log('[v0] Node health check monitoring stopped');
    }

    /**
     * Delete a node
     */
    async deleteNode(nodeId) {
        try {
            const result = await WorkerNode.deleteOne({ nodeId });
            if (result.deletedCount > 0) {
                console.log(`[v0] Node ${nodeId} deleted`);
            }
            return result;
        } catch (error) {
            console.error('[v0] Error deleting node:', error);
            throw error;
        }
    }
}

module.exports = new NodeManagementService();
