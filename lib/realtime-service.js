/**
 * Real-time WebSocket Service
 * Live metrics, logs, and notifications using Socket.io
 */

import io from 'socket.io-client';

class RealtimeService {
  constructor() {
    this.socket = null;
    this.listeners = new Map();
    this.connected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
  }

  connect() {
    if (this.socket?.connected) return;

    this.socket = io(process.env.NEXT_PUBLIC_SOCKET_SERVER_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000', {
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: this.maxReconnectAttempts,
      transports: ['websocket', 'polling']
    });

    this.socket.on('connect', () => {
      console.log('WebSocket connected');
      this.connected = true;
      this.reconnectAttempts = 0;
      this.emit('connected', { timestamp: new Date() });
    });

    this.socket.on('disconnect', () => {
      console.log('WebSocket disconnected');
      this.connected = false;
      this.emit('disconnected', { timestamp: new Date() });
    });

    this.socket.on('error', (error) => {
      console.error('WebSocket error:', error);
      this.emit('error', error);
    });

    // Real-time event listeners
    this.socket.on('deployment:started', (data) => this.emit('deployment:started', data));
    this.socket.on('deployment:completed', (data) => this.emit('deployment:completed', data));
    this.socket.on('deployment:failed', (data) => this.emit('deployment:failed', data));
    this.socket.on('log:new', (data) => this.emit('log:new', data));
    this.socket.on('metric:update', (data) => this.emit('metric:update', data));
    this.socket.on('alert:triggered', (data) => this.emit('alert:triggered', data));
    this.socket.on('compliance:update', (data) => this.emit('compliance:update', data));
    this.socket.on('notification:new', (data) => this.emit('notification:new', data));
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.connected = false;
    }
  }

  // Event management
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(callback);
  }

  off(event, callback) {
    if (this.listeners.has(event)) {
      const callbacks = this.listeners.get(event);
      const index = callbacks.indexOf(callback);
      if (index > -1) {
        callbacks.splice(index, 1);
      }
    }
  }

  emit(event, data) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          console.error(`Error in listener for ${event}:`, error);
        }
      });
    }
  }

  // Subscribe to live metrics
  subscribeToMetrics(projectId, callback) {
    this.socket.emit('metrics:subscribe', { projectId });
    this.on('metric:update', (data) => {
      if (data.projectId === projectId) {
        callback(data);
      }
    });
  }

  unsubscribeFromMetrics(projectId) {
    this.socket.emit('metrics:unsubscribe', { projectId });
  }

  // Subscribe to live logs
  subscribeToLogs(deploymentId, callback) {
    this.socket.emit('logs:subscribe', { deploymentId });
    this.on('log:new', (data) => {
      if (data.deploymentId === deploymentId) {
        callback(data);
      }
    });
  }

  unsubscribeFromLogs(deploymentId) {
    this.socket.emit('logs:unsubscribe', { deploymentId });
  }

  // Subscribe to team notifications
  subscribeToNotifications(teamId, callback) {
    this.socket.emit('notifications:subscribe', { teamId });
    this.on('notification:new', (data) => {
      if (data.teamId === teamId) {
        callback(data);
      }
    });
  }

  // Subscribe to compliance updates
  subscribeToCompliance(teamId, callback) {
    this.socket.emit('compliance:subscribe', { teamId });
    this.on('compliance:update', (data) => {
      if (data.teamId === teamId) {
        callback(data);
      }
    });
  }

  // Subscribe to alerts
  subscribeToAlerts(teamId, callback) {
    this.socket.emit('alerts:subscribe', { teamId });
    this.on('alert:triggered', (data) => {
      if (data.teamId === teamId) {
        callback(data);
      }
    });
  }

  isConnected() {
    return this.connected;
  }
}

export default new RealtimeService();
