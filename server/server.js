const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const log = require('./utils/logger');
const optionsRoutes = require('./routes/optionsRoutes');

// Catch any unhandled errors from Puppeteer closing sequence
process.on('uncaughtException', (err) => {
    log.info(`[Uncaught Exception] ${err.message}`);
});

process.on('unhandledRejection', (reason, promise) => {
    log.info(`[Unhandled Rejection] ${reason}`);
});

const app = express();
const PORT = process.env.PORT || 5001; // Default to 5001 to avoid conflict with main app 5000

// Middleware
app.use(cors());
app.use(express.json());

// API Routes
app.use('/api/options', optionsRoutes);

// Health Check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date() });
});

// Serve React frontend static files in production
const publicPath = path.join(__dirname, 'public');
if (fs.existsSync(publicPath)) {
    app.use(express.static(publicPath));

    // Catch-all: serve index.html for any non-API route (client-side routing)
    app.get('*', (req, res) => {
        res.sendFile(path.join(publicPath, 'index.html'));
    });
    log.info('[Server] Serving frontend from ./public');
}

// Start Server
app.listen(PORT, () => {
    log.info(`Server running on port ${PORT}`);

    // Ensure database exists
    const dbPath = path.join(__dirname, 'database.sqlite');
    if (!fs.existsSync(dbPath)) {
        log.info('Database file not found, creating new one...');
        const db = require('./utils/db'); // Triggers initSchema
    }
});
