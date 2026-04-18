const axios = require('axios');

class NodeRegistry {
    constructor(nodeId, backendUrl) {
        this.nodeId = nodeId;
        this.backendUrl = backendUrl;
        this.client = axios.create({
            baseURL: backendUrl,
            timeout: 10000
        });
    }

    /**
     * Register node with backend
     */
    async register(nodeData) {
        try {
            const response = await this.client.post('/api/nodes/register', {
                nodeId: this.nodeId,
                ...nodeData
            });

            console.log(`[v0] Node registered successfully: ${this.nodeId}`);
            return response.data;
        } catch (error) {
            console.error('[v0] Failed to register node:', error.message);
            throw error;
        }
    }

    /**
     * Send heartbeat to backend
     */
    async sendHeartbeat(metrics) {
        try {
            const response = await this.client.post('/api/nodes/heartbeat', {
                nodeId: this.nodeId,
                metrics
            });

            return response.data;
        } catch (error) {
            console.error('[v0] Failed to send heartbeat:', error.message);
            // Don't throw - heartbeat failures shouldn't crash the agent
        }
    }

    /**
     * Get node status
     */
    async getNodeStatus() {
        try {
            const response = await this.client.get(`/api/nodes/${this.nodeId}`);
            return response.data;
        } catch (error) {
            console.error('[v0] Failed to get node status:', error.message);
            return null;
        }
    }

    /**
     * Report error to backend
     */
    async reportError(errorMessage, context = {}) {
        try {
            await this.client.post(`/api/nodes/${this.nodeId}/error`, {
                error: errorMessage,
                context,
                timestamp: new Date()
            });
        } catch (error) {
            console.error('[v0] Failed to report error:', error.message);
        }
    }
}

module.exports = NodeRegistry;
