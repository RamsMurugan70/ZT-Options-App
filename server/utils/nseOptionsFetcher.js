const puppeteer = require('puppeteer');
const db = require('./db');
const { NseIndia } = require('stock-nse-india');
const nseIndia = new NseIndia();

const NSE_OC_URL = 'https://www.nseindia.com/option-chain';

// Per-symbol configuration
const SYMBOL_CONFIG = {
    NIFTY: { strikeOffset: 1000, expiryDay: 4, label: 'NIFTY 50', yahooSymbol: '^NSEI' },
    BANKNIFTY: { strikeOffset: 2500, expiryDay: 3, label: 'BANKNIFTY', yahooSymbol: '^NSEBANK' },
    FINNIFTY: { strikeOffset: 1200, expiryDay: 2, label: 'FINNIFTY', apiSymbol: 'FINNIFTY', yahooSymbol: 'NIFTY_FIN_SERVICE.NS' },
    SENSEX: { strikeOffset: 3500, expiryDay: 5, label: 'SENSEX', yahooSymbol: '^BSESN' },
    MIDCPNIFTY: { strikeOffset: 600, expiryDay: 1, label: 'MIDCAP NIFTY', yahooSymbol: '^NSEMDCP50' }
};
const VALID_SYMBOLS = Object.keys(SYMBOL_CONFIG);

function getUpcomingWeekdays(dayOfWeek, count = 2) {
    const dates = [];
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    while (dates.length < count) {
        if (d.getDay() === dayOfWeek) {
            dates.push(new Date(d));
        }
        d.setDate(d.getDate() + 1);
    }
    return dates;
}

function getUpcomingTuesdays(count = 2) { return getUpcomingWeekdays(2, count); }
function getUpcomingThursdays(count = 2) { return getUpcomingWeekdays(4, count); }

function getLastWeekdayOfMonth(year, month, dayOfWeek) {
    const lastDay = new Date(year, month + 1, 0);
    while (lastDay.getDay() !== dayOfWeek) {
        lastDay.setDate(lastDay.getDate() - 1);
    }
    return lastDay;
}

function getUpcomingMonthlyExpiries(dayOfWeek, count = 2) {
    const dates = [];
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    let year = now.getFullYear();
    let month = now.getMonth();

    while (dates.length < count) {
        const lastDay = getLastWeekdayOfMonth(year, month, dayOfWeek);
        if (lastDay >= now) {
            dates.push(lastDay);
        }
        month++;
        if (month > 11) { month = 0; year++; }
    }
    return dates;
}

function formatNSEDate(date) {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const dd = String(date.getDate()).padStart(2, '0');
    return `${dd}-${months[date.getMonth()]}-${date.getFullYear()}`;
}

function extractOptionFields(optObj, strike) {
    if (!optObj) return null;
    return {
        strike,
        ltp: optObj.lastPrice,
        change: optObj.change,
        pChange: optObj.pchange || optObj.pChange || 0,
        oi: optObj.openInterest,
        oiChange: optObj.changeinOpenInterest,
        volume: optObj.totalTradedVolume,
        iv: optObj.impliedVolatility,
        bid: optObj.buyPrice1 || optObj.bidprice || 0,
        ask: optObj.sellPrice1 || optObj.askPrice || 0,
        bidQty: optObj.buyQuantity1 || optObj.bidQty || 0,
        askQty: optObj.sellQuantity1 || optObj.askQty || 0
    };
}

async function fetchOptionChain(symbol = 'NIFTY') {
    const upperSymbol = symbol.toUpperCase();
    const config = SYMBOL_CONFIG[upperSymbol] || SYMBOL_CONFIG.NIFTY;
    const apiSymbol = config.apiSymbol || upperSymbol;

    let browser;
    try {
        console.log('[NSE Options] Launching browser...');
        browser = await puppeteer.launch({
            headless: 'new',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-http2',
                '--disable-blink-features=AutomationControlled'
            ]
        });

        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        const allIntercepted = [];

        page.on('response', async (response) => {
            const url = response.url();
            const urlUpper = url.toUpperCase();
            const apiSymUpper = apiSymbol.toUpperCase();

            const isChainUrl = (
                url.includes('option-chain-indices') ||
                url.includes('option-chain-v3') ||
                url.includes('/api/option-chain') ||
                url.includes('option-chain-contract-info')
            );
            let hasSymbol = false;
            try {
                const u = new URL(url);
                const sym = u.searchParams.get('symbol');
                if (sym) {
                    hasSymbol = sym.toUpperCase() === apiSymUpper;
                } else {
                    hasSymbol = urlUpper.includes(`SYMBOL=${apiSymUpper}`) || urlUpper.includes(`/${apiSymUpper}`);
                }
            } catch (e) {
                hasSymbol = (urlUpper.includes(apiSymUpper.replace(/ /g, '%20')) || urlUpper.includes(apiSymUpper));
            }

            if (urlUpper.includes('FINNIFTY')) {
                console.log(`[intercept] FINNIFTY URL: ${url}`);
            }

            if (isChainUrl && hasSymbol) {
                try {
                    const json = await response.json();
                    if (json && json.records && json.records.data) {
                        const urlObj = new URL(url);
                        const expiryParam = urlObj.searchParams.get('expiry') || null;
                        allIntercepted.push({ expiry: expiryParam, data: json });
                    }
                } catch (e) { }
            }
        });

        console.log(`[NSE Options] Navigating to ${NSE_OC_URL}...`);
        try {
            await page.goto(NSE_OC_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await new Promise(r => setTimeout(r, 2000));
        } catch (e) {
            console.error('Nav error:', e.message);
        }

        // Wait for data
        await new Promise(r => setTimeout(r, 4000));

        // Active fetch fallback logic using stock-nse-india
        if (allIntercepted.length === 0) {
            console.log(`[NSE Options] No data intercepted, attempting fallback API fetch via stock-nse-india for ${apiSymbol}...`);
            try {
                const apiData = await nseIndia.getIndexOptionChain(apiSymbol);
                if (apiData && apiData.records) {
                    console.log(`[NSE Options] Successfully fetched fallback data from stock-nse-india. API status: OK`);
                    // Push the universal data block; expiry filter is handled below
                    allIntercepted.push({ expiry: null, data: apiData });
                } else {
                    console.error('[NSE Options] stock-nse-india fallback returned empty or invalid data format.');
                }
            } catch (e) {
                console.error('[NSE Options] stock-nse-india fallback failed:', e.message);
            }
        }

        if (allIntercepted.length === 0) {
            throw new Error('Failed to intercept NSE option chain data');
        }

        // Fetch second expiry if needed
        const firstData = allIntercepted[0].data;
        const expiryDates = (firstData.records && firstData.records.expiryDates) ? firstData.records.expiryDates : [];
        const targetExpiries = getTargetExpiries(expiryDates, upperSymbol);

        const seenExpiries = new Set(allIntercepted.map(i => i.expiry).filter(e => e));

        if (targetExpiries.length > 1 && !seenExpiries.has(targetExpiries[1])) {
            console.log('[NSE Options] Fetching second expiry:', targetExpiries[1]);
            try {
                await page.evaluate(async ({ expiry, sym }) => {
                    const res = await fetch(`/api/option-chain-v3?type=Indices&symbol=${sym}&expiry=${encodeURIComponent(expiry)}`);
                    return await res.json();
                }, { expiry: targetExpiries[1], sym: upperSymbol }).then(json => {
                    if (json && json.records) {
                        allIntercepted.push({ expiry: targetExpiries[1], data: json });
                    }
                });
            } catch (e) { }
        }

        return { intercepted: allIntercepted, expiryDates };

    } finally {
        if (browser) await browser.close();
    }
}

function getTargetExpiries(nseExpiries, symbol = 'NIFTY') {
    if (!nseExpiries || nseExpiries.length === 0) return [];
    return nseExpiries.slice(0, 2);
}

async function getAnchorPrice(symbol) {
    const config = SYMBOL_CONFIG[symbol] || SYMBOL_CONFIG.NIFTY;
    const yahooSymbol = config.yahooSymbol;
    const today = new Date().toISOString().split('T')[0];

    return new Promise((resolve) => {
        db.getDailyIndex(today, symbol, async (err, openPrice) => {
            if (openPrice) {
                resolve(openPrice);
            } else {
                try {
                    console.log(`[Anchor] Fetching ${yahooSymbol} from Yahoo Finance...`);
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
                    console.error(`[Anchor] Error fetching ${symbol}:`, e.message);
                    resolve(null);
                }
            }
        });
    });
}

async function getOptionsTrackerData(symbol = 'NIFTY') {
    const upperSymbol = symbol.toUpperCase();
    const config = SYMBOL_CONFIG[upperSymbol] || SYMBOL_CONFIG.NIFTY;
    const raw = await fetchOptionChain(upperSymbol);

    if (raw.intercepted.length === 0) throw new Error(`No option chain data available for ${upperSymbol}`);

    const firstData = raw.intercepted[0].data;
    const spot = firstData.records.underlyingValue || (firstData.records.data && firstData.records.data[0] ? firstData.records.data[0].PE.underlyingValue : 0);

    const anchorPrice = await getAnchorPrice(upperSymbol);
    const referencePrice = anchorPrice || spot;

    const ceStrike = Math.ceil((referencePrice + config.strikeOffset) / 100) * 100;
    const peStrike = Math.ceil((referencePrice - config.strikeOffset) / 100) * 100;

    let targetExpiries = getTargetExpiries(raw.expiryDates, upperSymbol);
    if (targetExpiries.length === 0 && raw.intercepted.length > 0) {
        const potentialExpiries = raw.intercepted.map(i => i.expiry).filter(e => e);
        targetExpiries = [...new Set(potentialExpiries)];
    }

    const expiries = targetExpiries.map(expiry => {
        // Find matching intercepted data OR fallback to the universal 'null' expiry payload
        const match = raw.intercepted.find(i => i.expiry === expiry) || raw.intercepted.find(i => !i.expiry);

        let dataRows = [];
        if (match && match.data && match.data.records) {
            // For universal fetches, we MUST filter data rows by expiryDate or expiryDates array
            if (!match.expiry) {
                dataRows = match.data.records.data.filter(d => {
                    if (d.expiryDate && d.expiryDate === expiry) return true;
                    if (d.expiryDates) {
                        if (typeof d.expiryDates === 'string' && d.expiryDates === expiry) return true;
                        if (Array.isArray(d.expiryDates) && d.expiryDates.includes(expiry)) return true;
                    }
                    if (d.CE && d.CE.expiryDate === expiry) return true;
                    if (d.PE && d.PE.expiryDate === expiry) return true;
                    return false;
                });
            } else {
                dataRows = match.data.records.data;
            }
        }

        const ceRow = dataRows.length ? dataRows.find(d => d.strikePrice === ceStrike) : null;
        const peRow = dataRows.length ? dataRows.find(d => d.strikePrice === peStrike) : null;

        return {
            expiry,
            ce: extractOptionFields(ceRow?.CE, ceStrike),
            pe: extractOptionFields(peRow?.PE, peStrike)
        };
    });

    const weekDays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const expiryDayLabel = config.monthly
        ? `Monthly (Last ${weekDays[config.expiryDay] || 'Thursday'})`
        : (weekDays[config.expiryDay] || 'Thursday');

    return {
        symbol: upperSymbol,
        label: config.label,
        spot,
        anchorPrice,
        timestamp: new Date().toISOString(),
        ceStrike,
        peStrike,
        strikeOffset: config.strikeOffset,
        expiryDay: expiryDayLabel,
        expiries
    };
}

module.exports = { getOptionsTrackerData };

// Test script for standalone execution
if (require.main === module) {
    (async () => {
        try {
            console.log("Testing FINNIFTY Fetch...");
            const data = await getOptionsTrackerData('FINNIFTY');
            console.log("Success! Spot:", data.spot);
        } catch (e) {
            console.error("Test Error:", e);
        } finally {
            process.exit(0);
        }
    })();
}
