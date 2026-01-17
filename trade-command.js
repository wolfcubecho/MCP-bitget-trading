#!/usr/bin/env node

import ccxt from 'ccxt';
import dotenv from 'dotenv';

dotenv.config();

function parseCommand(input) {
  const text = input.trim().toLowerCase();
  const result = {
    leverage: 1,
    side: undefined, // 'long' | 'short'
    orderType: 'market', // 'market' | 'limit'
    price: undefined,
    symbol: undefined,
    amount: undefined,
    sl: undefined, // number or % string
    tps: [], // array of parsed targets with optional sizes
    sandbox: undefined,
    marginMode: undefined, // 'isolated' | 'cross'
    positionMode: undefined, // 'oneway' | 'hedged'
    dryRun: false,
    resting: false,
    restingDepth: undefined,
    closeAll: false,
    cancelTPs: false,
    oneWayStrict: false,
    noHedgedFallback: false,
    json: false,
    productType: 'swap', // 'swap' (perps) or 'spot'
    // Spot margin ops
    spotBorrow: false,
    spotRepay: false,
    spotAsset: undefined, // currency code, e.g., 'USDT'
  };
  // leverage: e.g. "10x"
  const levMatch = text.match(/(\d+)x/);
  if (levMatch) result.leverage = parseInt(levMatch[1], 10);
  // side: long/short
  const sideMatch = text.match(/\b(long|short)\b/);
  if (sideMatch) result.side = sideMatch[1];
  // spot side: buy/sell -> map to long/short for internal handling
  const spotSideMatch = text.match(/\b(buy|sell)\b/);
  if (spotSideMatch) {
    const ss = spotSideMatch[1];
    result.side = (ss === 'buy') ? 'long' : 'short';
  }
  // symbol: like avax/usdt or btc/usdt; add :usdt later for contracts
  const symMatch = text.match(/([a-z0-9]+\/[a-z0-9]+)/);
  if (symMatch) result.symbol = symMatch[1].toUpperCase();
  // order type and optional price
  const atMatch = text.match(/@\s*(market|limit)(?:\s*(\d+(?:\.\d+)?))?/);
  if (atMatch) {
    result.orderType = atMatch[1];
    if (atMatch[2]) result.price = parseFloat(atMatch[2]);
  }
  // amount or size
  const amtMatch = text.match(/\b(amount|size|qty)\s+(\d+(?:\.\d+)?)/);
  if (amtMatch) result.amount = parseFloat(amtMatch[2]);
  // sandbox flag
  const sbxMatch = text.match(/\b(sandbox|demo)\b/);
  if (sbxMatch) result.sandbox = true;
  // margin mode
  if (text.includes('isolated')) result.marginMode = 'isolated';
  if (text.includes('cross')) result.marginMode = 'cross';
  // position mode
  if (text.includes('hedged')) result.positionMode = 'hedged';
  if (text.includes('oneway')) result.positionMode = 'oneway';
  // product type
  if (text.includes(' spot ' ) || text.startsWith('spot ') || text.endsWith(' spot') || text.includes(' spot\n')) result.productType = 'spot';
  // dry run
  if (text.includes('--dry-run') || text.includes(' dry ') || text.endsWith(' dry') || text.startsWith('dry ')) result.dryRun = true;
  // resting entry flag
  if (text.includes('--resting') || text.includes(' resting ')) result.resting = true;
  // resting depth (e.g., "--resting-depth 0.5%" or "resting 5")
  const rdMatch = text.match(/(?:--resting-depth|resting-depth|resting)\s+([0-9]+(?:\.[0-9]+)?%?)/);
  if (rdMatch) { result.resting = true; result.restingDepth = rdMatch[1]; }
  // close all / flatten
  if (text.includes('close all') || text.includes('flatten')) result.closeAll = true;
  // cancel TPs
  if (text.includes('cancel tps') || text.includes('cancel tp') || text.includes('cancel targets')) result.cancelTPs = true;
  // strict one-way (no hedged fallback, stage TP/SL after open)
  if (text.includes('--oneway-strict') || text.includes('oneway strict')) result.oneWayStrict = true;
  // disable hedged fallback
  if (text.includes('--no-hedged-fallback')) result.noHedgedFallback = true;
  // json output flag
  if (text.includes('--json') || text.includes(' json ')) result.json = true;
  // SL value (price or %)
  const slMatch = text.match(/\bsl\s+([0-9]+(?:\.[0-9]+)?%?|\-[0-9]+(?:\.[0-9]+)?%?)/);
  if (slMatch) result.sl = slMatch[1];
  // TP list: "tp" or "tps" followed by comma-separated values (price or %)
  const tpMatch = text.match(/\btp(?:s)?\s+([0-9a-z@:%.,\s\-]+)/);
  if (tpMatch) {
    const raw = tpMatch[1]
      .split(/[,]+/)
      .map(v => v.trim())
      .filter(Boolean)
      .filter(v => /^[0-9.+\-]+%?(?:[@:][0-9.+\-]+%?)?$/.test(v));
    result.tps = raw.map(item => {
      // support formats: "97000", "1%", "97000@50%", "97000@0.001", "1%@25%", "1%:0.001"
      const parts = item.split(/[@:]/).map(x => x.trim());
      const target = parts[0];
      const sizeSpec = parts[1];
      const sizePercent = sizeSpec && sizeSpec.endsWith('%');
      const size = sizeSpec ? sizeSpec : undefined;
      return { target, size, sizePercent };
    });
  }
  // Spot margin borrow/repay: e.g., "spot borrow usdt 100 cross" or "spot repay usdt 50 isolated btc/usdt"
  if (text.includes('borrow')) result.spotBorrow = true;
  if (text.includes('repay')) result.spotRepay = true;
  const brMatch = text.match(/\b(borrow|repay)\s+([a-z0-9]{2,10})\b(?:\s+(\d+(?:\.\d+)?))?/);
  if (brMatch) {
    result.spotAsset = brMatch[2].toUpperCase();
    if (brMatch[3]) result.amount = parseFloat(brMatch[3]);
  }
  return result;
}

function ensureContractSymbol(exchange, baseSymbol) {
  // Prefer USDT-margined contracts: e.g., BTC/USDT:USDT
  const contractSymbols = Object.values(exchange.markets)
    .filter(m => m.contract && m.quote === 'USDT')
    .map(m => m.symbol);
  const candidate = baseSymbol.includes(':USDT') ? baseSymbol : `${baseSymbol}:USDT`;
  if (contractSymbols.includes(candidate)) return candidate;
  if (contractSymbols.includes(baseSymbol)) return baseSymbol;
  // fallback: BTC/USDT:USDT or first available
  if (contractSymbols.includes('BTC/USDT:USDT')) return 'BTC/USDT:USDT';
  if (contractSymbols.length > 0) return contractSymbols[0];
  throw new Error('No USDT contract symbols available');
}

function ensureSpotSymbol(exchange, baseSymbol) {
  const spotSymbols = Object.values(exchange.markets)
    .filter(m => m.spot && m.quote === 'USDT')
    .map(m => m.symbol);
  const candidate = baseSymbol.toUpperCase();
  if (spotSymbols.includes(candidate)) return candidate;
  if (spotSymbols.includes('BTC/USDT')) return 'BTC/USDT';
  if (spotSymbols.length > 0) return spotSymbols[0];
  throw new Error('No USDT spot symbols available');
}

function toNumberMaybePercent(val, entryPrice, side) {
  // If ends with %, interpret as percent move from entryPrice.
  // Preserve sign if provided; if no sign, use market-direction default (+ for long TP, - for short TP).
  if (typeof val === 'string' && val.trim().endsWith('%')) {
    const raw = val.trim().replace('%', '');
    let p = parseFloat(raw);
    if (!Number.isFinite(p)) throw new Error(`Invalid percent: ${val}`);
    if (!raw.startsWith('-') && !raw.startsWith('+')) {
      const defaultDir = (side === 'long') ? 1 : -1;
      p = defaultDir * p;
    }
    const target = entryPrice * (1 + (p / 100));
    return target;
  }
  const num = parseFloat(val);
  if (!Number.isFinite(num)) throw new Error(`Invalid price: ${val}`);
  return num;
}

async function executeCommand(cmdText) {
  const parsed = parseCommand(cmdText);
  if ((!parsed.side || !parsed.symbol) && !parsed.closeAll && !parsed.cancelTPs && !parsed.spotBorrow && !parsed.spotRepay) {
    throw new Error('Missing side or symbol. Example: "10x short avax/usdt @ market sl 12.5 tp 12.0, 11.5 amount 1"');
  }
  const exchange = new ccxt.bitget({
    apiKey: process.env.BITGET_API_KEY,
    secret: process.env.BITGET_SECRET_KEY,
    password: process.env.BITGET_PASSPHRASE,
    options: { defaultType: parsed.productType === 'spot' ? 'spot' : 'swap' },
  });
  const useSandbox = parsed.sandbox ?? (String(process.env.BITGET_SANDBOX || '').toLowerCase() === 'true');
  if (useSandbox) exchange.setSandboxMode(true);
  await exchange.loadMarkets();
  // position mode and margin mode
  let marginMode = parsed.marginMode || 'isolated';
  let posMode = parsed.positionMode || 'oneway';
  try {
    await exchange.setPositionMode(posMode);
  } catch {}

  // Handle spot margin borrow/repay first
  if (parsed.productType === 'spot' && (parsed.spotBorrow || parsed.spotRepay)) {
    await exchange.loadMarkets();
    const asset = parsed.spotAsset || 'USDT';
    const amt = parsed.amount || 0;
    const mode = parsed.marginMode || 'cross';
    if (!amt || amt <= 0) throw new Error('Specify amount for borrow/repay, e.g., "borrow usdt 100"');
    if (parsed.spotBorrow) {
      if (mode === 'isolated') {
        if (!parsed.symbol) throw new Error('Isolated borrow requires a symbol, e.g., "btc/usdt"');
        const sym = parsed.symbol.toUpperCase();
        const res = await exchange.borrowIsolatedMargin(sym, asset, amt);
        console.log('Isolated borrow:', res);
      } else {
        const res = await exchange.borrowCrossMargin(asset, amt);
        console.log('Cross borrow:', res);
      }
    } else if (parsed.spotRepay) {
      if (mode === 'isolated') {
        if (!parsed.symbol) throw new Error('Isolated repay requires a symbol, e.g., "btc/usdt"');
        const sym = parsed.symbol.toUpperCase();
        const res = await exchange.repayIsolatedMargin(sym, asset, amt);
        console.log('Isolated repay:', res);
      } else {
        const res = await exchange.repayCrossMargin(asset, amt);
        console.log('Cross repay:', res);
      }
    }
    return;
  }

  const symbol = parsed.productType === 'spot' ? ensureSpotSymbol(exchange, parsed.symbol) : ensureContractSymbol(exchange, parsed.symbol);
  const market = exchange.market(symbol);
  // optional: close-all or cancel-TPs without opening new orders
  if (parsed.closeAll) {
    async function flattenOnce(hedgedFlag = false) {
      const positions = await exchange.fetchPositions([symbol]);
      for (const p of positions) {
        if (!p || !p.contracts || p.contracts <= 0) continue;
        const sideOpp = (p.side === 'long') ? 'sell' : 'buy';
        const qty = parseFloat(exchange.amountToPrecision(symbol, p.contracts));
        const order = await exchange.createOrder(symbol, 'market', sideOpp, qty, undefined, {
          marginMode: parsed.marginMode || 'isolated',
          hedged: hedgedFlag,
          reduceOnly: true,
          clientOrderId: `flatten-${Date.now()}-${p.side}`,
        });
        console.log('Flattened', p.side, 'position:', order.id || order.clientOrderId || 'unknown', 'qty:', qty);
      }
    }
    try {
      await flattenOnce(parsed.positionMode === 'hedged');
    } catch (flatErr) {
      const msg = String(flatErr?.message || '');
      console.error('Close-all error:', msg);
      if (msg.includes('unilateral')) {
        console.warn('Switching to hedged mode for flatten...');
        try {
          await exchange.setPositionMode('hedged');
          await flattenOnce(true);
        } catch (retryErr) {
          console.error('Flatten hedged retry failed:', retryErr?.message || retryErr);
        }
      }
    }
    return;
  }
  if (parsed.cancelTPs) {
    try {
      const openOrders = await exchange.fetchOpenOrders(symbol);
      for (const o of openOrders) {
        const planType = o.info && (o.info.planType || o.info.plan_type);
        const isTP = (o.reduceOnly === true && o.type === 'limit') || (o.clientOrderId && o.clientOrderId.startsWith('tp-')) || (planType === 'profit');
        if (isTP) {
          try {
            await exchange.cancelOrder(o.id, symbol);
            console.log('Canceled TP-like order:', o.id);
          } catch (cErr) {
            console.warn('Cancel error for', o.id, cErr?.message || cErr);
          }
        }
      }
    } catch (coErr) {
      console.error('Cancel TPs error:', coErr?.message || coErr);
    }
    return;
  }
  // set leverage
  try {
    await exchange.setLeverage(parsed.leverage || 1, symbol);
  } catch (e) {
    console.warn('setLeverage warn:', e?.message || e);
  }

  // compute amount default
  let amount = parsed.amount;
  if (amount === undefined) {
    amount = market?.limits?.amount?.min || market?.precision?.amount || 0.001;
    amount = parseFloat(exchange.amountToPrecision(symbol, amount));
  }

  const ticker = await exchange.fetchTicker(symbol);
  const candidate = ticker.ask ?? ticker.last ?? ticker.bid;
  let entryPrice = parsed.price || candidate;
  const minPrice = market?.limits?.price?.min;
  const maxPrice = market?.limits?.price?.max;
  if (minPrice !== undefined) entryPrice = Math.max(entryPrice, minPrice);
  if (maxPrice !== undefined) entryPrice = Math.min(entryPrice, maxPrice);
  entryPrice = parseFloat(exchange.priceToPrecision(symbol, entryPrice));

  const side = parsed.side; // long/short
  const openSide = side === 'long' ? 'buy' : 'sell';
  let openType = parsed.orderType;

  // Early dry-run preview before any order placement
  if (parsed.dryRun) {
    // apply resting conversion for preview
    let effectiveEntryPrice = entryPrice;
    let effectiveOpenType = openType;
    if (parsed.resting) {
      let offset = parsed.restingDepth || '0.5%';
      let price = effectiveEntryPrice;
      if (typeof offset === 'string' && offset.endsWith('%')) {
        const pct = parseFloat(offset.replace('%','')) / 100;
        price = side === 'long' ? (effectiveEntryPrice * (1 - pct)) : (effectiveEntryPrice * (1 + pct));
      } else {
        const abs = parseFloat(offset);
        price = side === 'long' ? (effectiveEntryPrice - abs) : (effectiveEntryPrice + abs);
      }
      if (minPrice !== undefined) price = Math.max(price, minPrice);
      if (maxPrice !== undefined) price = Math.min(price, maxPrice);
      effectiveEntryPrice = parseFloat(exchange.priceToPrecision(symbol, price));
      effectiveOpenType = 'limit';
    }
    const preview = { symbol, side, openType: effectiveOpenType, leverage: parsed.leverage, marginMode, posMode, amount, entryPrice: effectiveEntryPrice, slPrice: undefined, firstTp: undefined, extraTps: parsed.tps.slice(1) };
    const tpsPreview = parsed.tps.map((tp, idx) => ({ idx: idx + 1, target: tp.target, price: toNumberMaybePercent(tp.target, entryPrice, side === 'long' ? 'long' : 'short'), size: tp.size }));
    if (parsed.json) {
      const payload = { input: cmdText, sandbox: useSandbox, ...preview, tpPreview: tpsPreview };
      console.log(JSON.stringify(payload, null, 2));
    } else {
      console.log('Dry run:');
      console.log(preview);
      console.log('TP preview:', tpsPreview);
    }
    return;
  }

  // Spot margin trading branch (runs after dry-run preview)
  if (parsed.productType === 'spot' && !parsed.closeAll && !parsed.cancelTPs) {
    if (parsed.marginMode) {
      // CCXT routes to margin endpoints when marginMode is provided
    }
    // For market buy on spot, amount is cost (quote), else amount is base size
    let amountOrCost = parsed.amount;
    let priceForCost = parsed.price || entryPrice;
    const params = { marginMode: parsed.marginMode };
    if (openType === 'market' && openSide === 'buy') {
      // Pass cost via params or amount as cost when createMarketBuyOrderRequiresPrice=false
      params.cost = amountOrCost;
      // Also provide price to satisfy createMarketBuyOrderRequiresPrice default true
      priceForCost = entryPrice;
    }
    const spotSymbol = ensureSpotSymbol(exchange, parsed.symbol.toUpperCase());
    const order = await exchange.createOrder(spotSymbol, openType, openSide, amountOrCost, openType === 'limit' ? priceForCost : undefined, params);
    console.log('Spot margin order placed:', order.id || order.clientOrderId || 'unknown');
    return;
  }

  // If resting requested, convert to limit with offset from current
  if (parsed.resting) {
    let offset = parsed.restingDepth || '0.5%';
    let price = entryPrice;
    if (typeof offset === 'string' && offset.endsWith('%')) {
      const pct = parseFloat(offset.replace('%','')) / 100;
      price = side === 'long' ? (entryPrice * (1 - pct)) : (entryPrice * (1 + pct));
    } else {
      const abs = parseFloat(offset);
      price = side === 'long' ? (entryPrice - abs) : (entryPrice + abs);
    }
    if (minPrice !== undefined) price = Math.max(price, minPrice);
    if (maxPrice !== undefined) price = Math.min(price, maxPrice);
    entryPrice = parseFloat(exchange.priceToPrecision(symbol, price));
    openType = 'limit';
  }

  // Prepare preset TP/SL (single attach to open order) unless strict one-way
  const slPrice = parsed.oneWayStrict ? undefined : (parsed.sl ? toNumberMaybePercent(parsed.sl, entryPrice, side === 'long' ? 'long' : 'short') : undefined);
  const firstTp = parsed.oneWayStrict ? undefined : (parsed.tps.length > 0 ? toNumberMaybePercent(parsed.tps[0].target, entryPrice, side === 'long' ? 'long' : 'short') : undefined);

  // Attempt open; fallback to hedged mode if unilateral error
  async function openOrder(paramsExtra = {}) {
    const params = {
      timeInForce: 'GTC',
      marginMode,
      // Only include oneWayMode when strict and not explicitly hedged in paramsExtra
      ...((parsed.oneWayStrict && !paramsExtra.hedged) ? { oneWayMode: true } : {}),
      ...(slPrice ? { stopLoss: { triggerPrice: parseFloat(exchange.priceToPrecision(symbol, slPrice)), type: 'mark_price' } } : {}),
      ...(firstTp ? { takeProfit: { triggerPrice: parseFloat(exchange.priceToPrecision(symbol, firstTp)), type: 'mark_price' } } : {}),
      ...paramsExtra,
    };
    return exchange.createOrder(symbol, openType, openSide, amount, openType === 'limit' ? entryPrice : undefined, params);
  }

  // Dry-run preview (handled earlier)

  // In strict one-way, ensure no opposite positions exist before opening
  if (parsed.oneWayStrict) {
    try {
      const positionsPre = await exchange.fetchPositions([symbol]);
      for (const p of positionsPre) {
        if (!p || !p.contracts || p.contracts <= 0) continue;
        const isOpposite = (side === 'long' && p.side === 'short') || (side === 'short' && p.side === 'long');
        if (isOpposite) {
          const qty = parseFloat(exchange.amountToPrecision(symbol, p.contracts));
          const sideOpp = (p.side === 'long') ? 'sell' : 'buy';
          const closeOpp = await exchange.createOrder(symbol, 'market', sideOpp, qty, undefined, {
            marginMode,
            hedged: false,
            reduceOnly: true,
            clientOrderId: `flatten-opp-${Date.now()}-${p.side}`,
          });
          console.log('Flattened opposite', p.side, 'position:', closeOpp.id || closeOpp.clientOrderId || 'unknown', 'qty:', qty);
        }
      }
    } catch (preErr) {
      console.warn('Pre-open flatten failed:', preErr?.message || preErr);
    }
  }

  let open;
  try {
    open = await openOrder();
    console.log('Opened position:', open.id || open.clientOrderId || 'unknown');
  } catch (err) {
    const msg = String(err?.message || '');
    console.error('Open error:', msg);
    if (msg.includes('unilateral') && !parsed.oneWayStrict) {
      console.warn('Switching to hedged mode...');
      try {
        await exchange.setPositionMode('hedged');
        open = await openOrder({ hedged: true });
        console.log('Opened (hedged):', open.id || open.clientOrderId || 'unknown');
        posMode = 'hedged';
      } catch (e2) {
        throw e2;
      }
    } else if (msg.includes('unilateral') && parsed.oneWayStrict) {
      if (parsed.noHedgedFallback) {
        throw err;
      } else {
        console.warn('Sandbox enforces hedged for this order; switching while preserving one-way semantics (no opposite positions).');
        try {
          await exchange.setPositionMode('hedged');
          // Ensure we do not send oneWayMode param in hedged fallback
          open = await openOrder({ hedged: true });
          console.log('Opened (hedged due to sandbox):', open.id || open.clientOrderId || 'unknown');
          posMode = 'hedged';
        } catch (e3) {
          throw e3;
        }
      }
    } else {
      throw err;
    }
  }

    // Determine available contracts for partial TP sizing
    let availableContractsLong = 0;
    let availableContractsShort = 0;
    try {
      const positionsNow = await exchange.fetchPositions([symbol]);
      for (const p of positionsNow) {
        if (p.side === 'long') availableContractsLong = p.contracts || 0;
        if (p.side === 'short') availableContractsShort = p.contracts || 0;
      }
    } catch {}

    // Place additional TP targets as reduce-only limit orders with optional partial sizes
    const extraTps = parsed.tps.slice(1);
    if (extraTps.length) {
      const baseAmount = side === 'long' ? (availableContractsLong || amount) : (availableContractsShort || amount);
      const perDefault = parseFloat(exchange.amountToPrecision(symbol, baseAmount / extraTps.length));
      for (let i = 0; i < extraTps.length; i++) {
        const tp = extraTps[i];
        try {
          const tpPrice = toNumberMaybePercent(tp.target, entryPrice, side === 'long' ? 'long' : 'short');
          const tpExecSide = side === 'long' ? 'sell' : 'buy';
          let tpSize = perDefault;
          if (tp.size) {
            const isPct = (typeof tp.size === 'string') && tp.size.trim().endsWith('%');
            tpSize = isPct ? (baseAmount * (parseFloat(tp.size.replace('%','')) / 100)) : parseFloat(tp.size);
          }
          const minAmt = market?.limits?.amount?.min || 0;
          const available = side === 'long' ? availableContractsLong : availableContractsShort;
          if (tpSize > available) tpSize = available;
          if (tpSize < minAmt) {
            console.warn('TP size below min; skipping TP:', tpSize, 'min:', minAmt);
            continue;
          }
          tpSize = parseFloat(exchange.amountToPrecision(symbol, tpSize));
          const tpOrder = await exchange.createOrder(symbol, 'limit', tpExecSide, tpSize, parseFloat(exchange.priceToPrecision(symbol, tpPrice)), {
            timeInForce: 'GTC',
            marginMode,
            hedged: posMode === 'hedged',
            reduceOnly: true,
            clientOrderId: `tp-${Date.now()}-${i+1}`,
          });
          console.log('TP reduce-only placed:', tpOrder.id || tpOrder.clientOrderId || 'unknown', 'size:', tpSize, 'price:', tpPrice);
          if (side === 'long') availableContractsLong = Math.max(0, availableContractsLong - tpSize);
          else availableContractsShort = Math.max(0, availableContractsShort - tpSize);
        } catch (tpErr) {
          console.warn('TP reduce-only error:', tpErr?.message || tpErr);
        }
      }
    }

  // Place SL as separate plan if not attached (or always in strict one-way)
  if ((!slPrice && parsed.sl) || (parsed.oneWayStrict && parsed.sl)) {
    try {
      const slp = toNumberMaybePercent(parsed.sl, entryPrice, side === 'long' ? 'long' : 'short');
      const slExecSide = side === 'long' ? 'sell' : 'buy';
      const slParams = { hedged: posMode === 'hedged', stopLossPrice: parseFloat(exchange.priceToPrecision(symbol, slp)) };
      const slOrder = await exchange.createOrder(symbol, 'market', slExecSide, amount, undefined, slParams);
      console.log('SL plan placed:', slOrder.id || slOrder.clientOrderId || 'unknown', 'price:', slp);
    } catch (slErr) {
      console.warn('SL plan error:', slErr?.message || slErr);
    }
  }

  // Summary
  let posSummary;
  let oo;
  try {
    const positions = await exchange.fetchPositions([symbol]);
    posSummary = positions.map(p => ({ symbol: p.symbol, side: p.side, contracts: p.contracts, pnl: p.pnl, leverage: p.leverage }));
    if (!parsed.json) console.log('Positions summary:', posSummary);
  } catch {}
  try {
    const openOrders = await exchange.fetchOpenOrders(symbol);
    oo = openOrders.map(o => ({ id: o.id, side: o.side, type: o.type, price: o.price, amount: o.amount, reduceOnly: o.reduceOnly }));
    if (!parsed.json) console.log('Open orders:', oo);
  } catch {}
  if (parsed.json) {
    const payload = {
      input: cmdText,
      sandbox: useSandbox,
      symbol,
      side,
      leverage: parsed.leverage,
      marginMode,
      positionMode: posMode,
      orderType: openType,
      amount,
      entryPrice,
      resting: parsed.resting,
      restingDepth: parsed.restingDepth,
      positions: posSummary,
      openOrders: oo,
    };
    console.log(JSON.stringify(payload, null, 2));
  }
}

async function main() {
  const input = process.argv.slice(2).join(' ');
  if (!input) {
    console.log('Usage examples:');
    console.log('  node trade-command.js "10x short avax/usdt isolated hedged @ market amount 1 sl 12.5 tp 12.0@50%, 11.5@25%, 11.0@25% sandbox"');
    console.log('  node trade-command.js "5x long btc/usdt cross oneway @ limit 95000 amount 0.001 sl -1% tp 1%, 2%"');
    console.log('  node trade-command.js "3x long btc/usdt @ market amount 0.002 sl 95000 tp 97000, 98000 --dry-run"');
    console.log('  node trade-command.js "flatten btc/usdt sandbox"');
    console.log('  node trade-command.js "cancel tps btc/usdt sandbox"');
    console.log('  node trade-command.js "10x long avax/usdt @ market amount 2 sl 13.0 tp 13.5@25%, 14.0@25%, 14.5@50% --resting"');
    process.exit(0);
  }
  try {
    await executeCommand(input);
  } catch (err) {
    console.error('Command failed:', err?.message || err);
    process.exit(1);
  }
}

main();
