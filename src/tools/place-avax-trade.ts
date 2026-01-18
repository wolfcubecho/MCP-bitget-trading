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

  const symbol = 'AVAXUSDT';
  const totalQty = 232; // AVAX
  const tpPrices = ['14.20', '14.75', '15.50'];
  const slPrice = '13.14';

  // Ensure isolated margin mode before placing orders
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

  // Determine effective margin mode to include in order (Bitget requires marginMode)
  let effectiveMarginMode: 'isolated' | 'crossed' = 'isolated';
  try {
    const marginInfo = await client.getMarginInfo(symbol);
    // Attempt to detect current mode from account info
    const mode = (marginInfo?.marginMode || marginInfo?.assetMode || '').toLowerCase();
    if (mode === 'crossed' || mode === 'isolated') {
      effectiveMarginMode = mode as any;
    }
  } catch {}
  // If we failed to set isolated earlier and current mode is not isolated, fallback to crossed to avoid API 45117
  if (effectiveMarginMode !== 'isolated') {
    console.warn('Account not in isolated; using crossed for order to satisfy API.');
    effectiveMarginMode = 'crossed';
  }

  // Choose market for immediate fill per request allowance
  const openOrder: OrderParams = {
    symbol,
    side: 'buy',
    type: 'market',
    quantity: totalQty.toString(),
    tradeSide: 'open',
    marginCoin: 'USDT',
    timeInForce: 'GTC',
    clientOrderId: `avax-open-${Date.now()}`,
    marginMode: effectiveMarginMode,
  };

  console.log('Placing AVAX LONG (market) ...');
  try {
    const placed = await client.placeOrder(openOrder);
    console.log('Open order result:', placed);
    // Set Stop Loss via TPSL endpoint (position SL, market at trigger)
    try {
      // Use planType pos_loss, market execution by omitting executePrice
      const slOk = await client.placeFuturesTPSL(symbol, {
        planType: 'pos_loss',
        triggerPrice: slPrice,
        holdSide: 'long',
        size: totalQty.toString(),
        triggerType: 'mark_price',
        clientOid: `avax-sl-${Date.now()}`,
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

  // Split TP quantities roughly equally: 77, 77, 78
  const tpQtys = [77, 77, 78];

  for (let i = 0; i < tpPrices.length; i++) {
    const qty = tpQtys[i];
    const price = tpPrices[i];
    try {
      // Place profit plan (multiple partial TPs). Using profit_plan allows multiple TPs.
      const tpOk = await client.placeFuturesTPSL(symbol, {
        planType: 'profit_plan',
        triggerPrice: price,
        holdSide: 'long',
        size: qty.toString(),
        triggerType: 'mark_price',
        clientOid: `avax-tp${i + 1}-${Date.now()}`,
      });
      console.log(`TP${i + 1} TPSL placed:`, tpOk);
    } catch (err: any) {
      console.error(`Failed to place TP${i + 1} TPSL:`, err.message || err);
    }
  }

  console.log('All TP orders attempted; SL handled via TPSL.');

  // Optional: list pending plan orders to verify multiple TP entries
  try {
    const pending = await client.getFuturesPlanOrders(symbol, 'profit_loss');
    console.log('Pending plan/TPSL orders:', JSON.stringify(pending, null, 2));
  } catch (e: any) {
    console.warn('Could not retrieve plan orders:', e.message || e);
  }
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
