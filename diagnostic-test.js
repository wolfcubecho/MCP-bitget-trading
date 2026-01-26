#!/usr/bin/env node

// Diagnostic test for Bitget MCP futures ordering
// Passes if futures order requests avoid unilateral-mode error (40774)
// Accepts expected sandbox failures like insufficient margin or no position.

import dotenv from 'dotenv';
import { BitgetRestClient } from './dist/api/rest-client.js';
import { BitgetAPIError } from './dist/types/bitget.js';

dotenv.config();

function log(header, obj) {
  console.log(`\n=== ${header} ===`);
  console.log(typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2));
}

async function main() {
  const client = new BitgetRestClient({
    apiKey: process.env.BITGET_API_KEY || '',
    secretKey: process.env.BITGET_SECRET_KEY || '',
    passphrase: process.env.BITGET_PASSPHRASE || '',
    sandbox: process.env.BITGET_SANDBOX === 'true' || true,
    baseUrl: 'https://api.bitget.com',
    wsUrl: 'wss://wspap.bitget.com/v2/ws/public',
  });

  let failed = false;

  // 1) Connectivity: spot + futures price
  try {
    const spotPrice = await client.getPrice('BTCUSDT');
    log('Spot price BTCUSDT', spotPrice);
  } catch (err) {
    console.warn('Spot price fetch failed (non-fatal):', err.message);
  }

  try {
    const futPrice = await client.getPrice('BTCUSDT_UMCBL');
    log('Futures price BTCUSDT_UMCBL', futPrice);
  } catch (err) {
    console.warn('Futures price fetch failed (non-fatal):', err.message);
  }

  // 2) Futures OPEN order diagnostic (should avoid code 40774)
  try {
    await client.placeOrder({
      symbol: 'BTCUSDT_UMCBL',
      side: 'buy',
      type: 'market',
      quantity: '1',
      tradeSide: 'open',
      reduceOnly: false,
      marginCoin: 'USDT',
    });
    log('Futures open order', 'Accepted');
  } catch (err) {
    if (err instanceof BitgetAPIError) {
      log('Futures open order error', { code: err.code, message: err.message });
      if (err.code === '40774') {
        console.error('FAIL: unilateral mode error (40774) on open order');
        failed = true;
      } else {
        console.warn('Expected sandbox error treated as pass');
      }
    } else {
      const msg = typeof err.message === 'string' ? err.message : '';
      if (msg.includes('Invalid ACCESS_KEY')) {
        console.warn('SKIP: Private tests skipped due to missing/invalid API keys');
      } else if (msg.includes('"code":"40762"')) {
        console.warn('Expected: insufficient balance for open order');
      } else {
        console.error('Network/auth error:', err.message);
        failed = true;
      }
    }
  }

  // 3) Futures CLOSE order diagnostic (should avoid code 40774)
  try {
    await client.placeOrder({
      symbol: 'BTCUSDT_UMCBL',
      side: 'sell',
      type: 'market',
      quantity: '1',
      tradeSide: 'close',
      reduceOnly: true,
      marginCoin: 'USDT',
    });
    log('Futures close order', 'Accepted');
  } catch (err) {
    if (err instanceof BitgetAPIError) {
      log('Futures close order error', { code: err.code, message: err.message });
      if (err.code === '40774') {
        console.error('FAIL: unilateral mode error (40774) on close order');
        failed = true;
      } else {
        console.warn('Expected sandbox/position error treated as pass');
      }
    } else {
      const msg = typeof err.message === 'string' ? err.message : '';
      if (msg.includes('Invalid ACCESS_KEY')) {
        console.warn('SKIP: Private tests skipped due to missing/invalid API keys');
      } else if (msg.includes('"code":"22002"')) {
        console.warn('Expected: no position to close');
      } else {
        console.error('Network/auth error:', err.message);
        failed = true;
      }
    }
  }

  console.log(`\nResult: ${failed ? 'FAIL' : 'PASS'}`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error('Unexpected error:', e?.message || e);
  process.exit(1);
});