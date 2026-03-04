const express = require('express');
const router = express.Router();
const { getOptionsTrackerData } = require('../utils/nseOptionsFetcher');
const { getSensexOptionsTrackerData } = require('../utils/bseOptionsFetcher');
const log = require('../utils/logger');
const fs = require('fs');
const path = require('path');

const CACHE_FILE = path.join(__dirname, '..', 'optionsCache.json');

function loadCacheMap() {
    try {
        if (fs.existsSync(CACHE_FILE)) {
            return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
        }
    } catch (e) {
        log.info('[Cache] Failed to load persistent cache: ' + e.message);
    }
    return {};
}

function saveCacheMap(cm) {
    try {
        fs.writeFileSync(CACHE_FILE, JSON.stringify(cm));
    } catch (e) {
        log.info('[Cache] Failed to save persistent cache: ' + e.message);
    }
}

// Per-symbol cache to avoid hammering exchanges on every request
let cacheMap = loadCacheMap();  // { NIFTY: { data, timestamp }, SENSEX: { data, timestamp } }
const CACHE_DURATION = 5 * 60 * 1000; // 5 minute cache
const VALID_SYMBOLS = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY', 'SENSEX'];
let prefetchRunning = false;

// On boot, discard any cache entries older than 12 hours (stale from previous day)
const STALE_THRESHOLD = 12 * 60 * 60 * 1000;
(function purgeStaleCacheOnBoot() {
    const now = Date.now();
    let purged = false;
    for (const sym of Object.keys(cacheMap)) {
        if (cacheMap[sym] && (now - cacheMap[sym].timestamp > STALE_THRESHOLD)) {
            log.info(`[Cache] Purging stale ${sym} cache from boot (age: ${Math.round((now - cacheMap[sym].timestamp) / 60000)}m)`);
            delete cacheMap[sym];
            purged = true;
        }
    }
    if (purged) saveCacheMap(cacheMap);
})();

// Helper: parse expiry date strings like "06-Mar-2026" or "05 Mar 2026" into Date
function parseExpiryDate(dateStr) {
    if (!dateStr) return null;
    const months = { 'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'May': 4, 'Jun': 5, 'Jul': 6, 'Aug': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11 };
    let parts = dateStr.split('-');
    if (parts.length !== 3) parts = dateStr.split(' ');
    if (parts.length !== 3) return null;
    const d = new Date(parseInt(parts[2]), months[parts[1]], parseInt(parts[0], 10));
    d.setHours(23, 59, 59); // consider expiry valid until end of that day
    return isNaN(d.getTime()) ? null : d;
}

// Filter out any expiries that have already passed
function filterPastExpiries(data) {
    if (!data || !data.expiries) return data;
    const now = new Date();
    const filtered = data.expiries.filter(exp => {
        const expDate = parseExpiryDate(exp.expiry);
        return expDate && expDate >= now;
    });
    return { ...data, expiries: filtered };
}

// Background pre-fetch: populates cache so page loads are instant
async function prefetchAll() {
    if (prefetchRunning) return;
    prefetchRunning = true;
    for (const sym of VALID_SYMBOLS) {
        try {
            log.info(`[Options Prefetch] Fetching ${sym}...`);
            const fetcher = sym === 'SENSEX' ? getSensexOptionsTrackerData : () => getOptionsTrackerData(sym);
            const data = await fetcher();
            cacheMap[sym] = { data, timestamp: Date.now() };
            saveCacheMap(cacheMap);
            log.info(`[Options Prefetch] ${sym} cached ✓`);
        } catch (err) {
            log.info(`[Options Prefetch] ${sym} failed: ${err.message}`);
        }
    }
    prefetchRunning = false;
}

// Start pre-fetch 10s after server boot, then every 5 minutes
setTimeout(() => {
    prefetchAll();
    setInterval(prefetchAll, CACHE_DURATION);
}, 10 * 1000);

// GET /api/options/chain?symbol=NIFTY|SENSEX
// Returns live option chain data with calculated CE/PE strikes
router.get('/chain', async (req, res) => {
    try {
        const symbol = (req.query.symbol || 'NIFTY').toUpperCase();

        // Validate symbol
        if (!VALID_SYMBOLS.includes(symbol)) {
            return res.status(400).json({ error: `Invalid symbol. Supported: ${VALID_SYMBOLS.join(', ')}` });
        }

        const now = Date.now();
        const forceRefresh = req.query.refresh === 'true';
        const cached = cacheMap[symbol];

        if (cached && !forceRefresh && (now - cached.timestamp < CACHE_DURATION)) {
            log.debug(`[Options API] Serving cached ${symbol} data`);
            return res.json({ ...filterPastExpiries(cached.data), cached: true });
        }

        log.info(`[Options API] Fetching fresh ${symbol} data...`);

        // Dispatch to the correct fetcher
        let data;
        if (symbol === 'SENSEX') {
            data = await getSensexOptionsTrackerData();
        } else {
            data = await getOptionsTrackerData(symbol);  // NIFTY or FINNIFTY
        }

        cacheMap[symbol] = { data, timestamp: now };
        saveCacheMap(cacheMap);

        res.json({ ...filterPastExpiries(data), cached: false });
    } catch (err) {
        const symbol = (req.query.symbol || 'NIFTY').toUpperCase();
        console.error(`[Options API] Error (${symbol}):`, err.message);

        // If we have stale cache, serve it with a warning
        const cached = cacheMap[symbol];
        if (cached) {
            return res.json({ ...filterPastExpiries(cached.data), cached: true, stale: true, error: 'Using stale data: ' + err.message });
        }

        res.status(503).json({ error: 'Failed to fetch option chain data. NSE/BSE may be blocking requests. ' + err.message });
    }
});

// --- OPTIONS TRANSACTIONS ---
const db = require('../utils/db');

// POST /api/options/transactions — Record a sell transaction
router.post('/transactions', (req, res) => {
    const { symbol, option_type, strike, expiry, lots_sold, premium, margin, exit_price, transaction_date, notes } = req.body;

    if (!symbol || !option_type || !strike || !expiry || !lots_sold || premium == null || margin == null || !transaction_date) {
        return res.status(400).json({ error: 'Missing required fields: symbol, option_type, strike, expiry, lots_sold, premium, margin, transaction_date' });
    }

    db.createOptionsTransaction(req.body, (err, id) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ id, message: 'Transaction recorded' });
    });
});

// GET /api/options/transactions?symbol=&expiry=&strike=&option_type=
router.get('/transactions', (req, res) => {
    const filters = {
        symbol: req.query.symbol,
        expiry: req.query.expiry,
        strike: req.query.strike ? parseFloat(req.query.strike) : undefined,
        option_type: req.query.option_type
    };

    db.getOptionsTransactions(filters, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// PUT /api/options/transactions/:id — Update exit price / close position
router.put('/transactions/:id', (req, res) => {
    const { exit_price, notes } = req.body;
    db.updateOptionsTransaction(req.params.id, { exit_price, notes }, (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Transaction updated' });
    });
});

// DELETE /api/options/transactions/:id
router.delete('/transactions/:id', (req, res) => {
    db.deleteOptionsTransaction(req.params.id, (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Transaction deleted' });
    });
});

// GET /api/options/algo/nifty
// Runs the python trading logic over historical/live YFinance data
router.get('/algo/nifty', (req, res) => {
    const { exec } = require('child_process');
    const scriptPath = path.join(__dirname, '..', 'utils', 'nifty_algo_engine.py');
    const mode = req.query.mode || 'live';

    log.info(`[Options Algo] Running Python Engine in ${mode} mode...`);

    // Execute the Python script
    exec(`python "${scriptPath}" ${mode}`, (error, stdout, stderr) => {
        if (error) {
            log.info(`[Options Algo] Execution Error: ${error.message}`);
            return res.status(500).json({ error: 'Failed to execute algorithmic engine', details: error.message });
        }

        if (stderr) {
            log.info(`[Options Algo] Stderr: ${stderr}`);
        }

        try {
            // Parse the JSON output printed by the python script
            const output = stdout.trim();
            // The python script might output some warning text before the JSON if yfinance complains
            // We'll extract only the final JSON line
            const lines = output.split('\n');
            const jsonStr = lines[lines.length - 1];
            const result = JSON.parse(jsonStr);

            res.json(result);
        } catch (parseError) {
            log.info(`[Options Algo] JSON Parse Error. Raw Output: ${stdout}`);
            res.status(500).json({ error: 'Failed to parse engine output', raw: stdout });
        }
    });
});

module.exports = router;
