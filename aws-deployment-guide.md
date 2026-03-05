# ZT-Options-App — AWS Deployment Guide

## Prerequisites

- AWS account (Free Tier eligible)
- Docker installed locally
- AWS CLI configured (`aws configure`)

---

## Option A: AWS App Runner (Recommended for Free Tier)

App Runner is fully managed — you push a Docker image and AWS handles the rest.

### Step 1: Build & Push Docker Image to ECR

```bash
# Create ECR repository (one-time)
aws ecr create-repository --repository-name zt-options-app --region ap-south-1

# Login to ECR
aws ecr get-login-password --region ap-south-1 | docker login --username AWS --password-stdin <ACCOUNT_ID>.dkr.ecr.ap-south-1.amazonaws.com

# Build the image
cd "d:\AI Projects\ZTA\ZT-Options-App"
docker build -t zt-options-app .

# Tag and push
docker tag zt-options-app:latest <ACCOUNT_ID>.dkr.ecr.ap-south-1.amazonaws.com/zt-options-app:latest
docker push <ACCOUNT_ID>.dkr.ecr.ap-south-1.amazonaws.com/zt-options-app:latest
```

> Replace `<ACCOUNT_ID>` with your 12-digit AWS account ID.

### Step 2: Create App Runner Service

1. Go to **AWS Console → App Runner → Create Service**
2. Source: **Container registry → Amazon ECR** → select `zt-options-app:latest`
3. Settings:
   - **Port**: `5001`
   - **CPU**: 1 vCPU
   - **Memory**: 2 GB
   - **Environment variables**: `NODE_ENV=production`, `PORT=5001`
4. Click **Create & Deploy**

### Free Tier Details
- First 12 months: included in free tier (limited hours)
- After that: ~$5-10/month for minimal usage

---

## Option B: AWS Lightsail Containers

Simpler, fixed pricing. Good if you want predictable costs.

### Step 1: Install Lightsail Plugin

```bash
aws lightsail create-container-service --service-name zt-options --power nano --scale 1
```

### Step 2: Push Image

```bash
aws lightsail push-container-image --service-name zt-options --label latest --image zt-options-app:latest
```

### Step 3: Deploy

```bash
aws lightsail create-container-service-deployment \
  --service-name zt-options \
  --containers '{
    "zt-options": {
      "image": ":zt-options.latest.1",
      "ports": {"5001": "HTTP"},
      "environment": {"NODE_ENV": "production", "PORT": "5001"}
    }
  }' \
  --public-endpoint '{"containerName": "zt-options", "containerPort": 5001}'
```

### Pricing
- **Nano** (512 MB, 0.25 vCPU): $7/month — 3-month free trial

---

## Local Docker Testing

```bash
# Build
docker build -t zt-options-app .

# Run
docker run -p 5001:5001 -e NODE_ENV=production zt-options-app

# Test
curl http://localhost:5001/health
curl http://localhost:5001/api/options/chain?symbol=NIFTY
# Open browser: http://localhost:5001/
```

---

## Important Notes

- **SQLite data** is ephemeral inside the container. If you need persistent transactions data, mount a volume or migrate to a managed database.
- **NSE IP blocking**: NSE may block cloud IPs. The `stock-nse-india` library handles this via rotating sessions, but results may vary.
- **SENSEX/BSE data**: BSE APIs are called directly. If BSE blocks non-browser requests, SENSEX data may be unavailable from cloud.
- **Python algo engine**: Works inside the container. `yfinance` and `pandas` are pre-installed.
