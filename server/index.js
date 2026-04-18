const express = require("express")
const cors = require("cors")
const passport = require("passport")
const session = require("express-session")
require("dotenv").config()
const connectDB = require("./config/database")
const ErrorMonitoringService = require("./services/errorMonitoringService")
const errorHandler = require("./middleware/errorHandler")
const config = require("./config/env")
require("./config/passport")

// Initialize version info
const VERSION = '1.0.0';
const BUILD_DATE = new Date().toISOString();

// Routes
const authRoutes = require("./routes/auth")
const deploymentRoutes = require("./routes/deployments")
const projectRoutes = require("./routes/projects")
const databaseRoutes = require("./routes/databases")
const functionRoutes = require("./routes/functions")
const cronJobRoutes = require("./routes/cronjobs")
const domainRoutes = require("./routes/domains")
const dnsRoutes = require("./routes/dns")
const sslRoutes = require("./routes/ssl")
const edgeHandlerRoutes = require("./routes/edge-handlers")
const environmentRoutes = require("./routes/environment")
const teamRoutes = require("./routes/team")
const logRoutes = require("./routes/logs")
const buildRoutes = require("./routes/builds")
const monitoringRoutes = require("./routes/monitoring")
const securityRoutes = require("./routes/security")
const analyticsRoutes = require("./routes/analytics")
const apiTokenRoutes = require("./routes/api-tokens")
const webhookRoutes = require("./routes/webhooks")
const settingsRoutes = require("./routes/settings")
const providersRoutes = require("./routes/providers")
const dashboardRoutes = require("./routes/dashboard")
const incidentRoutes = require("./routes/incidents")
const escalationRoutes = require("./routes/escalation")
const uptimeRoutes = require("./routes/uptime")
const reportsRoutes = require("./routes/reports")
const githubProviderRoutes = require("./routes/github-provider")
const billingRoutes = require("./routes/billing")
const nodesRoutes = require("./routes/nodes")
const jobsRoutes = require("./routes/jobs")
const portsRoutes = require("./routes/ports")

const app = express()

// Middleware
// Configure CORS. Allow the Next.js frontend (port 5000) and any Replit proxy origins.
const allowedOrigins = [config.clientUrl, 'http://localhost:5000', 'http://127.0.0.1:5000']
app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (like mobile apps or curl)
      if (!origin) return callback(null, true)
      if (allowedOrigins.indexOf(origin) !== -1) {
        return callback(null, true)
      }
      // Allow any localhost/127.0.0.1 origin in development
      if (/localhost|127\.0\.0\.1/.test(origin)) {
        return callback(null, true)
      }
      // Allow Replit proxy domains (*.replit.dev, *.repl.co, *.replit.app)
      if (/\.replit\.dev$|\.repl\.co$|\.replit\.app$/.test(origin)) {
        return callback(null, true)
      }
      callback(new Error('Not allowed by CORS'))
    },
    credentials: true,
  }),
)
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// Session middleware for OAuth
app.use(
  session({
    secret: process.env.JWT_SECRET || "your-secret-key",
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false, maxAge: 1000 * 60 * 60 * 24 },
  })
)

// Passport middleware
app.use(passport.initialize())
app.use(passport.session())

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() })
})

// Version endpoint
app.get("/version", (req, res) => {
  res.json({ 
    version: VERSION,
    buildDate: BUILD_DATE,
    timestamp: new Date().toISOString()
  })
})

// Debug endpoint to check configuration
app.get("/config/check", (req, res) => {
  res.json({
    api_url: process.env.API_URL || 'not set',
    client_url: process.env.CLIENT_URL || 'not set',
    node_env: process.env.NODE_ENV || 'not set',
    github_client_id: process.env.GITHUB_CLIENT_ID ? 'set' : 'not set',
    github_client_secret: process.env.GITHUB_CLIENT_SECRET ? 'set' : 'not set',
    google_client_id: process.env.GOOGLE_CLIENT_ID ? 'set' : 'not set',
    google_client_secret: process.env.GOOGLE_CLIENT_SECRET ? 'set' : 'not set'
  })
})

// Authentication Routes
app.use("/auth", authRoutes)

// API Routes
app.use("/api/deployments", deploymentRoutes)
app.use("/api/projects", projectRoutes)
app.use("/api/databases", databaseRoutes)
app.use("/api/functions", functionRoutes)
app.use("/api/cronjobs", cronJobRoutes)
app.use("/api/domains", domainRoutes)
app.use("/api/dns", dnsRoutes)
app.use("/api/ssl", sslRoutes)
app.use("/api/edge-handlers", edgeHandlerRoutes)
app.use("/api/environment", environmentRoutes)
app.use("/api/team", teamRoutes)
app.use("/api/logs", logRoutes)
app.use("/api/builds", buildRoutes)
app.use("/api/monitoring", monitoringRoutes)
app.use("/api/security", securityRoutes)
app.use("/api/analytics", analyticsRoutes)
app.use("/api/api-tokens", apiTokenRoutes)
app.use("/api/webhooks", webhookRoutes)
app.use("/api/settings", settingsRoutes)
app.use("/api/providers", providersRoutes)
app.use("/api/dashboard", dashboardRoutes)
app.use("/api/incidents", incidentRoutes)
app.use("/api/escalation", escalationRoutes)
app.use("/api/uptime", uptimeRoutes)
app.use("/api/reports", reportsRoutes)
app.use("/api/github-provider", githubProviderRoutes)
app.use("/api/billing", billingRoutes)

// PaaS Infrastructure Routes
app.use("/api/nodes", nodesRoutes)
app.use("/api/jobs", jobsRoutes)
app.use("/api/ports", portsRoutes)

// Error handling
app.use(errorHandler)

// Prometheus metrics endpoint (with basic auth)
const monitoringService = require('./services/monitoringService')
app.get('/metrics', (req, res, next) => {
  const auth = req.headers.authorization
  if (!auth) {
    res.set('WWW-Authenticate', 'Basic')
    return res.status(401).send('Authentication required')
  }

  const [username, password] = Buffer.from(auth.split(' ')[1], 'base64')
    .toString()
    .split(':')

  if (
    username === process.env.METRICS_USERNAME &&
    password === process.env.METRICS_PASSWORD
  ) {
    return monitoringService.getMetricsHandler(req, res)
  }

  res.set('WWW-Authenticate', 'Basic')
  res.status(401).send('Invalid credentials')
})

// Initialize error monitoring
ErrorMonitoringService.init();

// Connect to database and start server
connectDB()
  .then(() => {
    app.listen(config.port, () => {
      console.log(`Server running on port ${config.port} in ${config.nodeEnv} mode`)
      console.log(`Prometheus metrics available at http://localhost:${config.port}/metrics`)
    })
  })
  .catch((error) => {
    ErrorMonitoringService.handleError(error);
    // Don't exit immediately in production, give time for reconnection
    if (process.env.NODE_ENV === 'production') {
      console.log('Attempting to continue in degraded mode...');
    } else {
      process.exit(1);
    }
  })

module.exports = app
