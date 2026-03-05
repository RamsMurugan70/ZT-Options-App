const axios = require('axios');
const db = require('./db');

// In-Memory map to cache the daily open price so we don't spam Yahoo
const anchorCache = {};

// Per-symbol configuration
const SYMBOL_CONFIG = {
    NIFTY: { strikeOffset: 1000, expiryDay: 4, label: 'NIFTY 50', yahooSymbol: '^NSEI', nseSymbol: 'NIFTY', growwSymbol: 'NIFTY' },
    BANKNIFTY: { strikeOffset: 2500, expiryDay: 3, label: 'BANKNIFTY', yahooSymbol: '^NSEBANK', nseSymbol: 'BANKNIFTY', growwSymbol: 'BANKNIFTY' },
    FINNIFTY: { strikeOffset: 1200, expiryDay: 2, label: 'FINNIFTY', nseSymbol: 'FINNIFTY', yahooSymbol: 'NIFTY_FIN_SERVICE.NS', growwSymbol: 'FINNIFTY' },
    MIDCPNIFTY: { strikeOffset: 600, expiryDay: 1, label: 'MIDCAP NIFTY', yahooSymbol: '^NSEMDCP50', nseSymbol: 'MIDCPNIFTY', growwSymbol: 'MIDCPNIFTY' },
    SENSEX: { strikeOffset: 3500, expiryDay: 5, label: 'SENSEX', yahooSymbol: '^BSESN' }
};
const VALID_SYMBOLS = Object.keys(SYMBOL_CONFIG);

const NSE_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://www.nseindia.com/option-chain',
    'Origin': 'https://www.nseindia.com'
};

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

// ─── Strategy 1: stock-nse-india API (works locally, blocked on cloud) ───

async function fetchFromStockNseIndia(symbol) {
    console.log(`[NSE] Fetching ${symbol} via stock-nse-india API...`);
    const { NseIndia } = require('stock-nse-india');
    const nseIndia = new NseIndia();

    const apiData = await nseIndia.getIndexOptionChain(symbol);
    if (!apiData || !apiData.records || !apiData.records.data || apiData.records.data.length === 0) {
        throw new Error('stock-nse-india returned empty data');
    }

    console.log(`[NSE] ✓ Success. Spot: ${apiData.records.underlyingValue}, Expiries: ${apiData.records.expiryDates?.length}`);
    return {
        source: 'NSE',
        intercepted: [{ expiry: null, data: apiData }],
        expiryDates: apiData.records.expiryDates || []
    };
}

// ─── Strategy 2: Direct NSE API with axios (works locally, blocked on cloud) ───

async function fetchFromNSEDirect(nseSymbol) {
    console.log(`[NSE Direct] Fetching option chain for ${nseSymbol}...`);
    let cookies = '';
    try {
        const sessionRes = await axios.get('https://www.nseindia.com/option-chain', {
            headers: NSE_HEADERS, maxRedirects: 5, timeout: 8000
        });
        const setCookies = sessionRes.headers['set-cookie'];
        if (setCookies) cookies = setCookies.map(c => c.split(';')[0]).join('; ');
    } catch (e) {
        console.log('[NSE Direct] Session cookie failed:', e.message);
    }

    const res = await axios.get(
        `https://www.nseindia.com/api/option-chain-indices?symbol=${encodeURIComponent(nseSymbol)}`,
        { headers: { ...NSE_HEADERS, Cookie: cookies }, timeout: 8000 }
    );

    const apiData = res.data;
    if (!apiData || !apiData.records || !apiData.records.data || apiData.records.data.length === 0) {
        throw new Error('NSE Direct returned empty data');
    }

    console.log(`[NSE Direct] ✓ Success. Spot: ${apiData.records.underlyingValue}`);
    return {
        source: 'NSE',
        intercepted: [{ expiry: null, data: apiData }],
        expiryDates: apiData.records.expiryDates || []
    };
}

// ─── Strategy 3: Groww API (works from cloud) ───

function formatGrowwExpiry(isoDate) {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const [y, m, d] = isoDate.split('-');
    return `${d}-${months[parseInt(m, 10) - 1]}-${y}`;
}

async function fetchFromGroww(symbol) {
    const config = SYMBOL_CONFIG[symbol];
    if (!config?.growwSymbol) throw new Error(`Groww does not support ${symbol}`);

    console.log(`[Groww] Fetching ${config.growwSymbol} option chain...`);
    const res = await axios.get(
        `https://groww.in/v1/api/option_chain_service/v1/option_chain/${config.growwSymbol}`,
        {
            headers: {
                'User-Agent': NSE_HEADERS['User-Agent'],
                'Accept': 'application/json',
                'X-App-Id': 'growwWeb'
            },
            timeout: 10000
        }
    );

    const oc = res.data?.optionChain;
    const chains = oc?.optionChains;
    if (!chains || chains.length === 0) throw new Error('Groww returned empty option chain');

    const expiryDto = oc.expiryDetailsDto || {};
    const expiryDatesISO = expiryDto.expiryDates || [];
    const expiryDatesNSE = expiryDatesISO.map(formatGrowwExpiry);
    const currentExpiryISO = expiryDto.currentExpiry;
    const currentExpiryNSE = currentExpiryISO ? formatGrowwExpiry(currentExpiryISO) : (expiryDatesNSE[0] || 'Unknown');

    // Build NSE-compatible records from Groww data
    const nseFormatData = chains.map(row => {
        const strike = (row.strikePrice || row.callOption?.strikePrice || row.putOption?.strikePrice) / 100;
        const result = { strikePrice: strike, expiryDate: currentExpiryNSE };
        if (row.callOption) {
            result.CE = {
                strikePrice: strike,
                expiryDate: currentExpiryNSE,
                lastPrice: row.callOption.ltp,
                change: row.callOption.dayChange || 0,
                pChange: row.callOption.dayChangePerc || 0,
                openInterest: row.callOption.openInterest || 0,
                changeinOpenInterest: (row.callOption.openInterest || 0) - (row.callOption.prevOpenInterest || 0),
                totalTradedVolume: row.callOption.volume || 0,
                impliedVolatility: null,
                buyPrice1: 0, sellPrice1: 0,
                buyQuantity1: row.callOption.totalBuyQty || 0,
                sellQuantity1: row.callOption.totalSellQty || 0,
                underlyingValue: 0
            };
        }
        if (row.putOption) {
            result.PE = {
                strikePrice: strike,
                expiryDate: currentExpiryNSE,
                lastPrice: row.putOption.ltp,
                change: row.putOption.dayChange || 0,
                pChange: row.putOption.dayChangePerc || 0,
                openInterest: row.putOption.openInterest || 0,
                changeinOpenInterest: (row.putOption.openInterest || 0) - (row.putOption.prevOpenInterest || 0),
                totalTradedVolume: row.putOption.volume || 0,
                impliedVolatility: null,
                buyPrice1: 0, sellPrice1: 0,
                buyQuantity1: row.putOption.totalBuyQty || 0,
                sellQuantity1: row.putOption.totalSellQty || 0,
                underlyingValue: 0
            };
        }
        return result;
    });

    console.log(`[Groww] ✓ Success. Strikes: ${chains.length}, Current expiry: ${currentExpiryNSE}, Total expiries: ${expiryDatesNSE.length}`);

    return {
        source: 'Groww',
        intercepted: [{
            expiry: null,
            data: {
                records: {
                    expiryDates: expiryDatesNSE,
                    underlyingValue: 0,  // Will be filled by spot price fetch
                    data: nseFormatData
                }
            }
        }],
        expiryDates: expiryDatesNSE
    };
}

// ─── Spot Price via Yahoo v8 Chart API (works from cloud) ───

async function getSpotFromYahooV8(symbol) {
    const config = SYMBOL_CONFIG[symbol];
    if (!config?.yahooSymbol) return null;

    try {
        const res = await axios.get(
            `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(config.yahooSymbol)}?interval=1d&range=1d`,
            { headers: { 'User-Agent': NSE_HEADERS['User-Agent'] }, timeout: 8000 }
        );
        const meta = res.data?.chart?.result?.[0]?.meta;
        if (meta?.regularMarketPrice) {
            console.log(`[Yahoo v8] ✓ Spot for ${symbol}: ${meta.regularMarketPrice}`);
            return { price: meta.regularMarketPrice, open: meta.previousClose };
        }
    } catch (e) {
        console.error(`[Yahoo v8] Spot fetch failed for ${symbol}:`, e.message);
    }
    return null;
}

// ─── Main Fetch: stock-nse-india → NSE Direct → Groww Fallback ───

async function fetchOptionChain(symbol = 'NIFTY') {
    const upperSymbol = symbol.toUpperCase();
    const config = SYMBOL_CONFIG[upperSymbol] || SYMBOL_CONFIG.NIFTY;
    const nseSymbol = config.nseSymbol || upperSymbol;
    const errors = [];

    // Strategy 1: Try stock-nse-india library
    try {
        return await fetchFromStockNseIndia(nseSymbol);
    } catch (e) {
        console.log(`[Options] stock-nse-india failed: ${e.message}`);
        errors.push(`stock-nse-india: ${e.message}`);
    }

    // Strategy 2: Try NSE Direct API with axios
    try {
        return await fetchFromNSEDirect(nseSymbol);
    } catch (e) {
        console.log(`[Options] NSE Direct failed: ${e.message}`);
        errors.push(`NSE Direct: ${e.message}`);
    }

    // Strategy 3: Try Groww API (works from cloud)
    if (config.growwSymbol) {
        try {
            const growwData = await fetchFromGroww(upperSymbol);

            // Backfill spot price from Yahoo v8 since Groww doesn't provide it
            const yahooSpot = await getSpotFromYahooV8(upperSymbol);
            if (yahooSpot && growwData.intercepted[0]?.data?.records) {
                growwData.intercepted[0].data.records.underlyingValue = yahooSpot.price;
                growwData.intercepted[0].data.records.data.forEach(row => {
                    if (row.CE) row.CE.underlyingValue = yahooSpot.price;
                    if (row.PE) row.PE.underlyingValue = yahooSpot.price;
                });
            }

            return growwData;
        } catch (e) {
            console.log(`[Options] Groww failed: ${e.message}`);
            errors.push(`Groww: ${e.message}`);
        }
    }

    throw new Error(`All strategies failed for ${upperSymbol}. ${errors.join(' | ')}`);
}

function getTargetExpiries(nseExpiries, symbol = 'NIFTY') {
    if (!nseExpiries || nseExpiries.length === 0) return [];
    return nseExpiries.slice(0, 2);
}

async function getAnchorPrice(symbol) {
    const config = SYMBOL_CONFIG[symbol] || SYMBOL_CONFIG.NIFTY;
    const today = new Date().toISOString().split('T')[0];

    // Check in-memory cache first
    if (anchorCache[symbol] && anchorCache[symbol].date === today) {
        return anchorCache[symbol].price;
    }

    // Check DB cache
    return new Promise((resolve) => {
        db.getDailyIndex(today, symbol, async (err, openPrice) => {
            if (openPrice) {
                anchorCache[symbol] = { date: today, price: openPrice };
                resolve(openPrice);
            } else {
                // Try Yahoo v8 chart API (works from cloud)
                const v8Spot = await getSpotFromYahooV8(symbol);
                if (v8Spot?.open) {
                    db.upsertDailyIndex(today, symbol, v8Spot.open);
                    anchorCache[symbol] = { date: today, price: v8Spot.open };
                    resolve(v8Spot.open);
                    return;
                }

                // Fallback to yahoo-finance2 library
                try {
                    const yahooFinance = require('yahoo-finance2').default;
                    const quote = await yahooFinance.quote(config.yahooSymbol);
                    if (quote && quote.regularMarketOpen) {
                        const open = quote.regularMarketOpen;
                        db.upsertDailyIndex(today, symbol, open);
                        anchorCache[symbol] = { date: today, price: open };
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
    const spot = firstData.records.underlyingValue || (firstData.records.data && firstData.records.data[0] ? (firstData.records.data[0].PE?.underlyingValue || firstData.records.data[0].CE?.underlyingValue || 0) : 0);

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
        const match = raw.intercepted.find(i => i.expiry === expiry) || raw.intercepted.find(i => !i.expiry);

        let dataRows = [];
        if (match && match.data && match.data.records) {
            if (!match.expiry) {
                dataRows = match.data.records.data.filter(d => {
                    if (d.expiryDate && d.expiryDate === expiry) return true;
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

    return {
        symbol: upperSymbol,
        label: config.label,
        spot,
        anchorPrice,
        timestamp: new Date().toISOString(),
        ceStrike,
        peStrike,
        strikeOffset: config.strikeOffset,
        expiryDay: weekDays[config.expiryDay] || 'Thursday',
        expiries,
        dataSource: raw.source || 'NSE'
    };
}

module.exports = { getOptionsTrackerData };
