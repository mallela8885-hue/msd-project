# MSD Project: Self-Hosted PaaS - Quick Start Guide

## 🚀 Quick Local Setup (5 minutes)

### 1. Install Dependencies

```bash
# Install server dependencies
cd server
npm install

# Install runner-agent dependencies  
cd ../runner-agent
npm install
```

### 2. Configure Environment

```bash
# Copy example env file
cp .env.example .env

# Edit .env - set these locally:
DOCKER_ENABLED=false  # Start without Docker, enable later with Docker daemon running
DEPLOYMENT_STRATEGY=internal
REDIS_HOST=localhost
REDIS_PORT=6379
MONGODB_URI=mongodb://localhost:27017/msd-project
```

### 3. Start Services

**Terminal 1 - Backend**:
```bash
cd server
npm run dev
# Runs on http://localhost:3000
```

**Terminal 2 - Redis** (if installed):
```bash
redis-server
```

**Terminal 3 - MongoDB** (if installed):
```bash
mongod
```

**Terminal 4 - Runner Agent** (optional):
```bash
cd runner-agent
BACKEND_URL=http://localhost:3000 NODE_ID=local-worker node index.js
```

### 4. Test It

```bash
# Health check
curl http://localhost:3000/health

# List nodes
curl http://localhost:3000/api/nodes

# List jobs
curl http://localhost:3000/api/jobs?status=pending
```

## 📊 Key APIs

### Node Management
```bash
# Register a worker node
curl -X POST http://localhost:3000/api/nodes/register \
  -H "Content-Type: application/json" \
  -d '{
    "nodeId": "worker-1",
    "hostname": "myhost",
    "region": "us-east-1",
    "totalCapacity": {"cpu": 4, "memory": 8192, "storage": 50000}
  }'

# Check node status
curl http://localhost:3000/api/nodes
```

### Job Queue
```bash
# Queue a deployment
curl -X POST http://localhost:3000/api/jobs/queue \
  -H "Content-Type: application/json" \
  -d '{"deploymentId": "proj-123"}'

# Get job status
curl http://localhost:3000/api/jobs/:jobId

# View queue stats
curl http://localhost:3000/api/jobs/stats/queue
```

### Port Management
```bash
# Allocate a port
curl -X POST http://localhost:3000/api/ports/allocate \
  -H "Content-Type: application/json" \
  -d '{"deploymentId": "proj-123"}'

# Get all ports in use
curl http://localhost:3000/api/ports

# View port stats
curl http://localhost:3000/api/ports/stats/utilization
```

## 🐳 Enable Docker Execution

### Prerequisites
- Docker daemon running locally
- DOCKER_ENABLED=true in .env

```bash
# Start Docker daemon
docker daemon  # or: dockerd

# Verify Docker works
docker ps

# Update .env
DOCKER_ENABLED=true

# Restart backend
# Terminate and restart: npm run dev
```

### Test Docker Build

```bash
# Create a test deployment with Docker enabled
curl -X POST http://localhost:3000/api/deployments/create \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "test-proj",
    "environmentId": "prod",
    "buildConfig": {"useDocker": true}
  }'

# Check logs
curl http://localhost:3000/api/deployments/:deploymentId/logs
```

## 🌐 GCP Production Deployment

See [GCP_SETUP.md](./GCP_SETUP.md) for complete guide. Quick summary:

```bash
# 1. Create GCP project and enable APIs
gcloud projects create msd-project
gcloud services enable compute.googleapis.com

# 2. Create backend VM
gcloud compute instances create msd-backend \
  --zone=us-central1-a \
  --machine-type=n1-standard-2 \
  --image-family=debian-11 \
  --image-project=debian-cloud

# 3. SSH and run setup script
gcloud compute ssh msd-backend --zone=us-central1-a

# 4. Create worker VMs (repeat N times)
gcloud compute instances create msd-worker-1 \
  --zone=us-central1-a \
  --machine-type=n1-standard-2 \
  --image-family=debian-11 \
  --image-project=debian-cloud

# See GCP_SETUP.md for full initialization steps
```

## 📁 Directory Structure

```
msd-project/
├── server/                          # Backend API
│   ├── services/
│   │   ├── buildService.js          # Build + Docker execution
│   │   ├── dockerfileGenerator.js   # Dockerfile generation
│   │   ├── jobQueueService.js       # Job queue (Redis)
│   │   ├── jobSchedulerService.js   # Job distribution
│   │   ├── nodeManagementService.js # Worker management
│   │   ├── portManagementService.js # Port routing
│   │   ├── cleanupService.js        # Resource cleanup
│   │   ├── logService.js            # Docker log streaming
│   │   └── deployers/               # Provider adapters
│   ├── models/
│   │   ├── WorkerNode.js            # Worker node schema
│   │   ├── PortMapping.js           # Port mapping schema
│   │   └── ...
│   ├── routes/
│   │   ├── nodes.js                 # Node management API
│   │   ├── jobs.js                  # Job queue API
│   │   ├── ports.js                 # Port API
│   │   └── ...
│   ├── index.js                     # Main server
│   └── package.json
├── runner-agent/                    # Worker node agent
│   ├── agent.js                     # Main agent
│   ├── nodeRegistry.js              # Backend communication
│   ├── jobExecutor.js               # Job execution
│   ├── dockerManager.js             # Docker wrapper
│   ├── index.js                     # Entry point
│   └── package.json
├── .env.example                     # Environment template
├── GCP_SETUP.md                     # GCP deployment guide
├── INFRASTRUCTURE.md                # Architecture docs
├── IMPLEMENTATION_SUMMARY.md        # What's been built
└── QUICKSTART.md                    # This file
```

## 🔧 Environment Variables

**Essential**:
```env
DOCKER_ENABLED=true/false
DEPLOYMENT_STRATEGY=internal/provider/hybrid
REDIS_HOST=localhost
REDIS_PORT=6379
MONGODB_URI=mongodb://localhost:27017/msd-project
```

**Optional**:
```env
NODE_ID=backend-1
REGION=us-east-1
MAX_CONCURRENT_JOBS=2
PORT_RANGE_START=3001
PORT_RANGE_END=4000
CLEANUP_INTERVAL_HOURS=24
```

See `.env.example` for all options.

## 📈 Monitoring

### Real-time Stats
```bash
# Queue status
watch -n 1 'curl -s http://localhost:3000/api/jobs/stats/queue | jq .'

# Node status
watch -n 1 'curl -s http://localhost:3000/api/nodes/stats/overview | jq .'

# Port usage
curl http://localhost:3000/api/ports/stats/utilization | jq '.'
```

### Logs
```bash
# Backend logs (Terminal 1)
npm run dev  # Shows logs directly

# Runner agent logs (Terminal 4)
# Shows logs directly with [v0] prefix

# Docker logs (if enabled)
docker logs $(docker ps -q)
```

## ✅ Health Checks

```bash
# Backend health
curl http://localhost:3000/health

# Is Docker available?
docker --version

# Is Redis running?
redis-cli ping

# Is MongoDB running?
mongosh --eval "db.adminCommand('ping')"

# Do nodes exist?
curl http://localhost:3000/api/nodes | jq '.nodes | length'

# Are there jobs?
curl http://localhost:3000/api/jobs | jq '.count'
```

## 🚨 Troubleshooting

### Backend won't start
```bash
# Check if port 3000 is in use
lsof -i :3000

# Check if MongoDB is running
curl http://localhost:27017

# Check logs in terminal output
```

### No Redis connection
```bash
# Check Redis is running
redis-cli ping  # Should return PONG

# Check Redis config
ps aux | grep redis-server

# Start Redis
redis-server
```

### Docker build fails
```bash
# Make sure Docker daemon is running
docker ps

# Enable DOCKER_ENABLED=true in .env

# Check Docker logs
docker logs <container-id>
```

### Worker won't connect
```bash
# Check backend URL in runner-agent .env
echo $BACKEND_URL

# Test connectivity
curl http://localhost:3000/api/nodes

# Check agent logs in runner-agent terminal
# Should show "Node registered successfully"
```

## 📚 Documentation

- **[INFRASTRUCTURE.md](./INFRASTRUCTURE.md)** - Architecture, APIs, services
- **[GCP_SETUP.md](./GCP_SETUP.md)** - Production GCP deployment
- **[IMPLEMENTATION_SUMMARY.md](./IMPLEMENTATION_SUMMARY.md)** - What's been built
- **Code Comments** - Detailed comments in each service file

## 🎯 Next Steps

1. **Local Testing**: Get local setup working
2. **Docker**: Enable Docker and test builds
3. **Worker Nodes**: Deploy runner-agent
4. **Production**: Use GCP_SETUP.md guide
5. **Monitoring**: Set up metrics and logging

## 📞 Support

- Check the troubleshooting sections in INFRASTRUCTURE.md
- Review GCP_SETUP.md for deployment issues
- Check service source code for detailed documentation
- Look at logs with [v0] prefix for debug info

## 📝 Quick Reference

| Task | Command |
|------|---------|
| Start backend | `cd server && npm run dev` |
| Start Redis | `redis-server` |
| Start MongoDB | `mongod` |
| Start agent | `cd runner-agent && node index.js` |
| Register node | `curl -X POST http://localhost:3000/api/nodes/register ...` |
| Queue job | `curl -X POST http://localhost:3000/api/jobs/queue ...` |
| Check stats | `curl http://localhost:3000/api/jobs/stats/queue` |
| View ports | `curl http://localhost:3000/api/ports` |
| GCP deploy | See GCP_SETUP.md |

---

**Ready to deploy?** Start with local testing, then follow GCP_SETUP.md for production.
