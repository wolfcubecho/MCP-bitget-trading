import dotenv from 'dotenv';
import path from 'path';
import fetch from 'node-fetch';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

const STABLES = new Set(['USDT','USDC','BUSD','TUSD','DAI','FDUSD']);

type Summary = {
  symbol: string;
  price: number | null;
  pct24h: number | null;
  vol24h: number | null;
  atrPct: number | null;
  trend: 'up'|'down'|null;
  rating: 'strong_up'|'up'|'neutral'|'down'|'strong_down';
  cmc?: { market_cap?: number; percent_change_24h?: number; rank?: number } | null;
};

function calcEMA(arr: number[], n: number): number | null {
  if (arr.length < n) return null;
  const k = 2 / (n + 1);
  let ema = arr[0];
  for (let i = 1; i < arr.length; i++) ema = arr[i] * k + ema * (1 - k);
  return ema;
}

function sma(arr: number[], n: number): number | null {
  if (arr.length < n) return null;
  let sum = 0; for (let i = arr.length - n; i < arr.length; i++) sum += arr[i];
  return sum / n;
}

function rma(arr: number[], n: number): number | null {
  if (arr.length < n) return null;
  let sum = 0; for (let i = 0; i < n; i++) sum += arr[i];
  let val = sum / n; const alpha = 1 / n;
  for (let i = n; i < arr.length; i++) val = alpha * arr[i] + (1 - alpha) * val;
  return val;
}

function scoreRating(trend: 'up'|'down'|null, pct24h: number | null): Summary['rating'] {
  if (trend === 'up') {
    if (pct24h !== null && pct24h > 2) return 'strong_up';
    if (pct24h !== null && pct24h > 1) return 'up';
    return 'neutral';
  }
  if (trend === 'down') {
    if (pct24h !== null && pct24h < -2) return 'strong_down';
    if (pct24h !== null && pct24h < -1) return 'down';
    return 'neutral';
  }
  return 'neutral';
}

async function main() {
  const args = process.argv.slice(2);
  const topN = parseInt(args[0] || '20', 10);
  const resultCount = parseInt(args[1] || '5', 10);
  const interval = args[2] || '1h';
  const limit = parseInt(args[3] || '250', 10);

  if (!process.env.COINMARKET_API_KEY) {
    console.error('COINMARKET_API_KEY not set; set it to include CMC metadata');
  }

  // Step 1: Get top N symbols by CMC rank
  let listings: any[] = [];
  try {
    const res = await fetch(`https://pro-api.coinmarketcap.com/v1/cryptocurrency/listings/latest?limit=${topN}&convert=USD`, {
      headers: { 'X-CMC_PRO_API_KEY': process.env.COINMARKET_API_KEY as string, 'Accept': 'application/json' }
    });
    if (res.ok) {
      const data = await res.json();
      listings = data?.data || [];
    }
  } catch {}

  const summaries: Summary[] = [];

  for (const item of listings) {
    const base = item?.symbol as string;
    if (!base || STABLES.has(base)) continue;
    const symbol = `${base}USDT`;

    try {
      // Binance 24h ticker
      const tRes = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`);
      if (!tRes.ok) continue; // skip if not traded on Binance
      const ticker: any = await tRes.json();

      // Binance OHLCV
      const kRes = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
      if (!kRes.ok) continue;
      const klines: any[] = await kRes.json() as any[];
      const closes = klines.map(k => parseFloat(k[4]));
      const highs = klines.map(k => parseFloat(k[2]));
      const lows = klines.map(k => parseFloat(k[3]));
      const lastClose = closes[closes.length - 1] ?? null;

      // ATR%%
      const tr: number[] = [];
      for (let i = 0; i < closes.length; i++) {
        const hl = (highs[i] ?? 0) - (lows[i] ?? 0);
        const hc = i > 0 ? Math.abs((highs[i] ?? 0) - (closes[i-1] ?? 0)) : 0;
        const lc = i > 0 ? Math.abs((lows[i] ?? 0) - (closes[i-1] ?? 0)) : 0;
        tr.push(Math.max(hl, hc, lc));
      }
      const atr = rma(tr, 14);
      const atrPct = atr && lastClose ? (atr / lastClose) * 100 : null;

      const ema50 = calcEMA(closes, 50);
      const ema200 = calcEMA(closes, 200);
      const sma200 = sma(closes, 200);
      let trend: 'up'|'down'|null = null;
      if (ema50 !== null && ema200 !== null) trend = ema50 > ema200 ? 'up' : 'down';
      else if (sma200 !== null && lastClose !== null) trend = lastClose > sma200 ? 'up' : 'down';

      const pct24h = ticker ? parseFloat(ticker.priceChangePercent) : null;
      const vol24h = ticker ? parseFloat(ticker.volume) : null;

      const cmcSlim = item ? {
        market_cap: item.quote?.USD?.market_cap,
        percent_change_24h: item.quote?.USD?.percent_change_24h,
        rank: item.cmc_rank,
      } : null;

      const rating = scoreRating(trend, pct24h);

      summaries.push({ symbol, price: lastClose, pct24h, vol24h, atrPct, trend, rating, cmc: cmcSlim });
    } catch { /* skip this symbol on error */ }
  }

  // Step 2: Select top resultCount by rating and magnitude
  const ratingScore = (r: Summary['rating']) => ({ strong_up: 4, up: 3, neutral: 2, down: 1, strong_down: 0 }[r]);
  summaries.sort((a, b) => {
    const ra = ratingScore(a.rating); const rb = ratingScore(b.rating);
    if (rb !== ra) return rb - ra;
    const ma = a.pct24h !== null ? Math.abs(a.pct24h) : 0;
    const mb = b.pct24h !== null ? Math.abs(b.pct24h) : 0;
    return mb - ma;
  });

  const top = summaries.slice(0, resultCount);
  console.log(JSON.stringify(top, null, 2));
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
