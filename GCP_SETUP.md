# MSD Project: Self-Hosted PaaS on Google Cloud Platform

This guide walks through deploying the MSD Project as a fully self-hosted PaaS on Google Cloud Platform using Docker and distributed worker nodes.

## Architecture Overview

- **Backend VM**: Central deployment orchestration, job queue, database
- **Worker VMs**: Execute Docker containers, poll for jobs, stream logs
- **Redis**: Job queue and state management
- **MongoDB**: Persistent storage for deployments, builds, metrics
- **Nginx**: Reverse proxy for port routing

## Prerequisites

1. **Google Cloud Account** with billing enabled
2. **gcloud CLI** installed and authenticated
3. **Docker** installed locally (for testing)
4. **Git** and Node.js 18+
5. SSH access setup in GCP

## Step 1: GCP Project Setup

### Create a new GCP project

```bash
gcloud projects create msd-project --name="MSD PaaS Platform"
gcloud config set project msd-project
```

### Enable required APIs

```bash
gcloud services enable compute.googleapis.com
gcloud services enable cloud-build.googleapis.com
gcloud services enable container.googleapis.com
```

### Create firewall rules

```bash
# Allow SSH access
gcloud compute firewall-rules create allow-ssh \
  --allow=tcp:22 \
  --source-ranges=0.0.0.0/0

# Allow HTTP/HTTPS
gcloud compute firewall-rules create allow-http-https \
  --allow=tcp:80,tcp:443 \
  --source-ranges=0.0.0.0/0

# Allow internal communication (backend to workers)
gcloud compute firewall-rules create allow-internal \
  --allow=tcp:3000,tcp:6379,tcp:27017 \
  --source-ranges=10.0.0.0/8

# Allow container port range
gcloud compute firewall-rules create allow-containers \
  --allow=tcp:3001-4000 \
  --source-ranges=0.0.0.0/0
```

## Step 2: Create Backend VM

### 1. Create the VM instance

```bash
gcloud compute instances create msd-backend \
  --zone=us-central1-a \
  --machine-type=n1-standard-2 \
  --boot-disk-size=50GB \
  --image-family=debian-11 \
  --image-project=debian-cloud \
  --scopes=https://www.googleapis.com/auth/cloud-platform \
  --tags=backend,http-server,https-server
```

### 2. Connect to the backend VM

```bash
gcloud compute ssh msd-backend --zone=us-central1-a
```

### 3. Initialize the backend VM

```bash
# Update system
sudo apt-get update && sudo apt-get upgrade -y

# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install Docker
curl -fsSL https://get.docker.com | sudo bash
sudo usermod -aG docker $USER

# Install MongoDB
curl -fsSL https://pgp.mongodb.com/server-4.4.asc | sudo apt-key add -
echo "deb [ arch=amd64,arm64 ] https://repo.mongodb.org/apt/ubuntu focal/mongodb-org/4.4 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-4.4.list
sudo apt-get update
sudo apt-get install -y mongodb-org

# Install Redis
sudo apt-get install -y redis-server

# Install Nginx
sudo apt-get install -y nginx

# Install PM2 for process management
sudo npm install -g pm2
```

### 4. Deploy MSD Backend

```bash
# Clone repository
git clone https://github.com/mallela8885-hue/msd-project.git
cd msd-project/server

# Install dependencies
npm install

# Create .env file
cat > ../.env << EOF
NODE_ENV=production
API_URL=http://BACKEND_IP:3000
CLIENT_URL=http://BACKEND_IP:5000
MONGODB_URI=mongodb://localhost:27017/msd-project
REDIS_HOST=localhost
REDIS_PORT=6379
DOCKER_ENABLED=true
DEPLOYMENT_STRATEGY=internal
GITHUB_CLIENT_ID=your_client_id
GITHUB_CLIENT_SECRET=your_client_secret
JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
EOF

# Start MongoDB and Redis
sudo systemctl start mongodb
sudo systemctl start redis-server
sudo systemctl enable mongodb redis-server

# Start backend with PM2
pm2 start index.js --name "msd-backend"
pm2 save
pm2 startup

# Configure Nginx as reverse proxy
sudo tee /etc/nginx/sites-available/msd << EOF
server {
    listen 80;
    server_name _;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
    }

    # Container routing
    location ~ ^/app/([^/]+)/(.*)$ {
        set \$deployment_id \$1;
        set \$path \$2;
        
        # Route to container port
        proxy_pass http://localhost:3001;
        proxy_set_header Host \$host;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
    }
}
EOF

sudo ln -sf /etc/nginx/sites-available/msd /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

## Step 3: Create Worker VMs

### 1. Create worker VM instances

```bash
# Create multiple workers (adjust count as needed)
for i in {1..2}; do
  gcloud compute instances create msd-worker-$i \
    --zone=us-central1-a \
    --machine-type=n1-standard-2 \
    --boot-disk-size=100GB \
    --image-family=debian-11 \
    --image-project=debian-cloud \
    --scopes=https://www.googleapis.com/auth/cloud-platform \
    --tags=worker
done
```

### 2. Get backend VM internal IP

```bash
BACKEND_IP=$(gcloud compute instances describe msd-backend \
  --zone=us-central1-a \
  --format='get(networkInterfaces[0].networkIP)')

echo "Backend internal IP: $BACKEND_IP"
```

### 3. Initialize worker VMs

```bash
for i in {1..2}; do
  gcloud compute ssh msd-worker-$i --zone=us-central1-a << 'EOF'
# Update system
sudo apt-get update && sudo apt-get upgrade -y

# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install Docker
curl -fsSL https://get.docker.com | sudo bash
sudo usermod -aG docker $USER

# Install Nginx
sudo apt-get install -y nginx

# Install PM2
sudo npm install -g pm2

# Clone and setup runner-agent
git clone https://github.com/mallela8885-hue/msd-project.git
cd msd-project/runner-agent
npm install

# Create .env file
cat > .env << ENVEOF
BACKEND_URL=http://BACKEND_IP:3000
NODE_ID=worker-$(hostname)
REGION=us-central1
MAX_CONCURRENT_JOBS=2
ENVEOF

# Start runner agent with PM2
pm2 start index.js --name "msd-runner-agent"
pm2 save
pm2 startup

# Configure Nginx for container routing
sudo tee /etc/nginx/nginx.conf << NGINXEOF
events {
    worker_connections 1024;
}

http {
    # Load dynamic port configurations
    include /etc/nginx/container-routes/*.conf;
    
    server {
        listen 80 default_server;
        
        location /health {
            access_log off;
            return 200 "healthy\n";
            add_header Content-Type text/plain;
        }
    }
}
NGINXEOF

sudo mkdir -p /etc/nginx/container-routes
sudo chmod 755 /etc/nginx/container-routes
sudo systemctl restart nginx
EOF
done
```

## Step 4: Network Configuration

### 1. Create internal VPC (optional but recommended)

```bash
gcloud compute networks create msd-network --subnet-mode=custom
gcloud compute networks subnets create msd-subnet \
  --network=msd-network \
  --range=10.0.1.0/24 \
  --region=us-central1
```

### 2. Update firewall for internal communication

```bash
gcloud compute firewall-rules create allow-internal-backend \
  --network=msd-network \
  --allow=tcp:3000,tcp:6379,tcp:27017 \
  --source-ranges=10.0.1.0/24
```

## Step 5: Database Setup

### 1. Create persistent storage (optional)

```bash
# Create persistent disk for MongoDB data
gcloud compute disks create msd-mongodb-data \
  --size=100GB \
  --zone=us-central1-a

# Attach to backend VM
gcloud compute instances attach-disk msd-backend \
  --disk=msd-mongodb-data \
  --zone=us-central1-a
```

### 2. Initialize MongoDB with data disk

```bash
gcloud compute ssh msd-backend --zone=us-central1-a << 'EOF'
# Format and mount the disk
sudo mkfs.ext4 /dev/sdb
sudo mkdir -p /mnt/mongodb
sudo mount /dev/sdb /mnt/mongodb
sudo chown -R mongodb:mongodb /mnt/mongodb

# Update MongoDB config to use the mounted disk
sudo tee /etc/mongod.conf << MONGOEOF
storage:
  dbPath: /mnt/mongodb
  journal:
    enabled: true
systemLog:
  destination: file
  logAppendonly: true
  path: /var/log/mongodb/mongod.log
net:
  port: 27017
  bindIp: 127.0.0.1,BACKEND_IP
EOF

sudo systemctl restart mongodb
EOF
```

## Step 6: Deployment Testing

### 1. Get IPs

```bash
BACKEND_IP=$(gcloud compute instances describe msd-backend \
  --zone=us-central1-a \
  --format='get(networkInterfaces[0].accessConfigs[0].natIP)')

echo "Backend external IP: $BACKEND_IP"
```

### 2. Test backend health

```bash
curl http://$BACKEND_IP:3000/health
```

### 3. Register worker nodes

```bash
curl -X POST http://$BACKEND_IP:3000/api/nodes/register \
  -H "Content-Type: application/json" \
  -d '{
    "nodeId": "worker-1",
    "hostname": "msd-worker-1.c.msd-project.internal",
    "region": "us-central1-a",
    "totalCapacity": {
      "cpu": 2,
      "memory": 7680,
      "storage": 100
    }
  }'
```

### 4. Test deployment

```bash
curl -X POST http://$BACKEND_IP:3000/api/deployments/create \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "test-project",
    "environmentId": "production",
    "branch": "main"
  }'
```

## Step 7: Monitoring and Maintenance

### 1. Monitor worker nodes

```bash
gcloud compute instances list --filter="tags:worker"
```

### 2. View logs

```bash
# Backend logs
gcloud compute ssh msd-backend --zone=us-central1-a -- pm2 logs msd-backend

# Worker logs
gcloud compute ssh msd-worker-1 --zone=us-central1-a -- pm2 logs msd-runner-agent
```

### 3. Create snapshots for backup

```bash
gcloud compute disks snapshot msd-mongodb-data \
  --snapshot-names=msd-mongodb-backup-$(date +%Y%m%d)
```

## Step 8: Scaling

### 1. Create more worker VMs

```bash
gcloud compute instances create msd-worker-3 \
  --zone=us-central1-b \
  --machine-type=n1-standard-2 \
  --boot-disk-size=100GB \
  --image-family=debian-11 \
  --image-project=debian-cloud
  
# Run initialization script
```

### 2. Scale backend VM if needed

```bash
# Stop the instance
gcloud compute instances stop msd-backend --zone=us-central1-a

# Change machine type
gcloud compute instances set-machine-type msd-backend \
  --machine-type=n1-standard-4 \
  --zone=us-central1-a

# Start the instance
gcloud compute instances start msd-backend --zone=us-central1-a
```

## Troubleshooting

### Check Redis connection

```bash
redis-cli ping
# Should respond with PONG
```

### Check MongoDB connection

```bash
mongosh --eval "db.adminCommand('ping')"
```

### Check Docker daemon

```bash
docker ps
docker logs $(docker ps -q --filter ancestor=msd-build-*)
```

### Monitor Node Health

```bash
curl http://BACKEND_IP:3000/api/nodes
```

## Production Considerations

1. **SSL/TLS**: Set up Let's Encrypt with Certbot
2. **Monitoring**: Implement Prometheus + Grafana
3. **Logging**: Set up ELK stack or Cloud Logging
4. **Backup**: Implement automated MongoDB backups
5. **Auto-scaling**: Configure instance groups with auto-scaling policies
6. **Load Balancing**: Use GCP Cloud Load Balancer
7. **Security**: Enable VPC Service Controls, implement IAM policies
8. **Cost Optimization**: Use committed use discounts, reserved instances

## Cleanup

To remove all resources:

```bash
# Delete instances
gcloud compute instances delete msd-backend msd-worker-1 msd-worker-2 --zone=us-central1-a

# Delete disks
gcloud compute disks delete msd-mongodb-data --zone=us-central1-a

# Delete firewalls
gcloud compute firewall-rules delete allow-ssh allow-http-https allow-internal allow-containers

# Delete networks (if created)
gcloud compute networks delete msd-network
```
