require('dotenv').config();
const { BitgetRestClient } = require('../dist/api/rest-client.js');

(async () => {
  try {
    const client = new BitgetRestClient({
      apiKey: process.env.BITGET_API_KEY || '',
      secretKey: process.env.BITGET_SECRET_KEY || '',
      passphrase: process.env.BITGET_PASSPHRASE || '',
      sandbox: process.env.BITGET_SANDBOX === 'true',
      baseUrl: 'https://api.bitget.com',
      wsUrl: process.env.BITGET_SANDBOX === 'true' ? 'wss://wspap.bitget.com/v2/ws/public' : 'wss://ws.bitget.com/v2/ws/public',
    });

    const symbol = process.argv[2] || 'BTCUSDT';
    const interval = process.argv[3] || '1h';
    const limit = Number(process.argv[4] || 150);

    const candles = await client.getCandles(symbol, interval, limit);
    if (!candles.length) throw new Error('No candles');
    const closes = candles.map(c => parseFloat(c.close));
    const highs = candles.map(c => parseFloat(c.high));
    const lows = candles.map(c => parseFloat(c.low));
    const opens = candles.map(c => parseFloat(c.open));
    const volumes = candles.map(c => parseFloat(c.volume));
    const timestamps = candles.map(c => c.timestamp);

    // pivots
    const pivots = [];
    for (let i = 1; i < candles.length - 1; i++) {
      if (highs[i] > highs[i-1] && highs[i] > highs[i+1]) pivots.push({ idx: i, type: 'H', price: highs[i] });
      if (lows[i] < lows[i-1] && lows[i] < lows[i+1]) pivots.push({ idx: i, type: 'L', price: lows[i] });
    }

    const lastClose = closes[closes.length - 1];
    const prevHigh = Math.max(...highs.slice(0, highs.length - 1));
    const prevLow = Math.min(...lows.slice(0, lows.length - 1));
    let bos = null; if (lastClose > prevHigh) bos = 'up'; else if (lastClose < prevLow) bos = 'down';

    // ATR (RMA)
    const tr = [];
    for (let i = 0; i < candles.length; i++) {
      const hl = highs[i] - lows[i];
      const hc = i > 0 ? Math.abs(highs[i] - closes[i-1]) : 0;
      const lc = i > 0 ? Math.abs(lows[i] - closes[i-1]) : 0;
      tr.push(Math.max(hl, hc, lc));
    }
    const rma = (arr, n) => {
      if (arr.length < n) return null; let sum = 0; for (let i = 0; i < n; i++) sum += arr[i];
      let val = sum / n; const alpha = 1 / n; for (let i = n; i < arr.length; i++) val = alpha * arr[i] + (1 - alpha) * val; return val;
    };
    const atr = rma(tr, 14);

    // order blocks (with fallbacks)
    const orderBlocks = [];
    const lookbackOB = Math.min(candles.length - 1, 60);
    if (bos === 'up') {
      for (let i = candles.length - 3; i >= candles.length - lookbackOB; i--) {
        if (opens[i] > closes[i]) { const upMomentum = (closes[i+1] > closes[i]) && (closes[i+2] >= closes[i+1]); const brokeHigh = lastClose > prevHigh; if (upMomentum || brokeHigh) { orderBlocks.push({ type: 'bull', idx: i, open: opens[i], high: highs[i], low: lows[i], close: closes[i] }); break; } }
      }
    } else if (bos === 'down') {
      for (let i = candles.length - 3; i >= candles.length - lookbackOB; i--) {
        if (opens[i] < closes[i]) { const downMomentum = (closes[i+1] < closes[i]) && (closes[i+2] <= closes[i+1]); const brokeLow = lastClose < prevLow; if (downMomentum || brokeLow) { orderBlocks.push({ type: 'bear', idx: i, open: opens[i], high: highs[i], low: lows[i], close: closes[i] }); break; } }
      }
    }
    if (orderBlocks.length === 0) {
      const windowN = Math.min(5, closes.length - 1);
      const displacementUp = closes[closes.length - 1] - closes[closes.length - 1 - windowN];
      const displacementDown = closes[closes.length - 1 - windowN] - closes[closes.length - 1];
      const baseRange = atr ?? Math.max(1e-8, highs[highs.length - 1] - lows[lows.length - 1]);
      const threshold = baseRange * 0.8;
      if (displacementUp > threshold) {
        for (let i = candles.length - 2; i >= Math.max(1, candles.length - 1 - lookbackOB); i--) {
          if (opens[i] > closes[i]) { orderBlocks.push({ type: 'bull', idx: i, open: opens[i], high: highs[i], low: lows[i], close: closes[i] }); break; }
        }
      } else if (displacementDown > threshold) {
        for (let i = candles.length - 2; i >= Math.max(1, candles.length - 1 - lookbackOB); i--) {
          if (opens[i] < closes[i]) { orderBlocks.push({ type: 'bear', idx: i, open: opens[i], high: highs[i], low: lows[i], close: closes[i] }); break; }
        }
      }
    }
    if (orderBlocks.length === 0) {
      const lastH = [...pivots].reverse().find(p => p.type === 'H');
      const lastL = [...pivots].reverse().find(p => p.type === 'L');
      if (lastH) { for (let i = lastH.idx - 1; i >= Math.max(0, lastH.idx - 10); i--) { if (opens[i] > closes[i]) { orderBlocks.push({ type: 'bull', idx: i, open: opens[i], high: highs[i], low: lows[i], close: closes[i] }); break; } } }
      if (orderBlocks.length === 0 && lastL) { for (let i = lastL.idx - 1; i >= Math.max(0, lastL.idx - 10); i--) { if (opens[i] < closes[i]) { orderBlocks.push({ type: 'bear', idx: i, open: opens[i], high: highs[i], low: lows[i], close: closes[i] }); break; } } }
    }

    const latest = { close: lastClose, high: highs[highs.length-1], low: lows[lows.length-1], ts: timestamps[timestamps.length-1] };
    console.log(JSON.stringify({ symbol, interval, latest, orderBlocks }, null, 2));
    process.exit(0);
  } catch (err) {
    console.error('Bitget smoke failed:', err?.message || err);
    process.exit(1);
  }
})();
