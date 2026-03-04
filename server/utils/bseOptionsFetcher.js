const puppeteer = require('puppeteer');
const db = require('./db');

const BSE_DERIV_URL = 'https://www.bseindia.com/stock-share-price/future-options/derivatives/1/';
const BSE_API_BASE = 'https://api.bseindia.com';
const SENSEX_SCRIP_CD = '1';
const STRIKE_OFFSET = 3500;

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

async function fetchSensexOptionChain() {
    let browser;
    try {
        console.log('[BSE Options] Launching browser...');
        browser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-http2']
        });

        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        console.log('[BSE Options] Establishing BSE session...');
        try {
            await page.goto(BSE_DERIV_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
        } catch (e) { console.log('Nav partial:', e.message); }
        await new Promise(r => setTimeout(r, 3000));

        const spotData = await page.evaluate(async (base, scrip) => {
            try {
                const res = await fetch(`${base}/BseIndiaAPI/api/getScripHeaderData/w?Debtflag=&scripcode=${scrip}&seriesid=`);
                return await res.json();
            } catch (e) { return { error: e.message }; }
        }, BSE_API_BASE, SENSEX_SCRIP_CD);

        const spot = parseBseNumber(spotData?.CurrRate?.LTP) || 0;

        const activeExpiriesData = await page.evaluate(async (base, scrip) => {
            try {
                const res = await fetch(`${base}/BseIndiaAPI/api/ddlExpiry_New/w?scrip_cd=${scrip}`);
                const json = await res.json();
                return json.Table1 ? json.Table1.map(t => t.ExpiryDate) : [];
            } catch (e) { return []; }
        }, BSE_API_BASE, SENSEX_SCRIP_CD);

        const candidateDates = activeExpiriesData.length > 0 ? activeExpiriesData.slice(0, 4) : getUpcomingFridays(4).map(formatBSEDate);
        const targetExpiries = [];

        for (const expiry of candidateDates) {
            if (targetExpiries.length >= 2) break;

            const chainData = await page.evaluate(async (base, scrip, exp) => {
                try {
                    const res = await fetch(`${base}/BseIndiaAPI/api/DerivOptionChain_IV/w?Expiry=${encodeURIComponent(exp)}&scrip_cd=${scrip}&strprice=0`);
                    const json = await res.json();
                    if (json && json.Table && json.Table.length > 0) return json;
                    return null;
                } catch (e) { return null; }
            }, BSE_API_BASE, SENSEX_SCRIP_CD, expiry);

            if (chainData && chainData.Table && chainData.Table.length > 0) {
                targetExpiries.push({ expiry, data: chainData.Table });
            }
        }

        return { spot, allExpiries: targetExpiries };

    } finally {
        if (browser) await browser.close();
    }
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

    const ceStrike = Math.ceil((referencePrice + STRIKE_OFFSET) / 100) * 100;
    const peStrike = Math.ceil((referencePrice - STRIKE_OFFSET) / 100) * 100;

    const expiries = raw.allExpiries.map(({ expiry, data }) => {
        const ceRow = data.find(d => parseBseNumber(d.Strike_Price) === ceStrike);
        const peRow = data.find(d => parseBseNumber(d.Strike_Price) === peStrike);

        return {
            expiry,
            ce: extractBseOptionFields(ceRow, ceStrike, 'CE'),
            pe: extractBseOptionFields(peRow, peStrike, 'PE')
        };
    });

    return {
        symbol: 'SENSEX',
        label: 'SENSEX',
        spot,
        anchorPrice,
        timestamp: new Date().toISOString(),
        ceStrike,
        peStrike,
        strikeOffset: STRIKE_OFFSET,
        expiryDay: 'Friday',
        expiries
    };
}

module.exports = { getSensexOptionsTrackerData };
