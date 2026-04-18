// Log Service
const Log = require("../models/Log")
const { spawn } = require('child_process');

class LogService {
  constructor() {
    this.activeStreams = new Map();
  }

  async getLogs(projectId, options = {}) {
    const { deploymentId, level, service, limit = 100, skip = 0 } = options

    const query = {}
    if (projectId) query.projectId = projectId
    if (deploymentId) query.deploymentId = deploymentId
    if (level) query.level = level
    if (service) query.service = service

    return await Log.find(query).sort({ createdAt: -1 }).limit(limit).skip(skip)
  }

  async getLogStats(projectId) {
    const logs = await Log.find({ projectId })
    const levelCounts = {}

    logs.forEach((log) => {
      levelCounts[log.level] = (levelCounts[log.level] || 0) + 1
    })

    return levelCounts
  }

  async clearLogs(projectId) {
    return await Log.deleteMany({ projectId })
  }

  async streamLogs(projectId, onLog) {
    const changeStream = Log.watch([{ $match: { "fullDocument.projectId": projectId } }])

    changeStream.on("change", (change) => {
      if (change.operationType === "insert") {
        onLog(change.fullDocument)
      }
    })

    return changeStream
  }

  /**
   * Stream Docker container logs
   */
  async streamDockerLogs(containerId, deploymentId, onLog) {
    try {
      const process = spawn('docker', ['logs', '-f', containerId]);

      const streamId = `${deploymentId}-${Date.now()}`;
      this.activeStreams.set(streamId, process);

      process.stdout.on('data', (data) => {
        const message = data.toString().trim();
        const logEntry = {
          projectId: deploymentId,
          deploymentId,
          message,
          level: 'info',
          service: 'docker',
          timestamp: new Date()
        };
        onLog(logEntry);
      });

      process.stderr.on('data', (data) => {
        const message = data.toString().trim();
        const logEntry = {
          projectId: deploymentId,
          deploymentId,
          message,
          level: 'error',
          service: 'docker',
          timestamp: new Date()
        };
        onLog(logEntry);
      });

      process.on('close', () => {
        this.activeStreams.delete(streamId);
      });

      return streamId;
    } catch (error) {
      console.error('[v0] Error streaming Docker logs:', error);
      throw error;
    }
  }

  /**
   * Stop streaming Docker logs
   */
  stopDockerStream(streamId) {
    const process = this.activeStreams.get(streamId);
    if (process) {
      process.kill('SIGTERM');
      this.activeStreams.delete(streamId);
    }
  }

  /**
   * Add deployment log entry
   */
  async addDeploymentLog(deploymentId, message, level = 'info') {
    try {
      await Log.create({
        deploymentId,
        message,
        level,
        service: 'deployment',
        timestamp: new Date()
      });
    } catch (error) {
      console.error('[v0] Error adding deployment log:', error);
    }
  }

  /**
   * Add build log entry
   */
  async addBuildLog(buildId, message, level = 'info') {
    try {
      await Log.create({
        buildId,
        message,
        level,
        service: 'build',
        timestamp: new Date()
      });
    } catch (error) {
      console.error('[v0] Error adding build log:', error);
    }
  }

  /**
   * Cleanup old logs
   */
  async cleanupOldLogs(daysOld = 30) {
    try {
      const cutoff = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);
      const result = await Log.deleteMany({
        timestamp: { $lt: cutoff }
      });
      console.log(`[v0] Cleaned up ${result.deletedCount} old log entries`);
      return result;
    } catch (error) {
      console.error('[v0] Error cleaning up logs:', error);
      throw error;
    }
  }
}

module.exports = new LogService()
