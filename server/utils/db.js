const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// Database stored in the server root
const DB_PATH = path.join(__dirname, '..', 'database.sqlite');

// Ensure DB file exists/created
const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
        console.error('Error opening database ' + DB_PATH, err.message);
    } else {
        console.log('Connected to the SQLite database.');
        initOptionsTransactionsSchema();
        initDailyIndicesSchema();
    }
});

// --- OPTIONS TRANSACTIONS ---
function initOptionsTransactionsSchema() {
    const createTableQuery = `
    CREATE TABLE IF NOT EXISTS options_transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        symbol TEXT NOT NULL,          -- 'NIFTY' | 'SENSEX'
        option_type TEXT NOT NULL,     -- 'CE' | 'PE'
        strike REAL NOT NULL,
        expiry TEXT NOT NULL,          -- '17-Feb-2026' | '19 Feb 2026'
        lots_sold INTEGER NOT NULL,
        premium REAL NOT NULL,         -- premium collected per unit
        margin REAL NOT NULL,          -- margin paid
        exit_price REAL,              -- buy-back / exit price (null = open)
        transaction_date TEXT NOT NULL,
        status TEXT DEFAULT 'OPEN',    -- OPEN | CLOSED
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`;

    db.run(createTableQuery, (err) => {
        if (err) {
            console.error('Error creating options_transactions table:', err.message);
        } else {
            console.log('Schema synchronized: options_transactions table ready.');
            // Migration for existing data if needed (column checks)
        }
    });
}

// --- DAILY INDICES (Open Price Anchor) ---
function initDailyIndicesSchema() {
    const createTableQuery = `
    CREATE TABLE IF NOT EXISTS daily_indices (
        date TEXT NOT NULL,
        symbol TEXT NOT NULL,
        open REAL NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (date, symbol)
    )`;

    db.run(createTableQuery, (err) => {
        if (err) {
            console.error('Error creating daily_indices table:', err.message);
        } else {
            console.log('Schema synchronized: daily_indices table ready.');
        }
    });
}

db.upsertDailyIndex = (date, symbol, open, callback) => {
    const query = `
        INSERT INTO daily_indices (date, symbol, open)
        VALUES (?, ?, ?)
        ON CONFLICT(date, symbol) DO UPDATE SET open = excluded.open
    `;
    db.run(query, [date, symbol, open], (err) => callback && callback(err));
};

db.getDailyIndex = (date, symbol, callback) => {
    db.get("SELECT open FROM daily_indices WHERE date = ? AND symbol = ?", [date, symbol], (err, row) => {
        callback(err, row ? row.open : null);
    });
};

db.createOptionsTransaction = (data, callback) => {
    const query = `
        INSERT INTO options_transactions (symbol, option_type, strike, expiry, lots_sold, premium, margin, exit_price, transaction_date, status, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    db.run(query, [
        data.symbol, data.option_type, data.strike, data.expiry,
        data.lots_sold, data.premium, data.margin,
        data.exit_price || null,
        data.transaction_date,
        data.exit_price ? 'CLOSED' : 'OPEN',
        data.notes || ''
    ], function (err) {
        callback(err, this ? this.lastID : null);
    });
};

db.getOptionsTransactions = (filters, callback) => {
    let query = 'SELECT * FROM options_transactions WHERE 1=1';
    const params = [];

    if (filters.symbol) { query += ' AND symbol = ?'; params.push(filters.symbol); }
    if (filters.expiry) { query += ' AND expiry = ?'; params.push(filters.expiry); }
    if (filters.strike) { query += ' AND strike = ?'; params.push(filters.strike); }
    if (filters.option_type) { query += ' AND option_type = ?'; params.push(filters.option_type); }

    query += ' ORDER BY created_at DESC';
    db.all(query, params, (err, rows) => callback(err, rows));
};

db.updateOptionsTransaction = (id, data, callback) => {
    const query = `
        UPDATE options_transactions
        SET exit_price = ?, status = ?, notes = ?
        WHERE id = ?
    `;
    db.run(query, [
        data.exit_price,
        data.exit_price != null ? 'CLOSED' : 'OPEN',
        data.notes || '',
        id
    ], (err) => callback(err));
};

db.deleteOptionsTransaction = (id, callback) => {
    db.run("DELETE FROM options_transactions WHERE id = ?", [id], (err) => callback(err));
};

module.exports = db;
