FROM ghcr.io/puppeteer/puppeteer:21.0.0

# Skip Chromium download for puppeteer as we are using the installed chrome
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable \
    NODE_ENV=production

# Install Python for the algo engine
USER root
RUN apt-get update && apt-get install -y python3 python3-pip --no-install-recommends \
    && pip3 install --break-system-packages yfinance \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

# --- Build the React frontend ---
COPY client/package*.json ./client/
RUN cd client && npm ci

COPY client/ ./client/
RUN cd client && npm run build

# --- Setup the backend ---
COPY server/package*.json ./server/
RUN cd server && npm ci --omit=dev

COPY server/ ./server/

# Copy frontend build into server/public for static serving
RUN cp -r client/dist server/public

WORKDIR /usr/src/app/server

EXPOSE 5001
CMD [ "node", "server.js" ]
