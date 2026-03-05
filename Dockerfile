# --- Stage 1: Build React Frontend ---
FROM node:20-alpine AS frontend-builder

WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# --- Stage 2: Production Server ---
FROM node:20-alpine

# Install Python3 and pip for the algo engine, plus build tools for native modules (sqlite3)
RUN apk add --no-cache python3 py3-pip build-base \
    && pip3 install --break-system-packages yfinance pandas \
    && apk del build-base

ENV NODE_ENV=production

WORKDIR /app

# Install server dependencies
COPY server/package*.json ./
RUN npm ci --omit=dev

# Copy server code
COPY server/ ./

# Copy frontend build from stage 1 into server/public for static serving
COPY --from=frontend-builder /app/client/dist ./public

EXPOSE 5001
CMD ["node", "server.js"]
