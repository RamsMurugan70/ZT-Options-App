const axios = require('axios');

const NSE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  Referer: 'https://www.nseindia.com/option-chain',
  Origin: 'https://www.nseindia.com'
};

const SYMBOL_CONFIG = {
  NIFTY: { expiryDay: 4, label: 'NIFTY 50', yahooSymbol: '^NSEI', nseSymbol: 'NIFTY', growwSymbol: 'NIFTY' },
  BANKNIFTY: { expiryDay: 3, label: 'BANKNIFTY', yahooSymbol: '^NSEBANK', nseSymbol: 'BANKNIFTY', growwSymbol: 'BANKNIFTY' },
  FINNIFTY: { expiryDay: 2, label: 'FINNIFTY', yahooSymbol: 'NIFTY_FIN_SERVICE.NS', nseSymbol: 'FINNIFTY', growwSymbol: 'FINNIFTY' },
  MIDCPNIFTY: { expiryDay: 1, label: 'MIDCAP NIFTY', yahooSymbol: '^NSEMDCP50', nseSymbol: 'MIDCPNIFTY', growwSymbol: 'MIDCPNIFTY' }
};

const BSE_API_BASE = 'https://api.bseindia.com';
const SENSEX_SCRIP_CD = '1';
const OTM_LEVELS = [
  { key: '2', label: '2% OTM', percent: 0.02 },
  { key: '2_5', label: '2.5% OTM', percent: 0.025 }
];

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'content-type',
      'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS'
    },
    body: JSON.stringify(body)
  };
}

function parseNumber(value) {
  if (value === null || value === undefined || value === '-' || value === '') return null;
  return Number(String(value).replace(/,/g, ''));
}

function extractNseOptionFields(optObj, strike) {
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

function extractBseOptionFields(row, strike, type) {
  if (!row) return null;
  return {
    strike,
    ltp: parseNumber(type === 'CE' ? row.C_Last_Trd_Price : row.Last_Trd_Price),
    change: parseNumber(type === 'CE' ? row.C_NetChange : row.NetChange),
    pChange: 0,
    oi: parseNumber(type === 'CE' ? row.C_Open_Interest : row.Open_Interest),
    oiChange: parseNumber(type === 'CE' ? row.C_Absolute_Change_OI : row.Absolute_Change_OI),
    volume: parseNumber(type === 'CE' ? row.C_Vol_Traded : row.Vol_Traded),
    iv: null,
    bid: parseNumber(type === 'CE' ? row.C_BidPrice : row.BidPrice),
    ask: parseNumber(type === 'CE' ? row.C_OfferPrice : row.OfferPrice),
    bidQty: parseNumber(type === 'CE' ? row.C_BIdQty : row.BIdQty),
    askQty: parseNumber(type === 'CE' ? row.C_OfferQty : row.OfferQty)
  };
}

function getAvailableStrikes(rows, selector) {
  return [...new Set(rows.map(selector).filter(Number.isFinite))].sort((a, b) => a - b);
}

function getOtmStrike(strikes, referencePrice, percent, type) {
  if (!strikes.length || !referencePrice) return null;
  const target = type === 'CE' ? referencePrice * (1 + percent) : referencePrice * (1 - percent);
  if (type === 'CE') return strikes.find(strike => strike >= target) || strikes[strikes.length - 1];
  for (let i = strikes.length - 1; i >= 0; i -= 1) {
    if (strikes[i] <= target) return strikes[i];
  }
  return strikes[0];
}

async function getSpotFromYahoo(symbol) {
  const yahooSymbol = symbol === 'SENSEX' ? '^BSESN' : SYMBOL_CONFIG[symbol]?.yahooSymbol;
  if (!yahooSymbol) return null;
  try {
    const res = await axios.get(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=1d&range=1d`,
      { headers: { 'User-Agent': NSE_HEADERS['User-Agent'] }, timeout: 8000 }
    );
    const meta = res.data?.chart?.result?.[0]?.meta;
    return meta?.regularMarketPrice ? { price: meta.regularMarketPrice, open: meta.previousClose } : null;
  } catch {
    return null;
  }
}

async function fetchNseChain(symbol) {
  const config = SYMBOL_CONFIG[symbol] || SYMBOL_CONFIG.NIFTY;
  let cookies = '';
  try {
    const sessionRes = await axios.get('https://www.nseindia.com/option-chain', {
      headers: NSE_HEADERS,
      timeout: 8000
    });
    const setCookies = sessionRes.headers['set-cookie'];
    if (setCookies) cookies = setCookies.map(c => c.split(';')[0]).join('; ');
  } catch {
    // Continue; the API sometimes works without a fresh cookie in serverless.
  }

  const res = await axios.get(
    `https://www.nseindia.com/api/option-chain-indices?symbol=${encodeURIComponent(config.nseSymbol)}`,
    { headers: { ...NSE_HEADERS, Cookie: cookies }, timeout: 12000 }
  );
  return res.data;
}

function formatGrowwExpiry(isoDate) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const [year, month, day] = isoDate.split('-');
  return `${day}-${months[Number(month) - 1]}-${year}`;
}

async function fetchGrowwChain(symbol) {
  const config = SYMBOL_CONFIG[symbol];
  const res = await axios.get(
    `https://groww.in/v1/api/option_chain_service/v1/option_chain/${config.growwSymbol}`,
    {
      headers: {
        'User-Agent': NSE_HEADERS['User-Agent'],
        Accept: 'application/json',
        'X-App-Id': 'growwWeb'
      },
      timeout: 12000
    }
  );

  const oc = res.data?.optionChain;
  const chains = oc?.optionChains || [];
  if (!chains.length) throw new Error('Groww returned empty option chain');

  const currentExpiryISO = oc.expiryDetailsDto?.currentExpiry || oc.expiryDetailsDto?.expiryDates?.[0];
  const currentExpiry = currentExpiryISO ? formatGrowwExpiry(currentExpiryISO) : 'Unknown';
  const expiryDates = (oc.expiryDetailsDto?.expiryDates || [currentExpiryISO]).filter(Boolean).map(formatGrowwExpiry);
  const data = chains.map(row => {
    const strike = (row.strikePrice || row.callOption?.strikePrice || row.putOption?.strikePrice) / 100;
    const result = { strikePrice: strike, expiryDate: currentExpiry };
    if (row.callOption) {
      result.CE = {
        strikePrice: strike,
        expiryDate: currentExpiry,
        lastPrice: row.callOption.ltp,
        change: row.callOption.dayChange || 0,
        pChange: row.callOption.dayChangePerc || 0,
        openInterest: row.callOption.openInterest || 0,
        changeinOpenInterest: (row.callOption.openInterest || 0) - (row.callOption.prevOpenInterest || 0),
        totalTradedVolume: row.callOption.volume || 0,
        impliedVolatility: null,
        buyPrice1: 0,
        sellPrice1: 0,
        buyQuantity1: row.callOption.totalBuyQty || 0,
        sellQuantity1: row.callOption.totalSellQty || 0
      };
    }
    if (row.putOption) {
      result.PE = {
        strikePrice: strike,
        expiryDate: currentExpiry,
        lastPrice: row.putOption.ltp,
        change: row.putOption.dayChange || 0,
        pChange: row.putOption.dayChangePerc || 0,
        openInterest: row.putOption.openInterest || 0,
        changeinOpenInterest: (row.putOption.openInterest || 0) - (row.putOption.prevOpenInterest || 0),
        totalTradedVolume: row.putOption.volume || 0,
        impliedVolatility: null,
        buyPrice1: 0,
        sellPrice1: 0,
        buyQuantity1: row.putOption.totalBuyQty || 0,
        sellQuantity1: row.putOption.totalSellQty || 0
      };
    }
    return result;
  });

  return {
    source: 'Groww',
    records: {
      underlyingValue: 0,
      expiryDates,
      data
    }
  };
}

async function getNseTrackerData(symbol) {
  const config = SYMBOL_CONFIG[symbol] || SYMBOL_CONFIG.NIFTY;
  let apiData = await fetchNseChain(symbol);
  let dataSource = 'NSE Direct';

  if (!apiData.records?.data?.length || !apiData.records?.expiryDates?.length) {
    apiData = await fetchGrowwChain(symbol);
    dataSource = 'Groww';
  }

  const spot = apiData.records?.underlyingValue || 0;
  const yahooSpot = await getSpotFromYahoo(symbol);
  const referencePrice = yahooSpot?.open || spot;
  const targetExpiries = (apiData.records?.expiryDates || []).slice(0, 2);
  const rows = apiData.records?.data || [];

  const expiries = targetExpiries.map(expiry => {
    const dataRows = rows.filter(row => row.expiryDate === expiry || row.CE?.expiryDate === expiry || row.PE?.expiryDate === expiry);
    const strikes = getAvailableStrikes(dataRows, row => row.strikePrice);
    const options = OTM_LEVELS.map(level => {
      const ceStrike = getOtmStrike(strikes, referencePrice, level.percent, 'CE');
      const peStrike = getOtmStrike(strikes, referencePrice, level.percent, 'PE');
      const ceRow = dataRows.find(row => row.strikePrice === ceStrike);
      const peRow = dataRows.find(row => row.strikePrice === peStrike);
      return {
        ...level,
        ceStrike,
        peStrike,
        ce: extractNseOptionFields(ceRow?.CE, ceStrike),
        pe: extractNseOptionFields(peRow?.PE, peStrike)
      };
    });
    return { expiry, options };
  });

  const weekDays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return {
    symbol,
    label: config.label,
    spot,
    anchorPrice: yahooSpot?.open || null,
    timestamp: new Date().toISOString(),
    otmLevels: OTM_LEVELS,
    expiryDay: weekDays[config.expiryDay] || 'Thursday',
    expiries,
    dataSource
  };
}

async function getSensexTrackerData() {
  const spotRes = await axios.get(
    `${BSE_API_BASE}/BseIndiaAPI/api/getScripHeaderData/w?Debtflag=&scripcode=${SENSEX_SCRIP_CD}&seriesid=`,
    { headers: NSE_HEADERS, timeout: 12000 }
  );
  const spot = parseNumber(spotRes.data?.CurrRate?.LTP) || 0;

  const expiryRes = await axios.get(
    `${BSE_API_BASE}/BseIndiaAPI/api/ddlExpiry_New/w?scrip_cd=${SENSEX_SCRIP_CD}`,
    { headers: NSE_HEADERS, timeout: 12000 }
  );
  const activeExpiries = expiryRes.data?.Table1 ? expiryRes.data.Table1.map(row => row.ExpiryDate) : [];
  const yahooSpot = await getSpotFromYahoo('SENSEX');
  const referencePrice = yahooSpot?.open || spot;
  const allExpiries = [];

  for (const expiry of activeExpiries.slice(0, 4)) {
    if (allExpiries.length >= 2) break;
    const chainRes = await axios.get(
      `${BSE_API_BASE}/BseIndiaAPI/api/DerivOptionChain_IV/w?Expiry=${encodeURIComponent(expiry)}&scrip_cd=${SENSEX_SCRIP_CD}&strprice=0`,
      { headers: NSE_HEADERS, timeout: 12000 }
    );
    if (chainRes.data?.Table?.length) allExpiries.push({ expiry, data: chainRes.data.Table });
  }

  const expiries = allExpiries.map(({ expiry, data }) => {
    const strikes = getAvailableStrikes(data, row => parseNumber(row.Strike_Price));
    const options = OTM_LEVELS.map(level => {
      const ceStrike = getOtmStrike(strikes, referencePrice, level.percent, 'CE');
      const peStrike = getOtmStrike(strikes, referencePrice, level.percent, 'PE');
      const ceRow = data.find(row => parseNumber(row.Strike_Price) === ceStrike);
      const peRow = data.find(row => parseNumber(row.Strike_Price) === peStrike);
      return {
        ...level,
        ceStrike,
        peStrike,
        ce: extractBseOptionFields(ceRow, ceStrike, 'CE'),
        pe: extractBseOptionFields(peRow, peStrike, 'PE')
      };
    });
    return { expiry, options };
  });

  return {
    symbol: 'SENSEX',
    label: 'SENSEX',
    spot,
    anchorPrice: yahooSpot?.open || null,
    timestamp: new Date().toISOString(),
    otmLevels: OTM_LEVELS,
    expiryDay: 'Friday',
    expiries
  };
}

exports.handler = async event => {
  if (event.httpMethod === 'OPTIONS') return json(200, {});

  const path = event.path || '';
  try {
    if (path.includes('/transactions')) return json(200, []);
    if (path.includes('/algo/')) return json(501, { error: 'Algo engine is available only on the full backend server.' });
    if (!path.includes('/chain')) return json(404, { error: 'Unknown options endpoint' });

    const symbol = (event.queryStringParameters?.symbol || 'NIFTY').toUpperCase();
    if (symbol === 'SENSEX') return json(200, await getSensexTrackerData());
    if (!SYMBOL_CONFIG[symbol]) return json(400, { error: `Invalid symbol: ${symbol}` });
    return json(200, await getNseTrackerData(symbol));
  } catch (err) {
    return json(503, { error: `Failed to fetch option chain data: ${err.message}` });
  }
};
