const db = require('./db');
const { NseIndia } = require('stock-nse-india');
const nseIndia = new NseIndia();

// Per-symbol configuration
const SYMBOL_CONFIG = {
    NIFTY: { strikeOffset: 1000, expiryDay: 4, label: 'NIFTY 50', yahooSymbol: '^NSEI' },
    BANKNIFTY: { strikeOffset: 2500, expiryDay: 3, label: 'BANKNIFTY', yahooSymbol: '^NSEBANK' },
    FINNIFTY: { strikeOffset: 1200, expiryDay: 2, label: 'FINNIFTY', apiSymbol: 'FINNIFTY', yahooSymbol: 'NIFTY_FIN_SERVICE.NS' },
    SENSEX: { strikeOffset: 3500, expiryDay: 5, label: 'SENSEX', yahooSymbol: '^BSESN' },
    MIDCPNIFTY: { strikeOffset: 600, expiryDay: 1, label: 'MIDCAP NIFTY', yahooSymbol: '^NSEMDCP50' }
};
const VALID_SYMBOLS = Object.keys(SYMBOL_CONFIG);

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

/**
 * Fetch option chain data using the stock-nse-india API (no browser needed).
 */
async function fetchOptionChain(symbol = 'NIFTY') {
    const upperSymbol = symbol.toUpperCase();
    const config = SYMBOL_CONFIG[upperSymbol] || SYMBOL_CONFIG.NIFTY;
    const apiSymbol = config.apiSymbol || upperSymbol;

    console.log(`[NSE Options] Fetching ${apiSymbol} via stock-nse-india API...`);

    const apiData = await nseIndia.getIndexOptionChain(apiSymbol);

    if (!apiData || !apiData.records || !apiData.records.data) {
        throw new Error(`stock-nse-india returned empty or invalid data for ${apiSymbol}`);
    }

    console.log(`[NSE Options] Successfully fetched ${apiSymbol} data. Records: ${apiData.records.data.length}`);

    const expiryDates = (apiData.records && apiData.records.expiryDates) ? apiData.records.expiryDates : [];

    return { data: apiData, expiryDates };
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

    const apiData = raw.data;
    const spot = apiData.records.underlyingValue || (apiData.records.data && apiData.records.data[0] ? (apiData.records.data[0].PE || apiData.records.data[0].CE).underlyingValue : 0);

    const anchorPrice = await getAnchorPrice(upperSymbol);
    const referencePrice = anchorPrice || spot;

    const ceStrike = Math.ceil((referencePrice + config.strikeOffset) / 100) * 100;
    const peStrike = Math.ceil((referencePrice - config.strikeOffset) / 100) * 100;

    let targetExpiries = getTargetExpiries(raw.expiryDates, upperSymbol);

    const expiries = targetExpiries.map(expiry => {
        // Filter data rows by expiry date
        const dataRows = apiData.records.data.filter(d => {
            if (d.expiryDate && d.expiryDate === expiry) return true;
            if (d.CE && d.CE.expiryDate === expiry) return true;
            if (d.PE && d.PE.expiryDate === expiry) return true;
            return false;
        });

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
