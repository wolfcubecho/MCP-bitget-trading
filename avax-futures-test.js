#!/usr/bin/env node

import dotenv from 'dotenv';
import { BitgetRestClient } from './dist/api/rest-client.js';
import { BitgetAPIError } from './dist/types/bitget.js';

dotenv.config();

async function placeLongAVAX(sizeCandidates = ['1', '0.1', '0.01']) {
  const client = new BitgetRestClient({
    apiKey: process.env.BITGET_API_KEY || '',
    secretKey: process.env.BITGET_SECRET_KEY || '',
    passphrase: process.env.BITGET_PASSPHRASE || '',
    sandbox: process.env.BITGET_SANDBOX === 'true' || true,
    baseUrl: 'https://api.bitget.com',
    wsUrl: 'wss://wspap.bitget.com/v2/ws/public',
  });

  console.log('🔧 Setting leverage 3x for AVAXUSDT...');
  try {
    const ok = await client.setLeverage('AVAXUSDT', 3);
    console.log('Leverage set:', ok);
  } catch (e) {
    console.warn('Leverage set failed (non-fatal):', e?.message || e);
  }

  for (const size of sizeCandidates) {
    console.log(`🚀 Placing AVAXUSDT long market order size=${size}...`);
    try {
      const order = await client.placeOrder({
        symbol: 'AVAXUSDT_UMCBL',
        side: 'buy',
        type: 'market',
        quantity: size,
        tradeSide: 'open',
        marginCoin: 'USDT',
      });
      console.log('✅ Order placed:', order.orderId);
      return true;
    } catch (err) {
      if (err instanceof BitgetAPIError) {
        console.log('API error', { code: err.code, message: err.message });
        if (err.code === '40774') {
          console.error('❌ Unilateral mode error (should be fixed).');
          return false;
        }
        if (err.code === '40762') {
          console.warn('Insufficient balance; trying smaller size.');
          continue;
        }
        // other errors: try next size
        console.warn('Order failed; trying next size.');
        continue;
      } else {
        const msg = err?.message || String(err);
        console.warn('Network/auth error:', msg);
        return false;
      }
    }
  }
  console.error('❌ All size candidates failed to place order.');
  return false;
}

placeLongAVAX().then((ok) => {
  console.log('Result:', ok ? 'PASS' : 'FAIL');
  process.exit(ok ? 0 : 1);
});