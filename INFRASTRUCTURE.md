# MSD Project: Self-Hosted PaaS Infrastructure

This document describes the extended PaaS infrastructure for the MSD Project, including Docker-based deployments, distributed worker nodes, and job queue management.

## Overview

The MSD Project has been extended with a fully self-hosted PaaS infrastructure consisting of:

1. **Docker Execution Engine** - Dynamic Dockerfile generation and Docker-based builds
2. **Job Queue System** - Redis-backed job queue with BullMQ
3. **Distributed Workers** - Stateless runner agents that execute jobs
4. **Node Management** - Health monitoring and capacity tracking
5. **Port Management** - Dynamic port allocation for containers
6. **Cleanup System** - Automatic resource cleanup and maintenance

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Frontend Dashboard                     │
│                   (Next.js Port 5000)                     │
└────────────────────────┬────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────┐
│                   Backend Server (Port 3000)             │
│  ┌──────────────────────────────────────────────────┐  │
│  │        API Routes & Request Handlers              │  │
│  │  - /api/deployments                              │  │
│  │  - /api/jobs                                      │  │
│  │  - /api/nodes                                     │  │
│  │  - /api/ports                                     │  │
│  └──────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────┐  │
│  │              Service Layer                        │  │
│  │  - buildService (Docker execution)                │  │
│  │  - jobQueueService (Redis)                        │  │
│  │  - jobSchedulerService (Job distribution)         │  │
│  │  - nodeManagementService (Health/capacity)        │  │
│  │  - portManagementService (Port routing)           │  │
│  │  - cleanupService (Resource cleanup)              │  │
│  │  - logService (Logging & Docker logs)             │  │
│  └──────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────┐  │
│  │           Data Layer                              │  │
│  │  - MongoDB (deployments, builds, nodes, ports)    │  │
│  │  - Redis (job queue, cache)                       │  │
│  └──────────────────────────────────────────────────┘  │
└────────────────┬──────────────────────────────────────┘
                 │ (Job Queue)
     ┌───────────┴───────────┬───────────┬────────────┐
     │                       │           │            │
┌────▼─────┐ ┌──────────┐ ┌──▼──────┐ ┌─▼──────────┐
│  Worker  │ │  Worker  │ │ Worker  │ │  Worker    │
│  Node 1  │ │  Node 2  │ │ Node 3  │ │  Node N    │
│ (GCP VM) │ │ (GCP VM) │ │(GCP VM) │ │ (GCP VM)   │
│          │ │          │ │         │ │            │
│ ┌──────┐ │ │ ┌──────┐ │ │┌──────┐ │ │ ┌────────┐ │
│ │Docker│ │ │ │Docker│ │ ││Docker│ │ │ │ Docker │ │
│ │  Eng │ │ │ │  Eng │ │ ││  Eng │ │ │ │  Eng   │ │
│ └──────┘ │ │ └──────┘ │ │└──────┘ │ │ └────────┘ │
│          │ │          │ │         │ │            │
│ Nginx    │ │ Nginx    │ │ Nginx   │ │  Nginx     │
│ (Proxy)  │ │ (Proxy)  │ │ (Proxy) │ │  (Proxy)   │
└────┬─────┘ └──────┬───┘ └────┬────┘ └─────┬──────┘
     │              │          │            │
     └──────────────┼──────────┼────────────┘
                    │          │
              Containers (Port Range 3001-4000)
```

## Core Services

### 1. buildService (Extended)

**Location**: `/server/services/buildService.js`

Enhanced with Docker execution capability:

```javascript
// Traditional build (keeps existing functionality)
await buildService.traditionalBuild(build, buildId);

// Or Docker-based build
build.buildConfig.useDocker = true;
await buildService.dockerBuild(build);
```

**Methods**:
- `processBuild()` - Routes to Docker or traditional build
- `dockerBuild()` - Execute build in Docker container
- `buildDockerImage()` - Build Docker image with resource limits
- `runDockerContainer()` - Run container and capture output
- `cleanupDockerResources()` - Clean up Docker images

### 2. dockerfileGenerator

**Location**: `/server/services/dockerfileGenerator.js`

Dynamically generates Dockerfiles based on project type:

```javascript
const dockerfile = await dockerfileGenerator.generateDockerfile(
    workspaceDir,
    buildConfig
);
```

**Supported Project Types**:
- Next.js
- React (Vite/CRA)
- Vue
- Static HTML
- Node.js
- Python

**Features**:
- Multi-stage builds for smaller images
- Resource limits (memory, CPU)
- Health checks
- Environment variable support
- Optimized dependency installation

### 3. jobQueueService

**Location**: `/server/services/jobQueueService.js`

Redis-backed job queue using BullMQ:

```javascript
// Initialize
await jobQueueService.initialize();

// Queue a deployment
const job = await jobQueueService.queueDeployment(deploymentId, options);

// Wait for completion
const result = await jobQueueService.waitForJobCompletion(jobId, timeout);
```

**Features**:
- Automatic retries (3 attempts)
- Job persistence
- Progress tracking
- Job lifecycle management
- Queue statistics

### 4. jobSchedulerService

**Location**: `/server/services/jobSchedulerService.js`

Distributes jobs to available worker nodes:

```javascript
// Start scheduler
await jobSchedulerService.startScheduler();

// Scheduler continuously:
// 1. Polls for pending jobs
// 2. Selects best available node (least loaded)
// 3. Assigns job to node
// 4. Updates node capacity
```

**Features**:
- Least-load scheduling algorithm
- Node capacity tracking
- Job timeout monitoring
- Automatic failure handling
- Graceful degradation

### 5. nodeManagementService

**Location**: `/server/services/nodeManagementService.js`

Tracks and manages distributed worker nodes:

```javascript
// Register worker node
await nodeManagementService.registerNode({
    nodeId: 'worker-1',
    hostname: 'msd-worker-1',
    region: 'us-central1-a',
    totalCapacity: { cpu: 2, memory: 2048, storage: 10240 }
});

// Update heartbeat with metrics
await nodeManagementService.updateNodeHeartbeat(nodeId, {
    cpuUsage: 45,
    memoryUsage: 60,
    diskUsage: 30,
    activeContainers: 2
});

// Get available nodes
const available = await nodeManagementService.getAvailableNodes();
```

**Features**:
- Node registration and discovery
- Health checking (30-second heartbeat timeout)
- Capacity tracking
- Error recording and tracking
- Node status transitions (active → inactive → failed)

### 6. portManagementService

**Location**: `/server/services/portManagementService.js`

Allocates and manages container port mappings:

```javascript
// Allocate port for deployment
const mapping = await portManagementService.allocatePort(deploymentId, {
    preferredPort: 3001
});

// Get port for deployment
const mapping = await portManagementService.getPortMapping(deploymentId);

// Release port
await portManagementService.releasePort(deploymentId);

// Get nginx config
const config = await portManagementService.generateNginxConfig(
    nodeIp,
    mappings
);
```

**Features**:
- Port range management (3001-4000 by default)
- Nginx configuration generation
- Port tracking and cleanup
- Subdomain routing support

### 7. cleanupService

**Location**: `/server/services/cleanupService.js`

Automatic resource cleanup and maintenance:

```javascript
// Start cleanup job (every 24 hours)
cleanupService.startCleanupJob(24);

// Or run manually
const results = await cleanupService.runCleanup();
```

**Cleanup Tasks**:
- Docker container cleanup (stopped containers)
- Docker image cleanup (unused images >24 hours)
- Port mapping cleanup (released ports >7 days)
- Log cleanup (logs >30 days)
- Build cleanup (builds >30 days)
- Failed deployment cleanup (>7 days)
- Build context cleanup

## Runner Agent

**Location**: `/runner-agent/`

Standalone Node.js agent that runs on worker VMs:

```bash
# Install dependencies
cd runner-agent
npm install

# Start agent
NODE_ID=worker-1 BACKEND_URL=http://backend:3000 node index.js
```

**Components**:

### agent.js
- Main agent orchestrator
- Heartbeat management
- Job polling and execution
- System metrics collection

### nodeRegistry.js
- Node registration with backend
- Heartbeat communication
- Error reporting

### jobExecutor.js
- Repository cloning
- Dockerfile generation
- Docker image building
- Container execution
- Log streaming

### dockerManager.js
- Docker daemon communication
- Image/container lifecycle
- Log retrieval

**Workflow**:
1. Agent registers with backend
2. Sends heartbeat every 10 seconds
3. Polls for jobs every 5 seconds
4. Executes jobs concurrently (configurable)
5. Streams logs to backend
6. Reports completion/failure

## API Endpoints

### Nodes API

```
POST   /api/nodes/register              - Register worker node
POST   /api/nodes/heartbeat             - Send heartbeat with metrics
GET    /api/nodes                       - List all nodes
GET    /api/nodes/:nodeId               - Get node details
GET    /api/nodes/available             - Get available nodes
GET    /api/nodes/stats/overview        - Get node statistics
DELETE /api/nodes/:nodeId               - Delete node
POST   /api/nodes/:nodeId/error         - Report node error
```

### Jobs API

```
POST   /api/jobs/queue                  - Queue deployment job
GET    /api/jobs/pull?nodeId=xxx        - Pull jobs for node
GET    /api/jobs/:jobId                 - Get job status
GET    /api/jobs                        - List jobs with filters
GET    /api/jobs/stats/queue            - Get queue statistics
POST   /api/jobs/:jobId/progress        - Update job progress
POST   /api/jobs/:jobId/cancel          - Cancel job
```

### Ports API

```
POST   /api/ports/allocate              - Allocate port
GET    /api/ports/:deploymentId         - Get port mapping
POST   /api/ports/:deploymentId/release - Release port
GET    /api/ports                       - List all port mappings
GET    /api/ports/stats/utilization    - Get port statistics
```

## Environment Variables

```env
# Docker Execution
DOCKER_ENABLED=false                    # Enable Docker builds
DEPLOYMENT_STRATEGY=internal            # internal|provider|hybrid

# Redis (Job Queue)
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# Worker Node
NODE_ID=backend-1
REGION=us-east-1
MAX_CONCURRENT_JOBS=2
NODE_IP=127.0.0.1
BACKEND_URL=http://localhost:3000

# Port Management
PORT_RANGE_START=3001
PORT_RANGE_END=4000

# Cleanup
CLEANUP_INTERVAL_HOURS=24
```

## Data Models

### WorkerNode (MongoDB)

```javascript
{
    nodeId: String,           // unique
    hostname: String,
    region: String,
    status: 'active|inactive|failed',
    lastHeartbeat: Date,
    cpuUsage: Number,         // 0-100%
    memoryUsage: Number,      // 0-100%
    diskUsage: Number,        // 0-100%
    activeContainers: Number,
    totalCapacity: {
        cpu: Number,
        memory: Number,       // MB
        storage: Number       // MB
    },
    registeredAt: Date,
    errors: [{
        timestamp: Date,
        message: String
    }]
}
```

### PortMapping (MongoDB)

```javascript
{
    deploymentId: ObjectId,   // unique
    containerPort: Number,    // 3001-4000 range, unique
    subdomain: String,        // optional
    nodeId: String,
    status: 'active|released|failed',
    allocatedAt: Date,
    releasedAt: Date          // when released
}
```

## Deployment Flow

### Traditional Flow (Existing)
```
Deployment Request
    ↓
Build (local)
    ↓
Package Artifacts
    ↓
Deploy to Provider (Vercel/Netlify/Render)
```

### Docker Flow (New)
```
Deployment Request
    ↓
Queue Job → Redis Queue
    ↓
Scheduler assigns to Worker Node
    ↓
Worker Agent executes:
    - Clone repository
    - Generate Dockerfile
    - Build Docker image
    - Run container
    - Allocate port
    - Stream logs
    - Report completion
    ↓
Nginx routes traffic to container
```

### Hybrid Flow
```
Try Docker execution
    ↓
If fails after 3 retries → Fallback to Provider
    ↓
Deploy to external provider
```

## Performance Considerations

### Job Queue
- Default 3 retries with exponential backoff
- Job timeout: 10 minutes
- Poll interval: 5 seconds
- Heartbeat interval: 10 seconds

### Resource Limits (per container)
- Memory: 256MB
- CPU: 0.5 cores
- Build timeout: 10 minutes

### Port Range
- Total: 1000 ports (3001-4000)
- Max containers per node: 10
- Default port cleanup: >7 days idle

### Node Health
- Heartbeat timeout: 30 seconds
- Error threshold: 5 errors in 5 minutes = node marked failed
- Health check interval: 30 seconds

## Monitoring

### Scheduler Stats
```bash
GET /api/jobs/stats/queue
```

Returns:
```json
{
    "waiting": 5,
    "active": 2,
    "completed": 150,
    "failed": 3,
    "delayed": 0,
    "total": 160
}
```

### Node Stats
```bash
GET /api/nodes/stats/overview
```

Returns:
```json
{
    "totalNodes": 5,
    "activeNodes": 4,
    "inactiveNodes": 1,
    "failedNodes": 0,
    "totalCapacity": {
        "cpu": 10,
        "memory": 10240,
        "storage": 51200
    },
    "avgCpuUsage": 35.5,
    "avgMemoryUsage": 42.3,
    "totalActiveContainers": 8
}
```

## Troubleshooting

### Queue Stuck
```bash
# Check Redis connection
redis-cli ping

# View pending jobs
curl http://localhost:3000/api/jobs?status=pending
```

### Node Not Responding
```bash
# Check node status
curl http://localhost:3000/api/nodes/worker-1

# Check if heartbeat is updated
# If lastHeartbeat > 30 seconds ago, node is inactive
```

### Container Won't Stop
```bash
# Manual Docker cleanup
docker container prune -f
docker image prune -a -f

# Restart cleanup service
# Check /server/services/cleanupService.js
```

### Port Conflicts
```bash
# Check allocated ports
curl http://localhost:3000/api/ports

# Check port utilization
curl http://localhost:3000/api/ports/stats/utilization
```

## Production Deployment

See [GCP_SETUP.md](./GCP_SETUP.md) for complete GCP deployment guide including:
- Backend VM setup
- Worker VM deployment
- Database configuration
- Network setup
- SSL/TLS configuration
- Monitoring and logging
- Auto-scaling setup

## Security Considerations

1. **Worker Node Communication**
   - Use VPC internal networks
   - Implement API key authentication for worker registration

2. **Container Execution**
   - Run containers with resource limits
   - Use user namespaces
   - Disable privileged operations

3. **Data Security**
   - Use encryption for Redis (production)
   - Enable MongoDB authentication
   - Implement rate limiting on APIs

4. **Network Security**
   - Use internal VPC for inter-service communication
   - Implement firewall rules
   - Use load balancer with DDoS protection

## Scalability

### Horizontal Scaling
- Add more worker nodes dynamically
- Scheduler automatically distributes jobs
- Auto-scaling groups in GCP

### Vertical Scaling
- Increase machine sizes
- Increase resource allocation per container
- Scale up Redis/MongoDB

### Job Queue Scaling
- Redis Cluster for high availability
- Multiple scheduler instances
- Work queue partitioning

## References

- [Vercel Next.js Deployment](https://nextjs.org/docs/deployment)
- [Docker Best Practices](https://docs.docker.com/develop/dev-best-practices/)
- [BullMQ Documentation](https://docs.bullmq.io/)
- [Google Cloud Compute Engine](https://cloud.google.com/compute/docs)
