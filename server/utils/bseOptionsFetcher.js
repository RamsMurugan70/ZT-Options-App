const axios = require('axios');
const db = require('./db');

const BSE_API_BASE = 'https://api.bseindia.com';
const SENSEX_SCRIP_CD = '1';
const OTM_LEVELS = [
    { key: '2', label: '2% OTM', percent: 0.02 },
    { key: '2_5', label: '2.5% OTM', percent: 0.025 }
];

// Common headers to mimic browser requests
const BSE_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://www.bseindia.com/',
    'Origin': 'https://www.bseindia.com'
};

function getUpcomingFridays(count = 2) {
    const dates = [];
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    while (dates.length < count) {
        if (d.getDay() === 5) dates.push(new Date(d));
        d.setDate(d.getDate() + 1);
    }
    return dates;
}

function formatBSEDate(date) {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const dd = String(date.getDate()).padStart(2, '0');
    return `${dd} ${months[date.getMonth()]} ${date.getFullYear()}`;
}

function parseBseExpiryDate(dateStr) {
    if (!dateStr) return null;
    const months = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
    const parts = String(dateStr).trim().split(/\s+/);
    if (parts.length !== 3 || months[parts[1]] === undefined) return null;
    const date = new Date(Number(parts[2]), months[parts[1]], Number(parts[0]));
    date.setHours(23, 59, 59, 999);
    return Number.isNaN(date.getTime()) ? null : date;
}

function parseBseNumber(str) {
    if (!str || str === '-' || str === '') return null;
    return parseFloat(String(str).replace(/,/g, ''));
}

function extractBseOptionFields(row, strike, type) {
    if (!row) return null;
    return {
        strike,
        ltp: parseBseNumber(type === 'CE' ? row.C_Last_Trd_Price : row.Last_Trd_Price),
        change: parseBseNumber(type === 'CE' ? row.C_NetChange : row.NetChange),
        pChange: 0,
        oi: parseBseNumber(type === 'CE' ? row.C_Open_Interest : row.Open_Interest),
        oiChange: parseBseNumber(type === 'CE' ? row.C_Absolute_Change_OI : row.Absolute_Change_OI),
        volume: parseBseNumber(type === 'CE' ? row.C_Vol_Traded : row.Vol_Traded),
        iv: null,
        bid: parseBseNumber(type === 'CE' ? row.C_BidPrice : row.BidPrice),
        ask: parseBseNumber(type === 'CE' ? row.C_OfferPrice : row.OfferPrice),
        bidQty: parseBseNumber(type === 'CE' ? row.C_BIdQty : row.BIdQty),
        askQty: parseBseNumber(type === 'CE' ? row.C_OfferQty : row.OfferQty)
    };
}

function getAvailableStrikes(dataRows) {
    return [...new Set(dataRows.map(d => parseBseNumber(d.Strike_Price)).filter(n => Number.isFinite(n)))].sort((a, b) => a - b);
}

function getOtmStrike(strikes, referencePrice, percent, type) {
    if (!strikes.length || !referencePrice) return null;
    const target = type === 'CE'
        ? referencePrice * (1 + percent)
        : referencePrice * (1 - percent);

    if (type === 'CE') {
        return strikes.find(strike => strike >= target) || strikes[strikes.length - 1];
    }

    for (let i = strikes.length - 1; i >= 0; i -= 1) {
        if (strikes[i] <= target) return strikes[i];
    }
    return strikes[0];
}

/**
 * Fetch SENSEX option chain data using direct BSE API calls (no browser needed).
 */
async function fetchSensexOptionChain() {
    console.log('[BSE Options] Fetching SENSEX data via direct API calls...');

    // 1. Get spot price
    const spotRes = await axios.get(
        `${BSE_API_BASE}/BseIndiaAPI/api/getScripHeaderData/w?Debtflag=&scripcode=${SENSEX_SCRIP_CD}&seriesid=`,
        { headers: BSE_HEADERS, timeout: 15000 }
    );
    const spot = parseBseNumber(spotRes.data?.CurrRate?.LTP) || 0;
    console.log(`[BSE Options] SENSEX spot: ${spot}`);

    // 2. Get active expiry dates
    const expiryRes = await axios.get(
        `${BSE_API_BASE}/BseIndiaAPI/api/ddlExpiry_New/w?scrip_cd=${SENSEX_SCRIP_CD}`,
        { headers: BSE_HEADERS, timeout: 15000 }
    );
    const activeExpiries = expiryRes.data?.Table1
        ? expiryRes.data.Table1.map(t => t.ExpiryDate)
        : [];

    const now = new Date();
    const futureExpiries = activeExpiries.filter(expiry => {
        const expiryDate = parseBseExpiryDate(expiry);
        return expiryDate && expiryDate >= now;
    });

    const candidateDates = futureExpiries.length > 0
        ? futureExpiries.slice(0, 4)
        : getUpcomingFridays(4).map(formatBSEDate);

    // 3. Fetch option chain for each expiry
    const targetExpiries = [];
    for (const expiry of candidateDates) {
        if (targetExpiries.length >= 2) break;

        try {
            const chainRes = await axios.get(
                `${BSE_API_BASE}/BseIndiaAPI/api/DerivOptionChain_IV/w?Expiry=${encodeURIComponent(expiry)}&scrip_cd=${SENSEX_SCRIP_CD}&strprice=0`,
                { headers: BSE_HEADERS, timeout: 15000 }
            );

            if (chainRes.data && chainRes.data.Table && chainRes.data.Table.length > 0) {
                targetExpiries.push({ expiry, data: chainRes.data.Table });
                console.log(`[BSE Options] Fetched chain for expiry: ${expiry} (${chainRes.data.Table.length} rows)`);
            }
        } catch (err) {
            console.error(`[BSE Options] Failed to fetch chain for ${expiry}: ${err.message}`);
        }
    }

    return { spot, allExpiries: targetExpiries };
}

async function getAnchorPrice() {
    const symbol = 'SENSEX';
    const yahooSymbol = '^BSESN';
    const today = new Date().toISOString().split('T')[0];

    return new Promise((resolve) => {
        db.getDailyIndex(today, symbol, async (err, openPrice) => {
            if (openPrice) {
                resolve(openPrice);
            } else {
                try {
                    const yahooFinance = require('yahoo-finance2').default;
                    const quote = await yahooFinance.quote(yahooSymbol);
                    if (quote && quote.regularMarketOpen) {
                        const open = quote.regularMarketOpen;
                        db.upsertDailyIndex(today, symbol, open);
                        resolve(open);
                    } else {
                        resolve(null);
                    }
                } catch (e) {
                    console.error(`[BSE Anchor] Error fetching ${symbol}:`, e.message);
                    resolve(null);
                }
            }
        });
    });
}

async function getSensexOptionsTrackerData() {
    const raw = await fetchSensexOptionChain();
    if (!raw.spot || raw.allExpiries.length === 0) throw new Error('No SENSEX option chain data available');

    const spot = raw.spot;
    const anchorPrice = await getAnchorPrice();
    const referencePrice = anchorPrice || spot;

    const expiries = raw.allExpiries.map(({ expiry, data }) => {
        const strikes = getAvailableStrikes(data);
        const options = OTM_LEVELS.map(level => {
            const ceStrike = getOtmStrike(strikes, referencePrice, level.percent, 'CE');
            const peStrike = getOtmStrike(strikes, referencePrice, level.percent, 'PE');
            const ceRow = data.find(d => parseBseNumber(d.Strike_Price) === ceStrike);
            const peRow = data.find(d => parseBseNumber(d.Strike_Price) === peStrike);

            return {
                key: level.key,
                label: level.label,
                percent: level.percent,
                ceStrike,
                peStrike,
                ce: extractBseOptionFields(ceRow, ceStrike, 'CE'),
                pe: extractBseOptionFields(peRow, peStrike, 'PE')
            };
        });

        return {
            expiry,
            options
        };
    });

    return {
        symbol: 'SENSEX',
        label: 'SENSEX',
        spot,
        anchorPrice,
        timestamp: new Date().toISOString(),
        otmLevels: OTM_LEVELS,
        expiryDay: 'Friday',
        expiries
    };
}

module.exports = { getSensexOptionsTrackerData };
