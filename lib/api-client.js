class NetworkError extends Error {
  constructor(endpoint) {
    super(`Network error when accessing ${endpoint}`)
    this.name = 'NetworkError'
  }
}

class APIError extends Error {
  constructor(endpoint, status, code, message) {
    super(message)
    this.name = 'APIError'
    this.endpoint = endpoint
    this.status = status
    this.code = code
  }
}

class AuthenticationError extends APIError {
  constructor(endpoint) {
    super(endpoint, 401, 'UNAUTHORIZED', 'Authentication required')
    this.name = 'AuthenticationError'
  }
}

class AuthorizationError extends APIError {
  constructor(endpoint) {
    super(endpoint, 403, 'FORBIDDEN', 'Not authorized to access this resource')
    this.name = 'AuthorizationError'
  }
}

class APIClient {
  constructor(baseURL = "/api") {
    this.baseURL = baseURL
    // Prefer an explicit API URL provided via NEXT_PUBLIC_API_URL in the frontend build.
    // Fall back to window.location.origin when running locally without the env var.
    const envApi = typeof process !== 'undefined' ? process.env.NEXT_PUBLIC_API_URL : undefined
    this.apiOrigin = typeof window !== "undefined" ? (envApi || window.location.origin) : (envApi || "")
    this.token = typeof window !== "undefined" ? localStorage.getItem("auth_token") : null
    this.retryCount = 0
    this.maxRetries = 3
    this.retryDelay = 2000 // 2 seconds
    this.tokenService = null // Lazy load to avoid SSR issues
  }

  /**
   * Get token service instance (lazy load)
   */
  getTokenService() {
    if (!this.tokenService && typeof window !== 'undefined') {
      try {
        // Dynamic import to avoid SSR issues
        const tokenService = require('./token-service').default
        this.tokenService = tokenService
      } catch (e) {
        console.warn('[v0] Token service not available, using localStorage directly')
      }
    }
    return this.tokenService
  }

  setToken(token) {
    this.token = token
    const tokenSvc = this.getTokenService()
    if (tokenSvc) {
      tokenSvc.setAccessToken(token)
    } else if (typeof window !== "undefined") {
      localStorage.setItem("auth_token", token)
    }
  }

  setRefreshToken(refreshToken) {
    const tokenSvc = this.getTokenService()
    if (tokenSvc) {
      tokenSvc.setRefreshToken(refreshToken)
    } else if (typeof window !== "undefined") {
      localStorage.setItem("refresh_token", refreshToken)
    }
  }

  getRefreshToken() {
    const tokenSvc = this.getTokenService()
    if (tokenSvc) {
      return tokenSvc.getRefreshToken()
    }
    if (typeof window !== "undefined") {
      return localStorage.getItem("refresh_token")
    }
    return null
  }

  clearTokens() {
    this.token = null
    const tokenSvc = this.getTokenService()
    if (tokenSvc) {
      tokenSvc.clearAll()
    } else if (typeof window !== "undefined") {
      localStorage.removeItem("auth_token")
      localStorage.removeItem("refresh_token")
    }
  }

  async request(endpoint, options = {}, isAuthEndpoint = false, retryCount = 0) {
    // Build the request URL:
    // - For auth endpoints we use the apiOrigin (which may be NEXT_PUBLIC_API_URL or window.location.origin)
    // - For regular API endpoints prefer the configured apiOrigin + baseURL when apiOrigin is provided
    // - Fall back to relative baseURL (e.g. '/api') so it works on same-origin setups
    const normalizedApiOrigin = this.apiOrigin ? String(this.apiOrigin).replace(/\/$/, '') : ''
    const normalizedBaseURL = String(this.baseURL || '/api').replace(/\/$/, '')

    let baseUrl
    if (isAuthEndpoint) {
      baseUrl = normalizedApiOrigin || normalizedBaseURL
    } else {
      baseUrl = normalizedApiOrigin ? `${normalizedApiOrigin}${normalizedBaseURL}` : normalizedBaseURL
    }

    // Ensure endpoint begins with a slash
    const normalizedEndpoint = String(endpoint).startsWith('/') ? endpoint : `/${endpoint}`
    const url = `${baseUrl}${normalizedEndpoint}`
    
    const headers = {
      "Content-Type": "application/json",
      ...(this.token && { Authorization: `Bearer ${this.token}` }),
      ...options.headers,
    }

    try {
      const response = await fetch(url, {
        ...options,
        headers,
      }).catch(error => {
        // Log full URL and original error to help debugging network issues (CORS, ECONNREFUSED, DNS, etc.)
        console.error(`[Network Error] ${url}:`, error)
        throw new NetworkError(`${url} (${endpoint})`)
      })

      // Handle rate limiting with exponential backoff
      if (response.status === 429) {
        if (retryCount < this.maxRetries) {
          const delay = this.retryDelay * Math.pow(2, retryCount)
          console.warn(`Rate limited, retrying after ${delay}ms...`)
          await new Promise(resolve => setTimeout(resolve, delay))
          return this.request(endpoint, options, isAuthEndpoint, retryCount + 1)
        }
        throw new APIError(endpoint, 429, 'RATE_LIMITED', 'Too many requests')
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        
        if (response.status === 401) {
          // Try to refresh token if authenticated endpoint
          if (!isAuthEndpoint && this.token) {
            try {
              await this.refreshAccessToken()
              // Retry the original request with new token
              return this.request(endpoint, options, isAuthEndpoint)
            } catch (refreshError) {
              throw new AuthenticationError(endpoint)
            }
          }
          throw new AuthenticationError(endpoint)
        }

        if (response.status === 403) {
          throw new AuthorizationError(endpoint)
        }

        // Handle server errors with retry logic
        if (response.status >= 500 && retryCount < this.maxRetries) {
          const delay = this.retryDelay * Math.pow(2, retryCount)
          console.warn(`Server error, retrying after ${delay}ms...`)
          await new Promise(resolve => setTimeout(resolve, delay))
          return this.request(endpoint, options, isAuthEndpoint, retryCount + 1)
        }

        throw new APIError(
          endpoint,
          response.status,
          errorData.code,
          errorData.error || `HTTP ${response.status}`
        )
      }

      try {
        return await response.json()
      } catch (error) {
        // Handle empty responses
        if (response.status === 204) {
          return null
        }
        throw new APIError(endpoint, response.status, 'INVALID_JSON', 'Invalid JSON response')
      }

    } catch (error) {
      // Handle network errors with retry logic
      if (error instanceof NetworkError && retryCount < this.maxRetries) {
        const delay = this.retryDelay * Math.pow(2, retryCount)
        console.warn(`Network error, retrying after ${delay}ms...`)
        await new Promise(resolve => setTimeout(resolve, delay))
        return this.request(endpoint, options, isAuthEndpoint, retryCount + 1)
      }

      // Only log network or unexpected errors
      if (!(error instanceof APIError)) {
        console.error(`[API Error] ${endpoint}:`, error)
      }
      throw error
    }
  }

  // ==================== Authentication ====================
  
  async signup(email, password, confirmPassword, name) {
    const data = await this.request("/auth/signup", {
      method: "POST",
      body: JSON.stringify({ email, password, confirmPassword, name }),
    }, true)
    
    if (data.token) {
      this.setToken(data.token)
      this.setRefreshToken(data.refreshToken)
    }
    return data
  }

  async login(email, password) {
    const data = await this.request("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }, true)
    
    if (data.token) {
      this.setToken(data.token)
      this.setRefreshToken(data.refreshToken)
    }
    return data
  }

  async logout() {
    try {
      await this.request("/auth/logout", {
        method: "POST",
      }, true)
    } catch (error) {
      console.warn("Logout error:", error)
    }
    this.clearTokens()
  }

  async refreshAccessToken() {
    const refreshToken = this.getRefreshToken()
    if (!refreshToken) {
      throw new Error("No refresh token available")
    }

    const data = await this.request("/auth/refresh", {
      method: "POST",
      body: JSON.stringify({ refreshToken }),
    }, true)

    if (data.token) {
      this.setToken(data.token)
    }
    return data
  }

  async getCurrentUser() {
    return this.request("/auth/me", {}, true)
  }

  async updateProfile(name, avatar) {
    return this.request("/auth/profile", {
      method: "PUT",
      body: JSON.stringify({ name, avatar }),
    }, true)
  }

  async changePassword(currentPassword, newPassword, confirmPassword) {
    return this.request("/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
    }, true)
  }

  async forgotPassword(email) {
    return this.request("/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email }),
    }, true)
  }

  async resetPassword(resetToken, newPassword, confirmPassword) {
    return this.request("/auth/reset-password", {
      method: "POST",
      body: JSON.stringify({ resetToken, newPassword, confirmPassword }),
    }, true)
  }

  startGoogleOAuth() {
    if (typeof window !== "undefined") {
      // Uses Next.js rewrite to forward to backend
      window.location.href = `/auth/google`
    }
  }

  startGitHubOAuth() {
    if (typeof window !== "undefined") {
      // Uses Next.js rewrite to forward to backend
      window.location.href = `/auth/github`
    }
  }

  // Deployments
  async getDeployments(projectId, limit = 50) {
    return this.request(`/deployments/project/${projectId}?limit=${limit}`)
  }

  async createDeployment(data) {
    return this.request("/deployments", { method: "POST", body: JSON.stringify(data) })
  }

  async getDeployment(id) {
    return this.request(`/deployments/${id}`)
  }

  async getDeploymentById(id) {
    return this.request(`/deployments/${id}`)
  }

  async updateDeploymentStatus(id, status) {
    return this.request(`/deployments/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) })
  }

  async rollbackDeployment(id) {
    return this.request(`/deployments/${id}/rollback`, { method: "POST" })
  }

  async getDeploymentLogs(id) {
    return this.request(`/deployments/${id}/logs`)
  }

  // Projects
  async getProjects() {
    return this.request("/projects")
  }

  async getProjectsOverview() {
    return this.request("/projects?overview=true")
  }

  async getProjectsOverview() {
    return this.request("/projects?overview=true")
  }

  async createProject(data) {
    return this.request("/projects", { method: "POST", body: JSON.stringify(data) })
  }

  async getProject(id) {
    return this.request(`/projects/${id}`)
  }

  async updateProject(id, data) {
    return this.request(`/projects/${id}`, { method: "PATCH", body: JSON.stringify(data) })
  }

  async deleteProject(id) {
    return this.request(`/projects/${id}`, { method: "DELETE" })
  }

  async getProjectStats(id) {
    return this.request(`/projects/${id}/stats`)
  }

  // Databases
  async getDatabases(projectId) {
    const query = projectId ? `?projectId=${projectId}` : ''
    return this.request(`/databases${query}`)
  }

  async createDatabase(data) {
    return this.request('/databases', { method: 'POST', body: JSON.stringify(data) })
  }

  async getDatabaseDetail(id) {
    return this.request(`/databases/${id}`)
  }

  async updateDatabase(id, data) {
    return this.request(`/databases/${id}`, { method: 'PATCH', body: JSON.stringify(data) })
  }

  async deleteDatabase(id) {
    return this.request(`/databases/${id}`, { method: 'DELETE' })
  }

  // Database Operations
  async executeQuery(databaseId, query) {
    return this.request(`/databases/${databaseId}/query`, {
      method: 'POST',
      body: JSON.stringify({ query })
    })
  }

  async getTables(databaseId) {
    return this.request(`/databases/${databaseId}/tables`)
  }

  async getTableSchema(databaseId, tableName) {
    return this.request(`/databases/${databaseId}/tables/${tableName}/schema`)
  }

  async browseTable(databaseId, tableName, options = {}) {
    const query = new URLSearchParams(options).toString()
    return this.request(`/databases/${databaseId}/tables/${tableName}/browse${query ? `?${query}` : ''}`)
  }

  // Database Backups
  async createBackup(databaseId) {
    return this.request(`/databases/${databaseId}/backups`, { method: 'POST' })
  }

  async getBackups(databaseId) {
    return this.request(`/databases/${databaseId}/backups`)
  }

  async restoreBackup(databaseId, backupId) {
    return this.request(`/databases/${databaseId}/backups/${backupId}/restore`, { method: 'POST' })
  }

  async deleteBackup(databaseId, backupId) {
    return this.request(`/databases/${databaseId}/backups/${backupId}`, { method: 'DELETE' })
  }

  // Database Statistics and Health
  async getDatabaseStats(databaseId) {
    return this.request(`/databases/${databaseId}/stats`)
  }

  async getDatabaseHealth(databaseId) {
    return this.request(`/databases/${databaseId}/health`)
  }

  async getDatabaseMetrics(databaseId, timeRange = 7) {
    return this.request(`/databases/${databaseId}/metrics?timeRange=${timeRange}`)
  }

  async getDatabaseConnections(databaseId) {
    return this.request(`/databases/${databaseId}/connections`)
  }

  // Database Users
  async createDatabaseUser(databaseId, userData) {
    return this.request(`/databases/${databaseId}/users`, {
      method: 'POST',
      body: JSON.stringify(userData)
    })
  }

  async getDatabaseUsers(databaseId) {
    return this.request(`/databases/${databaseId}/users`)
  }

  async updateDatabaseUser(databaseId, userId, userData) {
    return this.request(`/databases/${databaseId}/users/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify(userData)
    })
  }

  async deleteDatabaseUser(databaseId, userId) {
    return this.request(`/databases/${databaseId}/users/${userId}`, { method: 'DELETE' })
  }

  // Database Templates
  async getDatabaseTemplates() {
    return this.request('/databases/templates')
  }

  async createDatabaseFromTemplate(templateId, data) {
    return this.request(`/databases/templates/${templateId}/create`, {
      method: 'POST',
      body: JSON.stringify(data)
    })
  }

  // Database Migrations
  async getDatabaseMigrations(databaseId) {
    return this.request(`/databases/${databaseId}/migrations`)
  }

  async runMigration(databaseId, migrationData) {
    return this.request(`/databases/${databaseId}/migrations`, {
      method: 'POST',
      body: JSON.stringify(migrationData)
    })
  }

  // Database Scaling
  async scaleDatabaseUp(databaseId, newSize) {
    return this.request(`/databases/${databaseId}/scale`, {
      method: 'POST',
      body: JSON.stringify({ size: newSize })
    })
  }

  async getDatabaseScalingOptions(databaseId) {
    return this.request(`/databases/${databaseId}/scaling-options`)
  }

  // Database Compliance
  async getDatabaseCompliance(databaseId) {
    return this.request(`/databases/${databaseId}/compliance`)
  }

  async runComplianceCheck(databaseId) {
    return this.request(`/databases/${databaseId}/compliance/check`, { method: 'POST' })
  }

  // Functions
  async getFunctions(projectId) {
    return this.request(`/functions/project/${projectId}`)
  }

  async createFunction(projectId, data) {
    return this.request(`/functions/project/${projectId}`, { method: "POST", body: JSON.stringify(data) })
  }

  async updateFunction(id, data) {
    return this.request(`/functions/${id}`, { method: "PATCH", body: JSON.stringify(data) })
  }

  async deleteFunction(id) {
    return this.request(`/functions/${id}`, { method: "DELETE" })
  }

  async invokeFunction(id) {
    return this.request(`/functions/${id}/invoke`, { method: "POST" })
  }

  // Cron Jobs
  async getCronJobs(projectId) {
    return this.request(`/cronjobs/project/${projectId}`)
  }

  async createCronJob(projectId, data) {
    return this.request(`/cronjobs/project/${projectId}`, { method: "POST", body: JSON.stringify(data) })
  }

  async updateCronJob(id, data) {
    return this.request(`/cronjobs/${id}`, { method: "PATCH", body: JSON.stringify(data) })
  }

  async deleteCronJob(id) {
    return this.request(`/cronjobs/${id}`, { method: "DELETE" })
  }

  async runCronJob(id) {
    return this.request(`/cronjobs/${id}/run`, { method: "POST" })
  }

  // Domains
  async getDomains(projectId) {
    return this.request(`/domains/project/${projectId}`)
  }

  async createDomain(projectId, host) {
    return this.request(`/domains/project/${projectId}`, { method: "POST", body: JSON.stringify({ host }) })
  }

  async verifyDomain(id) {
    return this.request(`/domains/${id}/verify`, { method: "POST" })
  }

  async deleteDomain(id) {
    return this.request(`/domains/${id}`, { method: "DELETE" })
  }

  // Environment
  async getEnvironments(projectId, scope) {
    const query = scope ? `?scope=${scope}` : ""
    return this.request(`/environment/project/${projectId}${query}`)
  }

  async createEnvironment(projectId, data) {
    return this.request(`/environment/project/${projectId}`, { method: "POST", body: JSON.stringify(data) })
  }

  async updateEnvironment(id, data) {
    return this.request(`/environment/${id}`, { method: "PATCH", body: JSON.stringify(data) })
  }

  // Metrics and Health
  async getMetricsSummary(projectId) {
    if (!projectId) return null
    return this.request(`/monitoring/metrics/${projectId}`)
  }

  async getServiceHealth(projectId) {
    if (!projectId) return null
    return this.request(`/monitoring/health/${projectId}`)
  }

  // Dashboard specific methods
  async getDashboardData() {
    return this.request('/dashboard')
  }

  async getDashboardStats() {
    return this.request('/dashboard/stats')
  }

  async getDashboardMetrics(projectId) {
    return this.request(`/dashboard/metrics?projectId=${projectId}`)
  }

  async getDashboardActivity() {
    return this.request('/dashboard/recent-activity')
  }

  async getAllDeployments() {
    return this.request('/deployments')
  }

  // Fix the incomplete method
  async createDatabaseOld(projectId, data) {
    return this.request(`/databases/project/${projectId}`, { method: "POST", body: JSON.stringify(data) })
  }

  async updateDatabase(id, data) {
    return this.request(`/databases/${id}`, { method: "PATCH", body: JSON.stringify(data) })
  }

  async deleteDatabase(id) {
    return this.request(`/databases/${id}`, { method: "DELETE" })
  }

  // Functions
  async getFunctions(projectId) {
    return this.request(`/functions/project/${projectId}`)
  }

  async createFunction(projectId, data) {
    return this.request(`/functions/project/${projectId}`, { method: "POST", body: JSON.stringify(data) })
  }

  async updateFunction(id, data) {
    return this.request(`/functions/${id}`, { method: "PATCH", body: JSON.stringify(data) })
  }

  async deleteFunction(id) {
    return this.request(`/functions/${id}`, { method: "DELETE" })
  }

  async invokeFunction(id) {
    return this.request(`/functions/${id}/invoke`, { method: "POST" })
  }

  // Cron Jobs
  async getCronJobs(projectId) {
    return this.request(`/cronjobs/project/${projectId}`)
  }

  async createCronJob(projectId, data) {
    return this.request(`/cronjobs/project/${projectId}`, { method: "POST", body: JSON.stringify(data) })
  }

  async updateCronJob(id, data) {
    return this.request(`/cronjobs/${id}`, { method: "PATCH", body: JSON.stringify(data) })
  }

  async deleteCronJob(id) {
    return this.request(`/cronjobs/${id}`, { method: "DELETE" })
  }

  async runCronJob(id) {
    return this.request(`/cronjobs/${id}/run`, { method: "POST" })
  }

  // Domains
  async getDomains(projectId) {
    return this.request(`/domains/project/${projectId}`)
  }

  async createDomain(projectId, host) {
    return this.request(`/domains/project/${projectId}`, { method: "POST", body: JSON.stringify({ host }) })
  }

  async verifyDomain(id) {
    return this.request(`/domains/${id}/verify`, { method: "POST" })
  }

  async deleteDomain(id) {
    return this.request(`/domains/${id}`, { method: "DELETE" })
  }

  // Environment
  async getEnvironments(projectId, scope) {
    const query = scope ? `?scope=${scope}` : ""
    return this.request(`/environment/project/${projectId}${query}`)
  }

  async createEnvironment(projectId, data) {
    return this.request(`/environment/project/${projectId}`, { method: "POST", body: JSON.stringify(data) })
  }

  async updateEnvironment(id, data) {
    return this.request(`/environment/${id}`, { method: "PATCH", body: JSON.stringify(data) })
  }

  async deleteEnvironment(id) {
    return this.request(`/environment/${id}`, { method: "DELETE" })
  }

  // Team
  async getTeamMembers(projectId) {
    return this.request(`/team/project/${projectId}`)
  }

  async inviteMember(projectId, email, role) {
    return this.request(`/team/project/${projectId}/invite`, {
      method: "POST",
      body: JSON.stringify({ email, role }),
    })
  }

  async updateMemberRole(id, role) {
    return this.request(`/team/${id}/role`, { method: "PATCH", body: JSON.stringify({ role }) })
  }

  async removeMember(id) {
    return this.request(`/team/${id}`, { method: "DELETE" })
  }

  // Logs
  async getLogs(projectId, options = {}) {
    const query = new URLSearchParams(options).toString()
    return this.request(`/logs/project/${projectId}${query ? `?${query}` : ""}`)
  }

  async getLogStats(projectId) {
    return this.request(`/logs/project/${projectId}/stats`)
  }

  async clearLogs(projectId) {
    return this.request(`/logs/project/${projectId}`, { method: "DELETE" })
  }

  // Build Management
  async getBuildCache(projectId) {
    return this.request(`/builds/cache/${projectId}`)
  }

  async initiateBuild(projectId, deploymentId, config) {
    return this.request("/builds/initiate", {
      method: "POST",
      body: JSON.stringify({ projectId, deploymentId, config }),
    })
  }

  async recordBuildStep(deploymentId, step, duration, status) {
    return this.request(`/builds/${deploymentId}/step`, {
      method: "POST",
      body: JSON.stringify({ step, duration, status }),
    })
  }

  async finalizeBuild(deploymentId, metrics) {
    return this.request(`/builds/${deploymentId}/finalize`, {
      method: "POST",
      body: JSON.stringify(metrics),
    })
  }

  async generateCacheKey(framework, dependencies, buildConfig) {
    return this.request("/builds/cache-key", {
      method: "POST",
      body: JSON.stringify({ framework, dependencies, buildConfig }),
    })
  }

  async getBuildRecommendations(deploymentId, metrics) {
    return this.request(`/builds/recommendations/${deploymentId}`, {
      method: "POST",
      body: JSON.stringify({ metrics }),
    })
  }

  // Monitoring and Analytics
  async recordMetric(projectId, deploymentId, metricType, value, region) {
    return this.request("/monitoring/metric", {
      method: "POST",
      body: JSON.stringify({ projectId, deploymentId, metricType, value, region }),
    })
  }

  async getMetrics(projectId, metricType, timeRange = 7) {
    return this.request(`/monitoring/metrics/${projectId}?metricType=${metricType}&timeRange=${timeRange}`)
  }

  async getMetricsSummary(projectId, timeRange = 7) {
    return this.request(`/monitoring/summary/${projectId}?timeRange=${timeRange}`)
  }

  async getServiceHealth(projectId) {
    return this.request(`/monitoring/health/${projectId}`)
  }

  async getErrorLogs(projectId, timeRange = 1) {
    return this.request(`/monitoring/errors/${projectId}?timeRange=${timeRange}`)
  }

  async getHealthMetrics(projectId) {
    const [health, metrics] = await Promise.all([
      this.getServiceHealth(projectId),
      this.getMetricsSummary(projectId)
    ]);
    return {
      health,
      metrics,
      status: health.status,
      responseTime: metrics.responseTime?.avg || 0,
      errorRate: metrics.errorRate?.avg || 0,
      uptime: health.statusCode || 100,
      bandwidth: metrics.bandwidth?.avg || 0
    };
  }

  async getDashboardMetrics(projectId) {
    const [metrics, deployments] = await Promise.all([
      this.getMetricsSummary(projectId),
      this.getDeployments(projectId)
    ]);

    const successful = deployments.filter(d => d.status === 'success' || d.status === 'Running').length;
    const failed = deployments.filter(d => d.status === 'failed' || d.status === 'Failed').length;
    const building = deployments.filter(d => d.status === 'Building').length;

    return {
      ...metrics,
      deployments: {
        total: deployments.length,
        successful,
        failed,
        building,
        successRate: deployments.length ? (successful / deployments.length) * 100 : 100
      }
    };
  }

  // Deployment Metrics and Analytics
  async getDeploymentMetrics(deploymentId) {
    return this.request(`/deployments/${deploymentId}/metrics`)
  }

  async getDeploymentAnalytics(projectId, timeRange = 7) {
    return this.request(`/deployments/analytics/project/${projectId}?timeRange=${timeRange}`)
  }

  async getDeploymentsByStatus(projectId, status) {
    return this.request(`/deployments/project/${projectId}?status=${status}`)
  }

  async rollbackDeploymentWithReason(id, reason) {
    return this.request(`/deployments/${id}/rollback`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    })
  }

  // Project Health and Statistics
  async getProjectHealth(projectId) {
    return this.request(`/projects/${projectId}/health`)
  }

  async getFunctionMetrics(functionId) {
    return this.request(`/functions/${functionId}/metrics`)
  }

  async toggleFunction(functionId, enabled) {
    return this.request(`/functions/${functionId}/toggle`, {
      method: "PATCH",
      body: JSON.stringify({ enabled }),
    })
  }

  // Cron Jobs - Enhanced
  async toggleCronJob(cronJobId, enabled) {
    return this.request(`/cronjobs/${cronJobId}`, {
      method: "PATCH",
      body: JSON.stringify({ enabled }),
    })
  }

  // DNS Records
  async getDNSRecords(params) {
    const query = new URLSearchParams(params).toString()
    return this.request(`/dns/records${query ? `?${query}` : ""}`)
  }

  async addDNSRecord(data) {
    return this.request("/dns/records", {
      method: "POST",
      body: JSON.stringify(data),
    })
  }

  async updateDNSRecord(recordId, data) {
    return this.request(`/dns/records/${recordId}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    })
  }

  async deleteDNSRecord(recordId) {
    return this.request(`/dns/records/${recordId}`, {
      method: "DELETE",
    })
  }

  // SSL Certificates
  async getSSLCertificates(params) {
    const query = new URLSearchParams(params).toString()
    return this.request(`/ssl/certificates${query ? `?${query}` : ""}`)
  }

  async uploadSSLCertificate(formData) {
    return this.request("/ssl/certificates", {
      method: "POST",
      body: formData,
      headers: {}, // Remove Content-Type to let browser set it for FormData
    })
  }

  async deleteSSLCertificate(certificateId) {
    return this.request(`/ssl/certificates/${certificateId}`, {
      method: "DELETE",
    })
  }

  async renewSSLCertificate(certificateId) {
    return this.request(`/ssl/certificates/${certificateId}/renew`, {
      method: "POST",
    })
  }

  // Domain Redirects
  async getDomainRedirects(params) {
    const query = new URLSearchParams(params).toString()
    return this.request(`/domains/redirects${query ? `?${query}` : ""}`)
  }

  async addDomainRedirect(domainId, data) {
    return this.request(`/domains/${domainId}/redirects`, {
      method: "POST",
      body: JSON.stringify(data),
    })
  }

  async updateDomainRedirect(redirectId, data) {
    return this.request(`/domains/redirects/${redirectId}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    })
  }

  async deleteDomainRedirect(redirectId) {
    return this.request(`/domains/redirects/${redirectId}`, {
      method: "DELETE",
    })
  }

  // Edge Handlers
  async getEdgeHandlers() {
    return this.request("/edge-handlers")
  }

  async createEdgeHandler(data) {
    return this.request("/edge-handlers", {
      method: "POST",
      body: JSON.stringify(data),
    })
  }

  async updateEdgeHandler(handlerId, data) {
    return this.request(`/edge-handlers/${handlerId}`, {
      method: "PUT",
      body: JSON.stringify(data),
    })
  }

  async deleteEdgeHandler(handlerId) {
    return this.request(`/edge-handlers/${handlerId}`, {
      method: "DELETE",
    })
  }

  async deployEdgeHandler(handlerId) {
    return this.request(`/edge-handlers/${handlerId}/deploy`, {
      method: "POST",
    })
  }

  async testEdgeHandler(handlerId, testData) {
    return this.request(`/edge-handlers/${handlerId}/test`, {
      method: "POST",
      body: JSON.stringify(testData),
    })
  }

  // Provider Operations
  async getSupportedProviders() {
    return this.request("/providers/list")
  }

  async connectProvider(provider, credentials) {
    return this.request("/providers/connect", {
      method: "POST",
      body: JSON.stringify({ provider, credentials }),
    })
  }

  async disconnectProvider(provider) {
    return this.request(`/providers/${provider}/disconnect`, {
      method: "DELETE",
    })
  }

  async startProviderDeployment(projectId, provider, config) {
    return this.request("/providers/deploy", {
      method: "POST",
      body: JSON.stringify({ projectId, provider, config }),
    })
  }

  async getProviderDeploymentStatus(deploymentId) {
    return this.request(`/providers/deployments/${deploymentId}/status`)
  }

  async getProviderDeploymentLogs(deploymentId, limit = 50, offset = 0) {
    return this.request(`/providers/deployments/${deploymentId}/logs?limit=${limit}&offset=${offset}`)
  }

  async cancelProviderDeployment(deploymentId) {
    return this.request(`/providers/deployments/${deploymentId}/cancel`, {
      method: "POST",
    })
  }

  // ==================== Billing & Subscription ====================
  
  // Plans
  async getBillingPlans() {
    return this.request("/billing/plans")
  }

  async getCurrentPlan() {
    return this.request("/billing/subscription")
  }

  async upgradePlan(planId) {
    return this.request("/billing/subscription", {
      method: "POST",
      body: JSON.stringify({ planId })
    })
  }

  async downgradePlan(planId) {
    return this.request("/billing/subscription", {
      method: "PUT",
      body: JSON.stringify({ planId })
    })
  }

  async updateSubscription(subscriptionId, data) {
    return this.request(`/billing/subscription/${subscriptionId}`, {
      method: "PUT",
      body: JSON.stringify(data)
    })
  }

  async cancelSubscription(subscriptionId, options = {}) {
    return this.request(`/billing/subscription/${subscriptionId}`, {
      method: "DELETE",
      body: JSON.stringify(options)
    })
  }

  // Usage & Analytics
  async getCurrentUsage() {
    return this.request("/billing/usage")
  }

  async getUsageHistory(options = {}) {
    const query = new URLSearchParams(options).toString()
    return this.request(`/billing/usage/history${query ? `?${query}` : ""}`)
  }

  async getUsageAnalytics(subscriptionId, options = {}) {
    const query = new URLSearchParams(options).toString()
    return this.request(`/billing/subscription/${subscriptionId}/usage${query ? `?${query}` : ""}`)
  }

  // Invoices
  async getInvoices(options = {}) {
    const query = new URLSearchParams(options).toString()
    return this.request(`/billing/invoices${query ? `?${query}` : ""}`)
  }

  async getInvoiceDetails(invoiceId) {
    return this.request(`/billing/invoices/${invoiceId}`)
  }

  async downloadInvoice(invoiceId) {
    return this.request(`/billing/invoices/${invoiceId}/download`)
  }

  async resendInvoice(invoiceId) {
    return this.request(`/billing/invoices/${invoiceId}/resend`, {
      method: "POST"
    })
  }

  // Payment Methods
  async getPaymentMethods() {
    return this.request("/billing/payment-methods")
  }

  async addPaymentMethod(paymentMethodData) {
    return this.request("/billing/payment-methods", {
      method: "POST",
      body: JSON.stringify(paymentMethodData)
    })
  }

  async deletePaymentMethod(methodId) {
    return this.request(`/billing/payment-methods/${methodId}`, {
      method: "DELETE"
    })
  }

  async setDefaultPaymentMethod(methodId) {
    return this.request(`/billing/payment-methods/${methodId}/default`, {
      method: "POST"
    })
  }

  // Cost Optimization
  async getCostOptimizationRecommendations() {
    return this.request("/billing/cost-optimization/recommendations")
  }

  async getCostBreakdown() {
    return this.request("/billing/cost-optimization/breakdown")
  }

  async getCostProjections() {
    return this.request("/billing/cost-optimization/projections")
  }

  async applyCostOptimizationRecommendation(recommendationId) {
    return this.request(`/billing/cost-optimization/recommendations/${recommendationId}/apply`, {
      method: "POST"
    })
  }

  // Billing Analytics
  async getBillingAnalytics(options = {}) {
    const query = new URLSearchParams(options).toString()
    return this.request(`/billing/analytics${query ? `?${query}` : ""}`)
  }

  async getBillingTrends(timeframe = '30d') {
    return this.request(`/billing/analytics/trends?timeframe=${timeframe}`)
  }

  async getBillingForecast() {
    return this.request("/billing/analytics/forecast")
  }

  // ==================== Team Management ====================

  // Team Groups
  async getTeamGroups() {
    return this.request("/team/groups")
  }

  async createTeamGroup(data) {
    return this.request("/team/groups", {
      method: "POST",
      body: JSON.stringify(data)
    })
  }

  async getTeamGroupById(id) {
    return this.request(`/team/groups/${id}`)
  }

  async updateTeamGroup(id, data) {
    return this.request(`/team/groups/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data)
    })
  }

  async deleteTeamGroup(id) {
    return this.request(`/team/groups/${id}`, {
      method: "DELETE"
    })
  }

  // SSO Configuration
  async getSSOConfig() {
    return this.request("/team/sso")
  }

  async updateSSOConfig(data) {
    return this.request("/team/sso", {
      method: "PUT", 
      body: JSON.stringify(data)
    })
  }

  async deleteSSOConfig() {
    return this.request("/team/sso", {
      method: "DELETE"
    })
  }

  async testSSOConfig(data) {
    return this.request("/team/sso/test", {
      method: "POST",
      body: JSON.stringify(data)
    })
  }

  // Billing Contacts
  async getBillingContacts() {
    return this.request("/team/billing-contacts")
  }

  async createBillingContact(data) {
    return this.request("/team/billing-contacts", {
      method: "POST",
      body: JSON.stringify(data)
    })
  }

  async getBillingContactById(id) {
    return this.request(`/team/billing-contacts/${id}`)
  }

  async updateBillingContact(id, data) {
    return this.request(`/team/billing-contacts/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data)
    })
  }

  async deleteBillingContact(id) {
    return this.request(`/team/billing-contacts/${id}`, {
      method: "DELETE"
    })
  }

  async setDefaultBillingContact(id) {
    return this.request(`/team/billing-contacts/${id}/default`, {
      method: "POST"
    })
  }

  // ==================== Deployment Management ====================
  
  // Alerts
  async getAlerts(projectId) {
    return this.request(`/alerts/project/${projectId}`)
  }

  async createAlert(projectId, alertData) {
    return this.request(`/alerts/project/${projectId}`, {
      method: "POST",
      body: JSON.stringify(alertData)
    })
  }

  async updateAlert(alertId, alertData) {
    return this.request(`/alerts/${alertId}`, {
      method: "PATCH",
      body: JSON.stringify(alertData)
    })
  }

  async deleteAlert(alertId) {
    return this.request(`/alerts/${alertId}`, {
      method: "DELETE"
    })
  }

  async toggleAlert(alertId) {
    return this.request(`/alerts/${alertId}/toggle`, {
      method: "POST"
    })
  }

  // Incidents
  async getIncidents(projectId) {
    return this.request(`/incidents/project/${projectId}`)
  }

  async createIncident(projectId, incidentData) {
    return this.request(`/incidents/project/${projectId}`, {
      method: "POST",
      body: JSON.stringify(incidentData)
    })
  }

  async updateIncidentStatus(incidentId, status) {
    return this.request(`/incidents/${incidentId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status })
    })
  }

  async resolveIncident(incidentId, resolutionData) {
    return this.request(`/incidents/${incidentId}/resolve`, {
      method: "POST",
      body: JSON.stringify(resolutionData)
    })
  }

  async getIncidentById(incidentId) {
    return this.request(`/incidents/${incidentId}`)
  }

  // Escalation Policies
  async getEscalationPolicies(projectId) {
    return this.request(`/escalation/project/${projectId}`)
  }

  async createEscalationPolicy(projectId, policyData) {
    return this.request(`/escalation/project/${projectId}`, {
      method: "POST",
      body: JSON.stringify(policyData)
    })
  }

  async updateEscalationPolicy(policyId, policyData) {
    return this.request(`/escalation/${policyId}`, {
      method: "PATCH",
      body: JSON.stringify(policyData)
    })
  }

  async deleteEscalationPolicy(policyId) {
    return this.request(`/escalation/${policyId}`, {
      method: "DELETE"
    })
  }

  async toggleEscalationPolicy(policyId) {
    return this.request(`/escalation/${policyId}/toggle`, {
      method: "POST"
    })
  }

  async getTeams(projectId) {
    return this.request(`/escalation/project/${projectId}/teams`)
  }

  // Uptime Monitoring
  async getUptimeMetrics(projectId, timeRange = '30d') {
    return this.request(`/uptime/project/${projectId}/metrics?timeRange=${timeRange}`)
  }

  async getSLAStatus(projectId) {
    return this.request(`/uptime/project/${projectId}/sla`)
  }

  async getUptimeHistory(projectId, days = 7) {
    return this.request(`/uptime/project/${projectId}/history?days=${days}`)
  }

  async recordUptimeCheck(projectId, checkData) {
    return this.request(`/uptime/project/${projectId}/check`, {
      method: "POST",
      body: JSON.stringify(checkData)
    })
  }

  // Webhooks
  async getWebhooks(projectId) {
    return this.request(`/webhooks?projectId=${projectId}`)
  }

  async createWebhook(projectId, webhookData) {
    return this.request("/webhooks", {
      method: "POST",
      body: JSON.stringify({ ...webhookData, projectId })
    })
  }

  async updateWebhook(webhookId, webhookData) {
    return this.request(`/webhooks/${webhookId}`, {
      method: "PUT",
      body: JSON.stringify(webhookData)
    })
  }

  async deleteWebhook(webhookId) {
    return this.request(`/webhooks/${webhookId}`, {
      method: "DELETE"
    })
  }

  async toggleWebhook(webhookId) {
    return this.request(`/webhooks/${webhookId}/toggle`, {
      method: "POST"
    })
  }

  async testWebhook(webhookId, testData = {}) {
    return this.request(`/webhooks/${webhookId}/test`, {
      method: "POST",
      body: JSON.stringify(testData)
    })
  }

  async getWebhookDeliveries(webhookId, options = {}) {
    const query = new URLSearchParams(options).toString()
    return this.request(`/webhooks/deliveries?webhookId=${webhookId}${query ? `&${query}` : ""}`)
  }

  async retryWebhookDelivery(deliveryId) {
    return this.request(`/webhooks/deliveries/${deliveryId}/retry`, {
      method: "POST"
    })
  }

  async getWebhookStatistics(webhookId, timeRange = 7) {
    return this.request(`/webhooks/statistics?webhookId=${webhookId}&timeRange=${timeRange}`)
  }

  // Custom Metrics
  async getCustomMetrics(projectId) {
    return this.request(`/metrics/project/${projectId}`)
  }

  async createMetric(projectId, metricData) {
    return this.request(`/metrics/project/${projectId}`, {
      method: "POST",
      body: JSON.stringify(metricData)
    })
  }

  async updateMetric(metricId, metricData) {
    return this.request(`/metrics/${metricId}`, {
      method: "PATCH",
      body: JSON.stringify(metricData)
    })
  }

  async deleteMetric(metricId) {
    return this.request(`/metrics/${metricId}`, {
      method: "DELETE"
    })
  }

  async toggleMetric(metricId) {
    return this.request(`/metrics/${metricId}/toggle`, {
      method: "POST"
    })
  }

  // Reports
  async generateReport(projectId, reportData) {
    return this.request(`/reports/project/${projectId}/generate`, {
      method: "POST",
      body: JSON.stringify(reportData)
    })
  }

  async exportReport(projectId, exportData) {
    return this.request(`/reports/project/${projectId}/export`, {
      method: "POST",
      body: JSON.stringify(exportData)
    })
  }

  async getReports(projectId) {
    return this.request(`/reports/project/${projectId}`)
  }

  // Analytics
  async getAnalyticsOverview() {
    return this.request('/analytics/overview')
  }

  async getAnalyticsHistory(options = {}) {
    const query = new URLSearchParams(options).toString()
    return this.request(`/analytics/history${query ? `?${query}` : ""}`)
  }

  async getAnalyticsMetrics(options = {}) {
    const query = new URLSearchParams(options).toString()
    return this.request(`/analytics/metrics${query ? `?${query}` : ""}`)
  }

  async getDeploymentAnalytics(options = {}) {
    const query = new URLSearchParams(options).toString()
    return this.request(`/analytics/deployments${query ? `?${query}` : ""}`)
  }

  async getUserAnalytics(options = {}) {
    const query = new URLSearchParams(options).toString()
    return this.request(`/analytics/users${query ? `?${query}` : ""}`)
  }

  async getPerformanceAnalytics(options = {}) {
    const query = new URLSearchParams(options).toString()
    return this.request(`/analytics/performance${query ? `?${query}` : ""}`)
  }

  // Settings & Notifications
  async getNotificationSettings() {
    return this.request('/settings/notifications')
  }

  async updateNotificationSettings(settings) {
    return this.request('/settings/notifications', {
      method: 'PATCH',
      body: JSON.stringify(settings)
    })
  }

  async getNotificationHistory(options = {}) {
    const query = new URLSearchParams(options).toString()
    return this.request(`/settings/notifications/history${query ? `?${query}` : ""}`)
  }

  async testWebhook(endpoint) {
    return this.request('/settings/notifications/test-webhook', {
      method: 'POST',
      body: JSON.stringify({ endpoint })
    })
  }

  // ==================== GitHub Provider ====================

  // GitHub repositories
  async getGitHubRepositories() {
    console.log('API Client: Fetching GitHub repositories...');
    try {
      const data = await this.request('/github-provider/repositories');
      console.log('API Client: Got repositories count:', data?.length);
      return data;
    } catch (error) {
      console.error('API Client: Failed to fetch repositories:', error);
      throw error;
    }
  }

  async getGitHubRepositoryDetails(owner, repo) {
    return this.request(`/github-provider/repositories/${owner}/${repo}`)
  }

  async getGitHubRepositoryBranches(owner, repo) {
    return this.request(`/github-provider/repositories/${owner}/${repo}/branches`)
  }

  async getGitHubRepositoryFile(owner, repo, path, ref = null) {
    let url = `/github-provider/repositories/${owner}/${repo}/file/${path}`
    if (ref) url += `?ref=${ref}`
    return this.request(url)
  }

  // GitHub connection management
  async connectGitHub(accessToken, refreshToken = null, expiresAt = null) {
    return this.request('/github-provider/connect', {
      method: 'POST',
      body: JSON.stringify({ accessToken, refreshToken, expiresAt })
    })
  }

  async disconnectGitHub() {
    return this.request('/github-provider/disconnect', {
      method: 'POST'
    })
  }

  async getGitHubConnectionStatus() {
    console.log('API Client: Checking GitHub connection status...');
    try {
      const data = await this.request('/github-provider/status');
      console.log('API Client: Connection status:', data);
      return data;
    } catch (error) {
      console.error('API Client: Failed to check connection:', error);
      throw error;
    }
  }

  // GitHub webhooks
  async getGitHubWebhooks(owner, repo) {
    return this.request(`/github-provider/repositories/${owner}/${repo}/webhooks`)
  }

  async createGitHubDeploymentWebhook(owner, repo) {
    return this.request(`/github-provider/repositories/${owner}/${repo}/webhooks/deployment`, {
      method: 'POST'
    })
  }

  // Configure repository for deployments
  async configureRepository(projectId, provider, repoDetails) {
    return this.request(`/deployments/repository/${projectId}`, {
      method: 'POST',
      body: JSON.stringify({ provider, repoDetails })
    })
  }

  // Setup webhook for auto-deployments
  async setupDeploymentWebhook(projectId, owner, repo) {
    return this.request(`/deployments/webhooks/${projectId}/setup`, {
      method: 'POST',
      body: JSON.stringify({ owner, repo })
    })
  }

  // Get deployment configuration
  async getDeploymentConfig(projectId) {
    return this.request(`/deployments/config/${projectId}`)
  }

  // Update deployment settings
  async updateDeploymentSettings(projectId, settings) {
    return this.request(`/deployments/settings/${projectId}`, {
      method: 'PATCH',
      body: JSON.stringify(settings)
    })
  }
}

const apiClient = new APIClient()
export default apiClient

