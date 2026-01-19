import dotenv from 'dotenv';
import path from 'path';
import { BitgetRestClient } from '../src/api/rest-client.js';
import { BitgetConfig, Candle } from '../src/types/bitget.js';
import fetch from 'node-fetch';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

function getConfig(): BitgetConfig {
  const isSandbox = process.env.BITGET_SANDBOX === 'true';
  return {
    apiKey: process.env.BITGET_API_KEY || '',
    secretKey: process.env.BITGET_SECRET_KEY || '',
    passphrase: process.env.BITGET_PASSPHRASE || '',
    sandbox: isSandbox,
    baseUrl: 'https://api.bitget.com',
    wsUrl: isSandbox ? 'wss://wspap.bitget.com/v2/ws/public' : 'wss://ws.bitget.com/v2/ws/public',
  };
}

function sma(arr: number[], n: number): number | null {
  if (arr.length < n) return null;
  let sum = 0; for (let i = arr.length - n; i < arr.length; i++) sum += arr[i];
  return sum / n;
}

function ema(arr: number[], n: number): number | null {
  if (arr.length < n) return null;
  const k = 2 / (n + 1);
  let val = arr[0];
  for (let i = 1; i < arr.length; i++) val = arr[i] * k + val * (1 - k);
  return val;
}

function rma(arr: number[], n: number): number | null {
  if (arr.length < n) return null;
  let sum = 0; for (let i = 0; i < n; i++) sum += arr[i];
  let val = sum / n;
  const alpha = 1 / n;
  for (let i = n; i < arr.length; i++) val = alpha * arr[i] + (1 - alpha) * val;
  return val;
}

type SnapshotOptions = {
  compact?: boolean;
  emas?: number[];
  atrPeriod?: number;
  fvgLookback?: number;
};

function computeSnapshot(symbol: string, candles: Candle[], opts: SnapshotOptions = {}, cmc?: any) {
  const compact = opts.compact ?? true;
  const emas = opts.emas ?? [20, 50, 200];
  const atrPeriod = opts.atrPeriod ?? 14;
  const fvgLookback = opts.fvgLookback ?? 60;

  const closes = candles.map(c => parseFloat(c.close));
  const highs = candles.map(c => parseFloat(c.high));
  const lows = candles.map(c => parseFloat(c.low));

  const pivots: Array<{ idx: number; type: 'H'|'L'; price: number }> = [];
  for (let i = 1; i < candles.length - 1; i++) {
    if (highs[i] > highs[i-1] && highs[i] > highs[i+1]) pivots.push({ idx: i, type: 'H', price: highs[i] });
    if (lows[i] < lows[i-1] && lows[i] < lows[i+1]) pivots.push({ idx: i, type: 'L', price: lows[i] });
  }

  const lastClose = closes[closes.length - 1];
  const prevHigh = Math.max(...highs.slice(0, highs.length - 1));
  const prevLow = Math.min(...lows.slice(0, lows.length - 1));
  let bos: 'up' | 'down' | null = null;
  if (lastClose > prevHigh) bos = 'up'; else if (lastClose < prevLow) bos = 'down';

  const fvg: Array<{ type: 'bull'|'bear'; from: number; to: number; startIdx: number }>= [];
  for (let i = Math.max(2, candles.length - (fvgLookback + 2)); i < candles.length; i++) {
    if (lows[i] > highs[i-2]) fvg.push({ type: 'bull', from: highs[i-2], to: lows[i], startIdx: i-2 });
    if (highs[i] < lows[i-2]) fvg.push({ type: 'bear', from: highs[i], to: lows[i-2], startIdx: i-2 });
  }

  const sma50 = sma(closes, 50);
  const sma200 = sma(closes, 200);
  const trend = sma50 && sma200 ? (sma50 > sma200 ? 'up' : 'down') : null;

  const emaValues: Record<string, number | null> = {};
  for (const p of emas) emaValues[`ema${p}`] = ema(closes, p);

  const tr: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    const hl = highs[i] - lows[i];
    const hc = i > 0 ? Math.abs(highs[i] - closes[i-1]) : 0;
    const lc = i > 0 ? Math.abs(lows[i] - closes[i-1]) : 0;
    tr.push(Math.max(hl, hc, lc));
  }
  const atr = rma(tr, atrPeriod);

  const latest = { close: lastClose, high: highs[highs.length-1], low: lows[lows.length-1], ts: candles[candles.length-1]?.timestamp };
  const base = symbol.replace('USDT','');
  const cmcSlim = cmc && cmc.data && cmc.data[base] ? {
    market_cap: cmc.data[base].quote?.USD?.market_cap,
    percent_change_24h: cmc.data[base].quote?.USD?.percent_change_24h,
    rank: cmc.data[base].cmc_rank,
  } : null;

  return compact
    ? { symbol, latest, bos, pivots: pivots.slice(-6), trend, sma50, sma200, atr, ...emaValues, fvg: fvg.slice(-5), cmc: cmcSlim }
    : { symbol, candles, bos, pivots, trend, sma50, sma200, atr, emaValues, fvg, cmc: cmcSlim };
}

async function main() {
  const config = getConfig();
  const client = new BitgetRestClient(config);

  const args = process.argv.slice(2);
  // Usage:
  //   tsx examples/run-snapshot.ts BTCUSDT 1h 200
  //   tsx examples/run-snapshot.ts BTCUSDT,ETHUSDT,AVAXUSDT 1h 150
  const listArg = args[0] || 'BTCUSDT,ETHUSDT,AVAXUSDT';
  const interval = args[1] || '1h';
  const limit = parseInt(args[2] || '200', 10);

  const symbols = listArg.split(',').map(s => s.trim()).filter(Boolean);

  const results: any[] = [];
  for (const symbol of symbols) {
    try {
      const candles = await client.getCandles(symbol, interval, limit);
      if (!candles.length) {
        results.push({ symbol, error: 'no_candles' });
        continue;
      }
      let cmc: any = null;
      if (process.env.COINMARKET_API_KEY) {
        const base = symbol.replace('USDT','');
        try {
          const res = await fetch(`https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest?symbol=${base}&convert=USD`, {
            headers: { 'X-CMC_PRO_API_KEY': process.env.COINMARKET_API_KEY as string, 'Accept': 'application/json' }
          });
          if (res.ok) cmc = await res.json();
        } catch {}
      }
      results.push(computeSnapshot(symbol, candles, { compact: true, emas: [20,50,200], atrPeriod: 14, fvgLookback: 80 }, cmc));
    } catch (e: any) {
      results.push({ symbol, error: e?.message || String(e) });
    }
  }

  console.log(JSON.stringify(results.length === 1 ? results[0] : results, null, 2));
  // Ensure process exits cleanly even if any handles remain open
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
