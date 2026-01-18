import dotenv from 'dotenv';
import path from 'path';
import { BitgetRestClient } from '../api/rest-client.js';
import { BitgetConfig, OrderParams } from '../types/bitget.js';

// Load local env first, fallback to default .env
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

async function main() {
  const config = getConfig();
  const client = new BitgetRestClient(config);

  console.log('Validating Bitget credentials ...');
  const valid = await client.validateCredentials();
  if (!valid) {
    console.error('Credentials invalid. Ensure BITGET_API_KEY, BITGET_SECRET_KEY, BITGET_PASSPHRASE are set and valid.');
    console.error('Tip: For demo, set BITGET_SANDBOX=true; we send paptrading header automatically.');
    process.exit(1);
    return;
  }

  const symbol = 'BTCUSDT';
  const totalQtyEnv = process.env.BITGET_BTC_TEST_SIZE;
  const totalQty = totalQtyEnv ? parseFloat(totalQtyEnv) : 0.01; // BTC size, default 0.01

  // Entry zone (93,800–94,500): using market entry for test execution
  const tpPrices = ['96500', '99500', '104500'];
  const slPrice = '89800';

  console.log('Ensuring isolated margin mode: cancel orders, close positions, then set mode ...');
  try {
    const cancelled = await client.cancelAllFuturesOrders(symbol);
    if (!cancelled) console.warn('Cancel-all did not confirm, continuing.');
  } catch (e: any) {
    console.warn('Cancel-all raised an error, continuing:', e.message || e);
  }

  try {
    const closed = await client.closeAllPositions(symbol);
    if (!closed) console.warn('Close-all did not confirm, continuing.');
  } catch (e: any) {
    console.warn('Close-all raised an error, continuing:', e.message || e);
  }

  try {
    const ok = await client.setMarginMode('isolated', symbol);
    console.log('Set margin mode to isolated:', ok);
  } catch (e: any) {
    console.warn('Could not set margin mode to isolated:', e.message || e);
    console.warn('Proceeding with existing account margin mode.');
  }

  // Determine effective margin mode
  let effectiveMarginMode: 'isolated' | 'crossed' = 'isolated';
  try {
    const marginInfo = await client.getMarginInfo(symbol);
    const mode = (marginInfo?.marginMode || marginInfo?.assetMode || '').toLowerCase();
    if (mode === 'crossed' || mode === 'isolated') {
      effectiveMarginMode = mode as any;
    }
  } catch {}
  if (effectiveMarginMode !== 'isolated') {
    console.warn('Account not in isolated; using crossed for order to satisfy API.');
    effectiveMarginMode = 'crossed';
  }

  const openOrder: OrderParams = {
    symbol,
    side: 'buy',
    type: 'market',
    quantity: totalQty.toFixed(3),
    tradeSide: 'open',
    marginCoin: 'USDT',
    timeInForce: 'GTC',
    clientOrderId: `btc-open-${Date.now()}`,
    marginMode: effectiveMarginMode,
  };

  console.log('Placing BTC LONG (market) ...');
  try {
    const placed = await client.placeOrder(openOrder);
    console.log('Open order result:', placed);
    // SL via TPSL (position stop loss)
    try {
      const slOk = await client.placeFuturesTPSL(symbol, {
        planType: 'pos_loss',
        triggerPrice: slPrice,
        holdSide: 'long',
        size: totalQty.toFixed(3),
        triggerType: 'mark_price',
        clientOid: `btc-sl-${Date.now()}`,
        marginMode: effectiveMarginMode,
      });
      console.log('SL set via TPSL:', slOk);
    } catch (e: any) {
      console.error('Failed to set SL via TPSL:', e.message || e);
    }
  } catch (err: any) {
    console.error('Failed to open position:', err.message || err);
    process.exitCode = 1;
    return;
  }

  // Split TP quantities: 40%, 30%, 30% of total
  const tpQtys = [
    +(totalQty * 0.4).toFixed(3),
    +(totalQty * 0.3).toFixed(3),
    +(totalQty * 0.3).toFixed(3),
  ];
  // Adjust rounding drift to match total
  const sumTp = tpQtys.reduce((a, b) => a + b, 0);
  if (sumTp !== +totalQty.toFixed(3)) {
    const diff = +totalQty.toFixed(3) - sumTp;
    tpQtys[tpQtys.length - 1] = +(tpQtys[tpQtys.length - 1] + diff).toFixed(3);
  }

  for (let i = 0; i < tpPrices.length; i++) {
    const qty = tpQtys[i];
    const price = tpPrices[i];
    try {
      const tpOk = await client.placeFuturesTPSL(symbol, {
        planType: 'profit_plan',
        triggerPrice: price,
        holdSide: 'long',
        size: qty.toFixed(3),
        triggerType: 'mark_price',
        clientOid: `btc-tp${i + 1}-${Date.now()}`,
        marginMode: effectiveMarginMode,
      });
      console.log(`TP${i + 1} TPSL placed:`, tpOk);
    } catch (err: any) {
      console.error(`Failed to place TP${i + 1} TPSL:`, err.message || err);
    }
  }

  console.log('All TP orders attempted; SL handled via TPSL.');

  // Status summary
  try {
    const positions = await client.getFuturesPositions(symbol);
    const plans = await client.getFuturesPlanOrders(symbol, 'profit_loss');
    const sl = plans.find((p: any) => p.planType === 'pos_loss');
    const tps = plans.filter((p: any) => p.planType === 'profit_plan');
    const summary = {
      symbol,
      positions,
      stopLoss: sl ? {
        triggerPrice: sl.triggerPrice,
        holdSide: sl.holdSide,
        size: sl.size,
      } : null,
      takeProfits: tps.map((p: any) => ({ triggerPrice: p.triggerPrice, size: p.size, holdSide: p.holdSide })),
    };
    console.log('Futures status summary:', JSON.stringify(summary, null, 2));
  } catch (e: any) {
    console.warn('Could not summarize futures status:', e.message || e);
  }
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
