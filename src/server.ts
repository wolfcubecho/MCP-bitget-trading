#!/usr/bin/env node
/**
 * Bitget Trading MCP Server
 * Comprehensive trading server for Bitget exchange
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
  CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';
import dotenv from 'dotenv';
import './utils/stdio-protect.js';
import { BitgetRestClient } from './api/rest-client.js';
import { BitgetConfig } from './types/bitget.js';
import { logger } from './utils/logger.js';
import { createBitgetWebSocketClient, BitgetWebSocketClient } from './api/websocket-client.js';
import { cacheManager } from './utils/cache.js';
import { logHOBs, logSnapshot } from './utils/telemetry.js';
import {
  GetPriceSchema,
  GetTickerSchema,
  GetOrderBookSchema,
  GetCandlesSchema,
  PlaceOrderSchema,
  CancelOrderSchema,
  GetOrdersSchema,
  GetBalanceSchema,
  GetPositionsSchema,
  SetLeverageSchema,
  GetMarginInfoSchema,
  PlaceTPSLSchema,
  GetPlanOrdersSchema,
  CancelPlanOrderSchema,
  ModifyTPSLSchema,
  SetMarginModeSchema,
  CloseAllPositionsSchema,
  GetCurrentFundingRateSchema,
  GetHistoricFundingRatesSchema,
  GetFuturesContractsSchema,
  PlacePlanOrderSchema,
  GetFuturesStatusSchema,
} from './types/mcp.js';

// Load environment variables
dotenv.config();

class BitgetMCPServer {
  private server: Server;
  private bitgetClient: BitgetRestClient;
  private wsClient: BitgetWebSocketClient;

  constructor() {
    // Initialize MCP server
    this.server = new Server(
      {
        name: 'bitget-trading',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    // Initialize Bitget clients
    this.bitgetClient = new BitgetRestClient(this.config);
    this.wsClient = createBitgetWebSocketClient(this.config);

    this.setupToolHandlers();
    this.setupWebSocketHandlers();

    // Diagnostic log to test file writing
    logger.info('Bitget MCP server started (diagnostic log for file write test)');
  }

  /**
   * Initialize and validate the server configuration
   */
  async initialize(): Promise<void> {
    logger.info('Initializing Bitget MCP Server...');
    
    // Validate API credentials if they are provided
    if (this.config.apiKey && this.config.secretKey && this.config.passphrase) {
      logger.info('Validating API credentials...');
      const isValid = await this.bitgetClient.validateCredentials();
      if (!isValid) {
        logger.warn('API credentials validation failed. Trading operations may not work.');
      }
    } else {
      logger.warn('API credentials not provided. Only public market data will be available.');
    }
    
    logger.info('Bitget MCP Server initialized successfully');
  }

  private get config(): BitgetConfig {
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

  private setupToolHandlers(): void {
    // List all available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          // Market Data Tools
          {
            name: 'getPrice',
            description: 'Get current price for a trading pair (spot or futures)',
            inputSchema: {
              type: 'object',
              properties: {
                symbol: { type: 'string', description: 'Trading pair symbol (e.g., BTCUSDT for spot, BTCUSDT_UMCBL for futures)' }
              },
              required: ['symbol']
            },
          },
          {
            name: 'getTicker',
            description: 'Get full ticker information for a trading pair',
            inputSchema: {
              type: 'object',
              properties: {
                symbol: { type: 'string', description: 'Trading pair symbol' },
                compact: { type: 'boolean', description: 'Return trimmed ticker' }
              },
              required: ['symbol']
            },
          },
          {
            name: 'getOrderBook',
            description: 'Get order book (market depth) for a trading pair',
            inputSchema: {
              type: 'object',
              properties: {
                symbol: { type: 'string', description: 'Trading pair symbol' },
                depth: { type: 'number', description: 'Order book depth (default: 20)' },
                compact: { type: 'boolean', description: 'Trim to top-of-book levels' }
              },
              required: ['symbol']
            },
          },
          {
            name: 'getCandles',
            description: 'Get historical candlestick/OHLCV data',
            inputSchema: {
              type: 'object',
              properties: {
                symbol: { type: 'string', description: 'Trading pair symbol' },
                interval: { type: 'string', enum: ['1m', '5m', '15m', '30m', '1h', '4h', '1d'], description: 'Candle interval' },
                limit: { type: 'number', description: 'Number of candles (default: 100)' },
                compact: { type: 'boolean', description: 'Return essential OHLCV fields' }
              },
              required: ['symbol', 'interval']
            },
          },
                    {
                      name: 'getMarketSnapshot',
                      description: 'Aggregated market snapshot with OHLCV analysis and optional CMC metadata',
                      inputSchema: {
                        type: 'object',
                        properties: {
                          symbol: { type: 'string', description: 'Trading pair symbol (e.g., BTCUSDT)' },
                          interval: { type: 'string', enum: ['1m','3m','5m','15m','30m','1h','4h','6h','12h','1d'], description: 'Interval to analyze' },
                          limit: { type: 'number', description: 'Candles to analyze (default 150)' },
                          includeCMC: { type: 'boolean', description: 'Include CMC metadata if API key provided' },
                          compact: { type: 'boolean', description: 'Return trimmed summary (default true)' },
                          emas: { type: 'array', items: { type: 'number' }, description: 'EMA periods (e.g., [20,50,200])' },
                          atrPeriod: { type: 'number', description: 'ATR period (e.g., 14)' },
                          fvgLookback: { type: 'number', description: 'Bars to scan for FVGs' },
                        },
                        required: ['symbol','interval']
                      },
                    },
                    {
                      name: 'getMarketSnapshots',
                      description: 'Compute snapshots for multiple symbols in one call (efficient analysis)',
                      inputSchema: {
                        type: 'object',
                        properties: {
                          symbols: { type: 'array', items: { type: 'string' }, description: 'Symbols to analyze' },
                          interval: { type: 'string', enum: ['1m','3m','5m','15m','30m','1h','4h','6h','12h','1d'], description: 'Interval to analyze' },
                          limit: { type: 'number', description: 'Candles to analyze (default 150)' },
                          compact: { type: 'boolean', description: 'Trim results' },
                          emas: { type: 'array', items: { type: 'number' }, description: 'EMA periods' },
                          atrPeriod: { type: 'number', description: 'ATR period' },
                          fvgLookback: { type: 'number', description: 'Bars to scan for FVGs' },
                        },
                        required: ['symbols','interval']
                      },
                    },
          
          {
            name: 'getBalance',
            description: 'Get account balance information',
            inputSchema: {
              type: 'object',
              properties: {
                asset: { type: 'string', description: 'Specific asset to query' }
              },
              required: []
            },
          },
          {
            name: 'placeOrder',
            description: 'Place a new buy or sell order (automatically detects spot vs futures)',
            inputSchema: {
              type: 'object',
              properties: {
                symbol: { type: 'string', description: 'Trading pair symbol (e.g., BTCUSDT for spot, BTCUSDT_UMCBL for futures)' },
                side: { type: 'string', enum: ['buy', 'sell'], description: 'Order side' },
                type: { type: 'string', enum: ['market', 'limit'], description: 'Order type' },
                quantity: { type: 'string', description: 'Order quantity (in base currency for spot, in contracts for futures)' },
                price: { type: 'string', description: 'Order price (required for limit orders)' },
                timeInForce: { type: 'string', enum: ['GTC', 'IOC', 'FOK'], description: 'Time in force' },
                clientOrderId: { type: 'string', description: 'Client order ID' },
                reduceOnly: { type: 'boolean', description: 'Reduce only flag for futures' },
                tradeSide: { type: 'string', enum: ['open', 'close'], description: 'Unilateral position action (futures): open or close' },
                marginMode: { type: 'string', enum: ['crossed', 'isolated'], description: 'Margin mode for futures (default: crossed)' },
                marginCoin: { type: 'string', description: 'Margin coin for futures (default: USDT)' }
              },
              required: ['symbol', 'side', 'type', 'quantity']
            },
          },
          {
            name: 'cancelOrder',
            description: 'Cancel an existing order',
            inputSchema: {
              type: 'object',
              properties: {
                orderId: { type: 'string', description: 'Order ID to cancel' },
                symbol: { type: 'string', description: 'Trading pair symbol' }
              },
              required: ['orderId', 'symbol']
            },
          },
          {
            name: 'getOrders',
            description: 'Get current open orders',
            inputSchema: {
              type: 'object',
              properties: {
                symbol: { type: 'string', description: 'Filter by symbol' },
                status: { type: 'string', enum: ['open', 'filled', 'cancelled'], description: 'Filter by status' }
              },
              required: []
            },
          },
          {
            name: 'getPositions',
            description: 'Get current futures positions',
            inputSchema: {
              type: 'object',
              properties: {
                symbol: { type: 'string', description: 'Filter by symbol' }
              },
              required: []
            },
          },
          {
            name: 'setLeverage',
            description: 'Set leverage for futures trading',
            inputSchema: {
              type: 'object',
              properties: {
                symbol: { type: 'string', description: 'Trading pair symbol' },
                leverage: { type: 'number', minimum: 1, maximum: 125, description: 'Leverage value (1-125)' }
              },
              required: ['symbol', 'leverage']
            },
          },
          {
            name: 'getMarginInfo',
            description: 'Get margin account information',
            inputSchema: {
              type: 'object',
              properties: {
                symbol: { type: 'string', description: 'Filter by symbol' }
              },
              required: []
            },
          },
          {
            name: 'connectWebSocket',
            description: 'Connect to WebSocket for real-time data',
            inputSchema: {
              type: 'object',
              properties: {},
              required: []
            },
          },
          {
            name: 'disconnectWebSocket',
            description: 'Disconnect from WebSocket',
            inputSchema: {
              type: 'object',
              properties: {},
              required: []
            },
          },
          {
            name: 'subscribeToTicker',
            description: 'Subscribe to real-time ticker updates',
            inputSchema: {
              type: 'object',
              properties: {
                symbol: { type: 'string', description: 'Trading pair symbol' },
                instType: { type: 'string', enum: ['SPOT', 'UMCBL'], description: 'Instrument type (default: SPOT)' }
              },
              required: ['symbol']
            },
          },
          {
            name: 'subscribeToOrderBook',
            description: 'Subscribe to real-time order book updates',
            inputSchema: {
              type: 'object',
              properties: {
                symbol: { type: 'string', description: 'Trading pair symbol' },
                instType: { type: 'string', enum: ['SPOT', 'UMCBL'], description: 'Instrument type (default: SPOT)' }
              },
              required: ['symbol']
            },
          },
          {
            name: 'unsubscribeFromChannel',
            description: 'Unsubscribe from a WebSocket channel',
            inputSchema: {
              type: 'object',
              properties: {
                channel: { type: 'string', description: 'Channel name (ticker, books, etc.)' },
                symbol: { type: 'string', description: 'Trading pair symbol' },
                instType: { type: 'string', enum: ['SPOT', 'UMCBL'], description: 'Instrument type (default: SPOT)' }
              },
              required: ['channel', 'symbol']
            },
          },
          {
            name: 'getWebSocketStatus',
            description: 'Get WebSocket connection status',
            inputSchema: {
              type: 'object',
              properties: {},
              required: []
            },
          },
          // Futures TPSL / Plan Orders
          {
            name: 'placeTPSL',
            description: 'Place a futures TP/SL (TPSL) trigger order',
            inputSchema: {
              type: 'object',
              properties: {
                symbol: { type: 'string', description: 'Trading pair symbol (e.g., AVAXUSDT)' },
                planType: { type: 'string', enum: ['pos_profit', 'pos_loss', 'profit_plan', 'loss_plan', 'moving_plan'], description: 'TPSL plan type' },
                triggerPrice: { type: 'string', description: 'Trigger price for TP/SL' },
                triggerType: { type: 'string', enum: ['fill_price', 'mark_price'], description: 'Trigger type (default: mark_price)' },
                executePrice: { type: 'string', description: 'Execution price for limit (omit for market)' },
                holdSide: { type: 'string', enum: ['long', 'short', 'buy', 'sell'], description: 'Position side to apply' },
                size: { type: 'string', description: 'Quantity/size for TPSL' },
                clientOid: { type: 'string', description: 'Client OID for TPSL order' }
              },
              required: ['symbol', 'planType', 'triggerPrice', 'holdSide', 'size']
            },
          },
          {
            name: 'getPlanOrders',
            description: 'List pending futures plan orders (including TPSL)',
            inputSchema: {
              type: 'object',
              properties: {
                symbol: { type: 'string', description: 'Filter by symbol (e.g., AVAXUSDT)' },
                planType: { type: 'string', enum: ['normal_plan', 'track_plan', 'profit_loss'], description: 'Plan type filter (default: profit_loss)' }
              },
              required: []
            },
          },
          {
            name: 'cancelPlanOrder',
            description: 'Cancel a futures plan order (by orderId or clientOid)',
            inputSchema: {
              type: 'object',
              properties: {
                symbol: { type: 'string', description: 'Trading pair symbol (optional)' },
                orderId: { type: 'string', description: 'Plan order ID to cancel (optional)' },
                clientOid: { type: 'string', description: 'Plan order client OID to cancel (optional)' },
                planType: { type: 'string', enum: ['normal_plan', 'track_plan', 'profit_loss'], description: 'Plan type (default: profit_loss)' }
              },
              required: []
            },
          },
          {
            name: 'modifyTPSL',
            description: 'Modify futures TP/SL prices on existing position/order',
            inputSchema: {
              type: 'object',
              properties: {
                symbol: { type: 'string', description: 'Trading pair symbol (e.g., AVAXUSDT)' },
                stopSurplusPrice: { type: 'string', description: 'Take profit price to set/modify' },
                stopLossPrice: { type: 'string', description: 'Stop loss price to set/modify' },
              },
              required: ['symbol']
            },
          },
          // Futures account & risk tools
          {
            name: 'setMarginMode',
            description: 'Set futures margin mode (isolated or crossed)',
            inputSchema: {
              type: 'object',
              properties: {
                symbol: { type: 'string', description: 'Trading pair symbol (optional)' },
                marginMode: { type: 'string', enum: ['isolated', 'crossed'], description: 'Margin mode to set' }
              },
              required: ['marginMode']
            },
          },
          {
            name: 'closeAllPositions',
            description: 'Close all futures positions (optionally for a single symbol)',
            inputSchema: {
              type: 'object',
              properties: {
                symbol: { type: 'string', description: 'Trading pair symbol to close (optional)' }
              },
              required: []
            },
          },
          {
            name: 'getCurrentFundingRate',
            description: 'Get current funding rate for a futures symbol',
            inputSchema: {
              type: 'object',
              properties: {
                symbol: { type: 'string', description: 'Trading pair symbol (e.g., AVAXUSDT)' }
              },
              required: ['symbol']
            },
          },
          {
            name: 'getHistoricFundingRates',
            description: 'Get historical funding rates for a futures symbol',
            inputSchema: {
              type: 'object',
              properties: {
                symbol: { type: 'string', description: 'Trading pair symbol (e.g., AVAXUSDT)' }
              },
              required: ['symbol']
            },
          },
          {
            name: 'getFuturesContracts',
            description: 'List futures contracts configuration',
            inputSchema: {
              type: 'object',
              properties: {
                productType: { type: 'string', enum: ['USDT-FUTURES'], description: 'Product type (default: USDT-FUTURES)' }
              },
              required: []
            },
          },
          {
            name: 'placePlanOrder',
            description: 'Place a futures plan order (profit/loss/moving)',
            inputSchema: {
              type: 'object',
              properties: {
                symbol: { type: 'string', description: 'Trading pair symbol (e.g., AVAXUSDT)' },
                planType: { type: 'string', enum: ['profit_plan', 'loss_plan', 'moving_plan'], description: 'Plan order type' },
                triggerPrice: { type: 'string', description: 'Trigger price' },
                triggerType: { type: 'string', enum: ['fill_price', 'mark_price'], description: 'Trigger type (default: mark_price)' },
                executePrice: { type: 'string', description: 'Execution price for limit (omit for market)' },
                holdSide: { type: 'string', enum: ['long', 'short', 'buy', 'sell'], description: 'Position side' },
                size: { type: 'string', description: 'Quantity/size' },
                clientOid: { type: 'string', description: 'Client OID' },
              },
              required: ['symbol', 'planType', 'triggerPrice', 'holdSide', 'size']
            },
          },
          {
            name: 'placeEntryWithTPSLPlans',
            description: 'Place an entry order then attach SL and multiple TP plans in one call',
            inputSchema: {
              type: 'object',
              properties: {
                symbol: { type: 'string', description: 'Trading pair symbol (e.g., AVAXUSDT)' },
                side: { type: 'string', enum: ['buy', 'sell'], description: 'Entry side' },
                type: { type: 'string', enum: ['market', 'limit'], description: 'Entry order type' },
                quantity: { type: 'string', description: 'Entry quantity' },
                price: { type: 'string', description: 'Entry price (limit only)' },
                marginCoin: { type: 'string', description: 'Margin coin (default: USDT)' },
                marginMode: { type: 'string', enum: ['isolated', 'crossed'], description: 'Order margin mode' },
                setMarginMode: { type: 'boolean', description: 'Set account margin mode before placing entry' },
                stopLoss: {
                  type: 'object',
                  properties: { triggerPrice: { type: 'string', description: 'SL trigger price' } },
                },
                takeProfits: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      triggerPrice: { type: 'string', description: 'TP trigger price' },
                      size: { type: 'string', description: 'Partial size for TP' },
                    },
                    required: ['triggerPrice', 'size'],
                  },
                  description: 'Array of partial TP profit_plan entries'
                },
                triggerType: { type: 'string', enum: ['fill_price', 'mark_price'], description: 'Trigger type (default: mark_price)' },
                compact: { type: 'boolean', description: 'Return trimmed summary only' },
              },
              required: ['symbol', 'side', 'type', 'quantity']
            },
          },
          {
            name: 'getFuturesStatus',
            description: 'Summarize current futures position, SL (pos_loss), and TP plan orders',
            inputSchema: {
              type: 'object',
              properties: {
                symbol: { type: 'string', description: 'Trading pair symbol (optional)' },
                compact: { type: 'boolean', description: 'Return trimmed summary only' }
              },
              required: []
            },
          },
        ],
      };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          // Market Data
          case 'getPrice': {
            const { symbol } = GetPriceSchema.parse(args);
            const price = await this.bitgetClient.getPrice(symbol);
            return {
              content: [
                {
                  type: 'text',
                  text: `Current price for ${symbol}: $${price}`,
                },
              ],
            } as CallToolResult;
          }

          case 'getTicker': {
            const { symbol, compact } = GetTickerSchema.parse(args);
            const ticker = await this.bitgetClient.getTicker(symbol);
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(compact ? {
                    symbol: ticker.symbol,
                    last: ticker.last,
                    bid: ticker.bid,
                    ask: ticker.ask,
                    changePercent24h: ticker.changePercent24h,
                    ts: ticker.timestamp,
                  } : ticker, null, 2),
                },
              ],
            } as CallToolResult;
          }

          case 'getOrderBook': {
            const { symbol, depth = 20, compact } = GetOrderBookSchema.parse(args);
            const orderBook = await this.bitgetClient.getOrderBook(symbol, depth);
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(compact ? {
                    symbol: orderBook.symbol,
                    bids: orderBook.bids.slice(0, Math.min(20, orderBook.bids.length)),
                    asks: orderBook.asks.slice(0, Math.min(20, orderBook.asks.length)),
                    timestamp: orderBook.timestamp,
                  } : orderBook, null, 2),
                },
              ],
            } as CallToolResult;
          }

          case 'getCandles': {
            const { symbol, interval, limit = 100, compact } = GetCandlesSchema.parse(args);
            const candles = await this.bitgetClient.getCandles(symbol, interval, limit);
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(compact ? candles.map(c => ({
                    t: c.timestamp,
                    o: c.open,
                    h: c.high,
                    l: c.low,
                    c: c.close,
                    v: c.volume,
                  })) : candles, null, 2),
                },
              ],
            } as CallToolResult;
          }
          case 'getMarketSnapshot': {
                        // --- HOB/telemetry filtering logic ---
                        // TODO: Replace with actual hidden order block detection logic
                        let hiddenOrderBlocks: any[] = [];
                        // Filtering logic for advanced telemetry
                        let hobFiltered = hiddenOrderBlocks.filter(hob => {
                          if (typeof hob.qualityScore === 'number' && hob.qualityScore < minQuality) return false;
                          if (requireLTFConfirmations && !hob.ltfConfirmed) return false;
                          if (excludeInvalidated && hob.invalidated) return false;
                          if (onlyFullyMitigated && !hob.fullyMitigated) return false;
                          if (onlyVeryStrong && !(hob.isVeryStrong || (hob.qualityScore && hob.qualityScore >= veryStrongMinQuality))) return false;
                          return true;
                        });
            const { symbol, interval, limit = 150, includeCMC = false, compact = true, emas = [20,50,200], atrPeriod = 14, fvgLookback = 60, minQuality = 0.6, requireLTFConfirmations = false, excludeInvalidated = true, onlyFullyMitigated = false, veryStrongMinQuality = 0.75, onlyVeryStrong = false, telemetry = false } = (await import('./types/mcp.js')).GetMarketSnapshotSchema.parse(args);
            const normalizeInterval = (iv: string) => (iv === '2d' ? '1d' : iv === '4d' ? '1d' : iv === '2w' ? '1w' : iv);
            const candles = await this.bitgetClient.getCandles(symbol, interval, limit);
            const closes = candles.map(c => parseFloat(c.close));
            const highs = candles.map(c => parseFloat(c.high));
            const lows = candles.map(c => parseFloat(c.low));
            const opens = candles.map(c => parseFloat(c.open));
            const volumes = candles.map(c => parseFloat(c.volume));
            const timestamps = candles.map(c => c.timestamp);

            const pivots = [] as Array<{ idx: number; type: 'H'|'L'; price: number }>;
            for (let i = 1; i < candles.length - 1; i++) {
              if (highs[i] > highs[i-1] && highs[i] > highs[i+1]) pivots.push({ idx: i, type: 'H', price: highs[i] });
              if (lows[i] < lows[i-1] && lows[i] < lows[i+1]) pivots.push({ idx: i, type: 'L', price: lows[i] });
            }
            const lastPivot = pivots[pivots.length - 1];
            // BOS detection: last close crossing prior swing
            let bos: 'up' | 'down' | null = null;
            const lastClose = closes[closes.length - 1];
            const prevHigh = Math.max(...highs.slice(0, highs.length - 1));
            const prevLow = Math.min(...lows.slice(0, lows.length - 1));
            if (lastClose > prevHigh) bos = 'up'; else if (lastClose < prevLow) bos = 'down';

            // Simple FVG detection (last 50 bars)
            const fvg: Array<{ type: 'bull'|'bear'; from: number; to: number; startIdx: number }>= [];
            for (let i = Math.max(2, candles.length - (fvgLookback + 2)); i < candles.length; i++) {
              // Bullish FVG: low[i] > high[i-2]
              if (lows[i] > highs[i-2]) fvg.push({ type: 'bull', from: highs[i-2], to: lows[i], startIdx: i-2 });
              // Bearish FVG: high[i] < low[i-2]
              if (highs[i] < lows[i-2]) fvg.push({ type: 'bear', from: highs[i], to: lows[i-2], startIdx: i-2 });
            }

            // Simple moving averages for bias
            const sma = (arr: number[], n: number) => {
              if (arr.length < n) return null as number | null;
              let sum = 0; for (let i = arr.length - n; i < arr.length; i++) sum += arr[i];
              return sum / n;
            };
            const sma50 = sma(closes, 50);
            const sma200 = sma(closes, 200);
            const trend = sma50 && sma200 ? (sma50 > sma200 ? 'up' : 'down') : null;

            // EMA calculations
            const calcEMA = (arr: number[], n: number) => {
              if (arr.length < n) return null as number | null;
              const k = 2 / (n + 1);
              let ema = arr[0];
              for (let i = 1; i < arr.length; i++) ema = arr[i] * k + ema * (1 - k);
              return ema;
            };
            const emaValues: Record<string, number | null> = {};
            for (const p of emas) emaValues[`ema${p}`] = calcEMA(closes, p);

            // ATR calculation (Wilder's smoothing approximation)
            const tr: number[] = [];
            for (let i = 0; i < candles.length; i++) {
              const hl = highs[i] - lows[i];
              const hc = i > 0 ? Math.abs(highs[i] - closes[i-1]) : 0;
              const lc = i > 0 ? Math.abs(lows[i] - closes[i-1]) : 0;
              tr.push(Math.max(hl, hc, lc));
            }
            const rma = (arr: number[], n: number) => {
              if (arr.length < n) return null as number | null;
              let sum = 0; for (let i = 0; i < n; i++) sum += arr[i];
              let val = sum / n;
              const alpha = 1 / n;
              for (let i = n; i < arr.length; i++) val = alpha * arr[i] + (1 - alpha) * val;
              return val;
            };
            const atr = rma(tr, atrPeriod);

            // RSI(14) using Wilder's smoothing
            const periodRSI = 14;
            const deltas: number[] = [];
            for (let i = 1; i < closes.length; i++) deltas.push(closes[i] - closes[i-1]);
            const gains = deltas.map(d => (d > 0 ? d : 0));
            const losses = deltas.map(d => (d < 0 ? -d : 0));
            const avgGain = rma(gains, periodRSI);
            const avgLoss = rma(losses, periodRSI);
            let rsi: number | null = null;
            if (avgGain !== null && avgLoss !== null) {
              if (avgLoss === 0) rsi = 100; else if (avgGain === 0) rsi = 0; else {
                const rs = (avgGain as number) / (avgLoss as number);
                rsi = 100 - 100 / (1 + rs);
              }
            }

            // Liquidity zones: cluster equal highs/lows using ATR-based tolerance
            const tolerance = atr ? atr * 0.1 : (closes[closes.length - 1] * 0.001);
            const pivotHighs = pivots.filter(p => p.type === 'H');
            const pivotLows = pivots.filter(p => p.type === 'L');
            const clusterLevels = (points: Array<{ idx: number; price: number }>) => {
              const sorted = points.slice().sort((a, b) => a.price - b.price);
              const clusters: Array<{ level: number; count: number; indices: number[] }> = [];
              for (const pt of sorted) {
                const last = clusters[clusters.length - 1];
                if (last && Math.abs(pt.price - last.level) <= tolerance) {
                  // update cluster level as average
                  const newCount = last.count + 1;
                  const newLevel = (last.level * last.count + pt.price) / newCount;
                  last.level = newLevel;
                  last.count = newCount;
                  last.indices.push(pt.idx);
                } else {
                  clusters.push({ level: pt.price, count: 1, indices: [pt.idx] });
                }
              }
              return clusters.filter(c => c.count >= 2);
            };
            const liquidityZones = {
              highs: clusterLevels(pivotHighs.map(ph => ({ idx: ph.idx, price: ph.price }))),
              lows: clusterLevels(pivotLows.map(pl => ({ idx: pl.idx, price: pl.price }))),
            };

            // Order Block detection: last opposite candle before impulsive BOS
            const orderBlocks: Array<{ type: 'bull'|'bear'; idx: number; open: number; high: number; low: number; close: number }> = [];
            const lookbackOB = Math.min(candles.length - 1, 60);
            if (bos === 'up') {
              for (let i = candles.length - 3; i >= candles.length - lookbackOB; i--) {
                if (opens[i] > closes[i]) { // bearish candle before up move
                  // confirm displacement: next 2 bars up or large range
                  const upMomentum = (closes[i+1] > closes[i]) && (closes[i+2] >= closes[i+1]);
                  const brokeHigh = lastClose > prevHigh;
                  if (upMomentum || brokeHigh) {
                    orderBlocks.push({ type: 'bull', idx: i, open: opens[i], high: highs[i], low: lows[i], close: closes[i] });
                    break;
                  }
                }
              }
            } else if (bos === 'down') {
              for (let i = candles.length - 3; i >= candles.length - lookbackOB; i--) {
                if (opens[i] < closes[i]) { // bullish candle before down move
                  const downMomentum = (closes[i+1] < closes[i]) && (closes[i+2] <= closes[i+1]);
                  const brokeLow = lastClose < prevLow;
                  if (downMomentum || brokeLow) {
                    orderBlocks.push({ type: 'bear', idx: i, open: opens[i], high: highs[i], low: lows[i], close: closes[i] });
                    break;
                  }
                }
              }
            }

            // Fallbacks when BOS is null: displacement- and pivot-based
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
              if (lastH) {
                for (let i = lastH.idx - 1; i >= Math.max(0, lastH.idx - 10); i--) { if (opens[i] > closes[i]) { orderBlocks.push({ type: 'bull', idx: i, open: opens[i], high: highs[i], low: lows[i], close: closes[i] }); break; } }
              }
              if (orderBlocks.length === 0 && lastL) {
                for (let i = lastL.idx - 1; i >= Math.max(0, lastL.idx - 10); i--) { if (opens[i] < closes[i]) { orderBlocks.push({ type: 'bear', idx: i, open: opens[i], high: highs[i], low: lows[i], close: closes[i] }); break; } }
              }
            }

            let cmc: any = null;
            if (includeCMC && process.env.COINMARKET_API_KEY) {
              try {
                const res = await fetch(`https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest?symbol=${symbol.replace('USDT','')}&convert=USD`, { headers: { 'X-CMC_PRO_API_KEY': process.env.COINMARKET_API_KEY as string, 'Accept': 'application/json' } });
                if (res.ok) cmc = await res.json();
              } catch {}
            }

            // VWAP over provided window using typical price
            let vwap: number | null = null;
            if (candles.length > 0) {
              let tpVolSum = 0;
              let volSum = 0;
              for (let i = 0; i < candles.length; i++) {
                const tp = (highs[i] + lows[i] + closes[i]) / 3;
                const v = volumes[i] || 0;
                tpVolSum += tp * v;
                volSum += v;
              }
              vwap = volSum > 0 ? tpVolSum / volSum : null;
            }

            // Daily/Weekly opens and Previous Day High/Low (UTC-based)
            const startOfUTC = (ts: number) => Date.UTC(new Date(ts).getUTCFullYear(), new Date(ts).getUTCMonth(), new Date(ts).getUTCDate());
            const now = timestamps[timestamps.length - 1];
            const todayStart = startOfUTC(now);
            const yesterdayStart = todayStart - 24 * 60 * 60 * 1000;
            const utcDay = new Date(now).getUTCDay(); // 0=Sun
            const daysSinceMonday = (utcDay + 6) % 7; // Mon=0
            const weekStart = todayStart - daysSinceMonday * 24 * 60 * 60 * 1000;

            let dailyOpen: number | null = null;
            let weeklyOpen: number | null = null;
            let prevDayHigh: number | null = null;
            let prevDayLow: number | null = null;

            for (let i = 0; i < timestamps.length; i++) {
              const d0 = startOfUTC(timestamps[i]);
              if (dailyOpen === null && d0 >= todayStart) dailyOpen = opens[i];
              if (weeklyOpen === null && d0 >= weekStart) weeklyOpen = opens[i];
            }
            // Previous day metrics
            let pdh = -Infinity;
            let pdl = Infinity;
            for (let i = 0; i < timestamps.length; i++) {
              const d0 = startOfUTC(timestamps[i]);
              if (d0 >= yesterdayStart && d0 < todayStart) {
                if (highs[i] > pdh) pdh = highs[i];
                if (lows[i] < pdl) pdl = lows[i];
              }
            }
            prevDayHigh = Number.isFinite(pdh) ? pdh : null;
            prevDayLow = Number.isFinite(pdl) ? pdl : null;

            // SFP detection using last pivots and a tolerance
            const sfpTolerance = atr ? atr * 0.1 : (closes[closes.length - 1] * 0.001);
            const lastHighPivot = [...pivots].reverse().find(p => p.type === 'H');
            const lastLowPivot = [...pivots].reverse().find(p => p.type === 'L');
            let sfp: { bullish: boolean; bearish: boolean; last?: { type: 'bullish'|'bearish'; idx: number; level: number } } = { bullish: false, bearish: false };
            const checkRange = Math.min(candles.length - 1, 10);
            for (let i = candles.length - checkRange; i < candles.length; i++) {
              if (lastHighPivot && highs[i] > lastHighPivot.price + sfpTolerance && closes[i] < lastHighPivot.price) {
                sfp.bearish = true; sfp.last = { type: 'bearish', idx: i, level: lastHighPivot.price }; break;
              }
              if (lastLowPivot && lows[i] < lastLowPivot.price - sfpTolerance && closes[i] > lastLowPivot.price) {
                sfp.bullish = true; sfp.last = { type: 'bullish', idx: i, level: lastLowPivot.price }; break;
              }
            }

            const snapshot = compact ? {
              symbol,
              interval,
              latest: { close: lastClose, high: highs[highs.length-1], low: lows[lows.length-1], ts: candles[candles.length-1]?.timestamp },
              pivots: pivots.slice(-6),
              bos,
              fvg: fvg.slice(-5),
              trend,
              sma50,
              sma200,
              atr,
              rsi,
              orderBlocks: orderBlocks,
              liquidityZones,
              vwap,
              dailyOpen,
              weeklyOpen,
              prevDayHigh,
              prevDayLow,
              sfp,
              ...emaValues,
              cmc: cmc ? { status: cmc.status, data: (cmc.data && cmc.data[symbol.replace('USDT','')]) ? {
                market_cap: cmc.data[symbol.replace('USDT','')].quote?.USD?.market_cap,
                percent_change_24h: cmc.data[symbol.replace('USDT','')].quote?.USD?.percent_change_24h,
                rank: cmc.data[symbol.replace('USDT','')].cmc_rank,
              } : null } : null,
            } : { symbol, interval, candles, pivots, fvg, bos, trend, sma50, sma200, atr, rsi, orderBlocks, liquidityZones, vwap, dailyOpen, weeklyOpen, prevDayHigh, prevDayLow, sfp, emaValues, cmc };

            if (telemetry) {
              try {
                logHOBs(symbol, interval, lastClose, hobFiltered);
                const numPivotHighs = pivots.filter(p=>p.type==='H').length;
                const numPivotLows = pivots.filter(p=>p.type==='L').length;
                const bullFvgCount = fvg.filter(g=>g.type==='bull').length;
                const bearFvgCount = fvg.filter(g=>g.type==='bear').length;
                const highsClusterCount = Array.isArray(liquidityZones?.highs) ? liquidityZones.highs.length : 0;
                const lowsClusterCount = Array.isArray(liquidityZones?.lows) ? liquidityZones.lows.length : 0;
                const hobCount = hobFiltered.length;
                const veryStrongCount = hobFiltered.filter((h:any)=>h.isVeryStrong).length;
                const avgHobQuality = hobCount ? (hobFiltered.reduce((s:any,h:any)=>s+(h.qualityScore||0),0)/hobCount) : 0;
                const maxHobQuality = hobCount ? Math.max(...hobFiltered.map((h:any)=>h.qualityScore||0)) : 0;
                logSnapshot(symbol, interval, lastClose, {
                  bos,
                  trend,
                  rsi,
                  atr,
                  vwapPresent: vwap!=null,
                  numPivotHighs,
                  numPivotLows,
                  bullFvgCount,
                  bearFvgCount,
                  highsClusterCount,
                  lowsClusterCount,
                  orderBlocksCount: orderBlocks.length,
                  hiddenOrderBlocksCount: hobCount,
                  hiddenOrderBlocksVeryStrongCount: veryStrongCount,
                  avgHobQuality,
                  maxHobQuality,
                  sfp,
                });
              } catch {}
            }
            return { content: [ { type: 'text', text: JSON.stringify(snapshot, null, 2) } ] } as CallToolResult;
          }

          case 'getMarketSnapshots': {
            const { symbols, interval, limit = 150, compact = true, emas = [20,50,200], atrPeriod = 14, fvgLookback = 60, minQuality = 0.6, requireLTFConfirmations = false, excludeInvalidated = true, onlyFullyMitigated = false, veryStrongMinQuality = 0.75, onlyVeryStrong = false, telemetry = false } = (await import('./types/mcp.js')).GetMarketSnapshotsSchema.parse(args);
            const normalizeInterval = (iv: string) => (iv === '2d' ? '1d' : iv === '4d' ? '1d' : iv === '2w' ? '1w' : iv);
            const results: any[] = [];
            for (const symbol of symbols) {
                            // --- HOB/telemetry filtering logic for batch ---
                            // TODO: Replace with actual hidden order block detection logic
                            let hiddenOrderBlocks: any[] = [];
                            let hobFiltered = hiddenOrderBlocks.filter(hob => {
                              if (typeof hob.qualityScore === 'number' && hob.qualityScore < minQuality) return false;
                              if (requireLTFConfirmations && !hob.ltfConfirmed) return false;
                              if (excludeInvalidated && hob.invalidated) return false;
                              if (onlyFullyMitigated && !hob.fullyMitigated) return false;
                              if (onlyVeryStrong && !(hob.isVeryStrong || (hob.qualityScore && hob.qualityScore >= veryStrongMinQuality))) return false;
                              return true;
                            });
              const candles = await this.bitgetClient.getCandles(symbol, interval, limit);
              if (!candles.length) { results.push({ symbol, error: 'no_candles' }); continue; }
              const closes = candles.map(c => parseFloat(c.close));
              const highs = candles.map(c => parseFloat(c.high));
              const lows = candles.map(c => parseFloat(c.low));
              const opens = candles.map(c => parseFloat(c.open));
              const volumes = candles.map(c => parseFloat(c.volume));
              const timestamps = candles.map(c => c.timestamp);

              const lastClose = closes[closes.length - 1];
              const prevHigh = Math.max(...highs.slice(0, highs.length - 1));
              const prevLow = Math.min(...lows.slice(0, lows.length - 1));
              let bos: 'up'|'down'|null = null; if (lastClose > prevHigh) bos = 'up'; else if (lastClose < prevLow) bos = 'down';

              const pivots: Array<{ idx: number; type: 'H'|'L'; price: number }> = [];
              for (let i = 1; i < candles.length - 1; i++) {
                if (highs[i] > highs[i-1] && highs[i] > highs[i+1]) pivots.push({ idx: i, type: 'H', price: highs[i] });
                if (lows[i] < lows[i-1] && lows[i] < lows[i+1]) pivots.push({ idx: i, type: 'L', price: lows[i] });
              }

              const sma = (arr: number[], n: number) => {
                if (arr.length < n) return null as number | null;
                let sum = 0; for (let i = arr.length - n; i < arr.length; i++) sum += arr[i];
                return sum / n;
              };
              const sma50 = sma(closes, 50);
              const sma200 = sma(closes, 200);
              const trend = sma50 && sma200 ? (sma50 > sma200 ? 'up' : 'down') : null;

              const calcEMA = (arr: number[], n: number) => {
                if (arr.length < n) return null as number | null;
                const k = 2 / (n + 1);
                let ema = arr[0];
                for (let i = 1; i < arr.length; i++) ema = arr[i] * k + ema * (1 - k);
                return ema;
              };
              const emaValues: Record<string, number | null> = {};
              for (const p of emas) emaValues[`ema${p}`] = calcEMA(closes, p);

              const tr: number[] = [];
              for (let i = 0; i < candles.length; i++) {
                const hl = highs[i] - lows[i];
                const hc = i > 0 ? Math.abs(highs[i] - closes[i-1]) : 0;
                const lc = i > 0 ? Math.abs(lows[i] - closes[i-1]) : 0;
                tr.push(Math.max(hl, hc, lc));
              }
              const rma = (arr: number[], n: number) => {
                if (arr.length < n) return null as number | null;
                let sum = 0; for (let i = 0; i < n; i++) sum += arr[i];
                let val = sum / n;
                const alpha = 1 / n;
                for (let i = n; i < arr.length; i++) val = alpha * arr[i] + (1 - alpha) * val;
                return val;
              };
              const atr = rma(tr, atrPeriod);

              const periodRSI = 14;
              const deltas: number[] = [];
              for (let i = 1; i < closes.length; i++) deltas.push(closes[i] - closes[i-1]);
              const gains = deltas.map(d => (d > 0 ? d : 0));
              const losses = deltas.map(d => (d < 0 ? -d : 0));
              const avgGain = rma(gains, periodRSI);
              const avgLoss = rma(losses, periodRSI);
              let rsi: number | null = null;
              if (avgGain !== null && avgLoss !== null) {
                if (avgLoss === 0) rsi = 100; else if (avgGain === 0) rsi = 0; else {
                  const rs = (avgGain as number) / (avgLoss as number);
                  rsi = 100 - 100 / (1 + rs);
                }
              }

              const fvg: Array<{ type: 'bull'|'bear'; from: number; to: number; startIdx: number }> = [];
              for (let i = Math.max(2, candles.length - (fvgLookback + 2)); i < candles.length; i++) {
                if (lows[i] > highs[i-2]) fvg.push({ type: 'bull', from: highs[i-2], to: lows[i], startIdx: i-2 });
                if (highs[i] < lows[i-2]) fvg.push({ type: 'bear', from: highs[i], to: lows[i-2], startIdx: i-2 });
              }

              // Liquidity zones via clustering
              const tolerance = atr ? atr * 0.1 : (closes[closes.length - 1] * 0.001);
              const pivotHighs = pivots.filter(p => p.type === 'H');
              const pivotLows = pivots.filter(p => p.type === 'L');
              const clusterLevels = (points: Array<{ idx: number; price: number }>) => {
                const sorted = points.slice().sort((a, b) => a.price - b.price);
                const clusters: Array<{ level: number; count: number; indices: number[] }> = [];
                for (const pt of sorted) {
                  const last = clusters[clusters.length - 1];
                  if (last && Math.abs(pt.price - last.level) <= tolerance) {
                    const newCount = last.count + 1;
                    const newLevel = (last.level * last.count + pt.price) / newCount;
                    last.level = newLevel;
                    last.count = newCount;
                    last.indices.push(pt.idx);
                  } else {
                    clusters.push({ level: pt.price, count: 1, indices: [pt.idx] });
                  }
                }
                return clusters.filter(c => c.count >= 2);
              };
              const liquidityZones = {
                highs: clusterLevels(pivotHighs.map(ph => ({ idx: ph.idx, price: ph.price }))),
                lows: clusterLevels(pivotLows.map(pl => ({ idx: pl.idx, price: pl.price }))),
              };

              // Order blocks via BOS context
              const orderBlocks: Array<{ type: 'bull'|'bear'; idx: number; open: number; high: number; low: number; close: number }> = [];
              const lookbackOB = Math.min(candles.length - 1, 60);
              if (bos === 'up') {
                for (let i = candles.length - 3; i >= candles.length - lookbackOB; i--) {
                  if (opens[i] > closes[i]) {
                    const upMomentum = (closes[i+1] > closes[i]) && (closes[i+2] >= closes[i+1]);
                    const brokeHigh = lastClose > prevHigh;
                    if (upMomentum || brokeHigh) { orderBlocks.push({ type: 'bull', idx: i, open: opens[i], high: highs[i], low: lows[i], close: closes[i] }); break; }
                  }
                }
              } else if (bos === 'down') {
                for (let i = candles.length - 3; i >= candles.length - lookbackOB; i--) {
                  if (opens[i] < closes[i]) {
                    const downMomentum = (closes[i+1] < closes[i]) && (closes[i+2] <= closes[i+1]);
                    const brokeLow = lastClose < prevLow;
                    if (downMomentum || brokeLow) { orderBlocks.push({ type: 'bear', idx: i, open: opens[i], high: highs[i], low: lows[i], close: closes[i] }); break; }
                  }
                }
              }

              // Fallbacks when BOS is null: displacement- and pivot-based
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

              // VWAP over window
              let vwap: number | null = null;
              if (candles.length > 0) {
                let tpVolSum = 0; let volSum = 0;
                for (let i = 0; i < candles.length; i++) {
                  const tp = (highs[i] + lows[i] + closes[i]) / 3;
                  const v = volumes[i] || 0; tpVolSum += tp * v; volSum += v;
                }
                vwap = volSum > 0 ? tpVolSum / volSum : null;
              }

              // Daily/Weekly opens and prev day hi/lo
              const startOfUTC = (ts: number) => Date.UTC(new Date(ts).getUTCFullYear(), new Date(ts).getUTCMonth(), new Date(ts).getUTCDate());
              const now = timestamps[timestamps.length - 1];
              const todayStart = startOfUTC(now);
              const yesterdayStart = todayStart - 24 * 60 * 60 * 1000;
              const utcDay = new Date(now).getUTCDay();
              const daysSinceMonday = (utcDay + 6) % 7;
              const weekStart = todayStart - daysSinceMonday * 24 * 60 * 60 * 1000;
              let dailyOpen: number | null = null; let weeklyOpen: number | null = null; let prevDayHigh: number | null = null; let prevDayLow: number | null = null;
              for (let i = 0; i < timestamps.length; i++) {
                const d0 = startOfUTC(timestamps[i]);
                if (dailyOpen === null && d0 >= todayStart) dailyOpen = opens[i];
                if (weeklyOpen === null && d0 >= weekStart) weeklyOpen = opens[i];
              }
              let pdh = -Infinity; let pdl = Infinity;
              for (let i = 0; i < timestamps.length; i++) {
                const d0 = startOfUTC(timestamps[i]);
                if (d0 >= yesterdayStart && d0 < todayStart) { if (highs[i] > pdh) pdh = highs[i]; if (lows[i] < pdl) pdl = lows[i]; }
              }
              prevDayHigh = Number.isFinite(pdh) ? pdh : null; prevDayLow = Number.isFinite(pdl) ? pdl : null;

              // SFP detection
              const lastHighPivot = [...pivots].reverse().find(p => p.type === 'H');
              const lastLowPivot = [...pivots].reverse().find(p => p.type === 'L');
              let sfp: { bullish: boolean; bearish: boolean; last?: { type: 'bullish'|'bearish'; idx: number; level: number } } = { bullish: false, bearish: false };
              const checkRange = Math.min(candles.length - 1, 10);
              for (let i = candles.length - checkRange; i < candles.length; i++) {
                if (lastHighPivot && highs[i] > lastHighPivot.price + tolerance && closes[i] < lastHighPivot.price) { sfp.bearish = true; sfp.last = { type: 'bearish', idx: i, level: lastHighPivot.price }; break; }
                if (lastLowPivot && lows[i] < lastLowPivot.price - tolerance && closes[i] > lastLowPivot.price) { sfp.bullish = true; sfp.last = { type: 'bullish', idx: i, level: lastLowPivot.price }; break; }
              }

              /* Duplicate liquidity/OB block removed: already computed above */

              const latest = { close: lastClose, high: highs[highs.length-1], low: lows[lows.length-1], ts: candles[candles.length-1]?.timestamp };
              if (telemetry) {
                try {
                  logHOBs(symbol, interval, lastClose, hobFiltered);
                  const numPivotHighs = pivots.filter(p=>p.type==='H').length;
                  const numPivotLows = pivots.filter(p=>p.type==='L').length;
                  const bullFvgCount = fvg.filter(g=>g.type==='bull').length;
                  const bearFvgCount = fvg.filter(g=>g.type==='bear').length;
                  const highsClusterCount = Array.isArray(liquidityZones?.highs) ? liquidityZones.highs.length : 0;
                  const lowsClusterCount = Array.isArray(liquidityZones?.lows) ? liquidityZones.lows.length : 0;
                  const hobCount = hobFiltered.length;
                  const veryStrongCount = hobFiltered.filter((h:any)=>h.isVeryStrong).length;
                  const avgHobQuality = hobCount ? (hobFiltered.reduce((s:any,h:any)=>s+(h.qualityScore||0),0)/hobCount) : 0;
                  const maxHobQuality = hobCount ? Math.max(...hobFiltered.map((h:any)=>h.qualityScore||0)) : 0;
                  logSnapshot(symbol, interval, lastClose, {
                    bos,
                    trend,
                    rsi,
                    atr,
                    vwapPresent: vwap!=null,
                    numPivotHighs,
                    numPivotLows,
                    bullFvgCount,
                    bearFvgCount,
                    highsClusterCount,
                    lowsClusterCount,
                    orderBlocksCount: orderBlocks.length,
                    hiddenOrderBlocksCount: hobCount,
                    hiddenOrderBlocksVeryStrongCount: veryStrongCount,
                    avgHobQuality,
                    maxHobQuality,
                    sfp,
                  });
                } catch {}
              }
              results.push(compact ? { symbol, interval, latest, bos, pivots: pivots.slice(-4), trend, sma50, sma200, atr, rsi, orderBlocks, hiddenOrderBlocks: hobFiltered, liquidityZones, vwap, dailyOpen, weeklyOpen, prevDayHigh, prevDayLow, sfp, ...emaValues, fvg: fvg.slice(-3) } : { symbol, interval, candles, bos, pivots, trend, sma50, sma200, atr, rsi, orderBlocks, hiddenOrderBlocks: hobFiltered, liquidityZones, vwap, dailyOpen, weeklyOpen, prevDayHigh, prevDayLow, sfp, emaValues, fvg });
            }
            return { content: [ { type: 'text', text: JSON.stringify(results, null, 2) } ] } as CallToolResult;
          }

          

          // Account
          case 'getBalance': {
            logger.info('getBalance called', { args });
            let asset;
            try {
              asset = GetBalanceSchema.parse(args).asset;
            } catch (parseErr) {
              logger.error('Failed to parse getBalance args', { error: parseErr, args });
              return {
                content: [
                  { type: 'text', text: `[Bitget MCP] Failed to parse getBalance args: ${parseErr}` }
                ],
                isError: true
              } as CallToolResult;
            }
            try {
              const balance = await this.bitgetClient.getBalance(asset);
              logger.info('getBalance result', { asset, balance });
              return {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify(balance, null, 2),
                  },
                ],
              } as CallToolResult;
            } catch (err) {
              logger.error('getBalance error', { error: err, asset });
              return {
                content: [
                  { type: 'text', text: `[Bitget MCP] getBalance error: ${err}` }
                ],
                isError: true
              } as CallToolResult;
            }
          }

          // Trading
          case 'placeOrder': {
            let orderParams;
            try {
              orderParams = PlaceOrderSchema.parse(args);
            } catch (parseErr) {
              logger.error('Failed to parse placeOrder args', { error: parseErr, args });
              return {
                content: [
                  { type: 'text', text: `[Bitget MCP] Failed to parse placeOrder args: ${parseErr}` }
                ],
                isError: true
              } as CallToolResult;
            }
            logger.info('Received placeOrder request', { orderParams });
            // Determine if this is a futures order
            const isFutures = orderParams.marginCoin || orderParams.marginMode || orderParams.symbol.includes('_UMCBL') || orderParams.symbol.includes('_');
            logger.info('Order type detected', { isFutures, symbol: orderParams.symbol });
            try {
              const order = await this.bitgetClient.placeOrder(orderParams);
              logger.info('placeOrder result', { order });
              return {
                content: [
                  {
                    type: 'text',
                    text: `Order placed successfully (${isFutures ? 'futures' : 'spot'}):\n${JSON.stringify(order, null, 2)}`,
                  },
                ],
              } as CallToolResult;
            } catch (err) {
              const errMsg = (err && typeof err === 'object' && 'stack' in err) ? (err as any).stack : String(err);
              logger.error('placeOrder error', { error: errMsg, orderParams });
              return {
                content: [
                  {
                    type: 'text',
                    text: `[Bitget MCP] placeOrder error: ${errMsg}`,
                  },
                ],
                isError: true
              } as CallToolResult;
            }
          }

          case 'cancelOrder': {
            logger.info('cancelOrder called', { args });
            let orderId, symbol;
            try {
              ({ orderId, symbol } = CancelOrderSchema.parse(args));
            } catch (parseErr) {
              logger.error('Failed to parse cancelOrder args', { error: parseErr, args });
              return {
                content: [
                  { type: 'text', text: `[Bitget MCP] Failed to parse cancelOrder args: ${parseErr}` }
                ],
                isError: true
              } as CallToolResult;
            }
            try {
              const success = await this.bitgetClient.cancelOrder(orderId, symbol);
              logger.info('cancelOrder result', { orderId, symbol, success });
              return {
                content: [
                  {
                    type: 'text',
                    text: success ? `Order ${orderId} cancelled successfully` : `Failed to cancel order ${orderId}`,
                  },
                ],
              } as CallToolResult;
            } catch (err) {
              logger.error('cancelOrder error', { error: err, orderId, symbol });
              return {
                content: [
                  { type: 'text', text: `[Bitget MCP] cancelOrder error: ${err}` }
                ],
                isError: true
              } as CallToolResult;
            }
          }

          case 'getOrders': {
            logger.info('getOrders called', { args });
            let symbol, status;
            try {
              ({ symbol, status } = GetOrdersSchema.parse(args));
            } catch (parseErr) {
              logger.error('Failed to parse getOrders args', { error: parseErr, args });
              return {
                content: [
                  { type: 'text', text: `[Bitget MCP] Failed to parse getOrders args: ${parseErr}` }
                ],
                isError: true
              } as CallToolResult;
            }
            try {
              const orders = await this.bitgetClient.getOrders(symbol, status);
              logger.info('getOrders result', { symbol, status, orders });
              return {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify(orders, null, 2),
                  },
                ],
              } as CallToolResult;
            } catch (err) {
              logger.error('getOrders error', { error: err, symbol, status });
              return {
                content: [
                  { type: 'text', text: `[Bitget MCP] getOrders error: ${err}` }
                ],
                isError: true
              } as CallToolResult;
            }
          }

          // Futures
          case 'getPositions': {
            logger.info('getPositions called', { args });
            let symbol;
            try {
              ({ symbol } = GetPositionsSchema.parse(args));
            } catch (parseErr) {
              logger.error('Failed to parse getPositions args', { error: parseErr, args });
              return {
                content: [
                  { type: 'text', text: `[Bitget MCP] Failed to parse getPositions args: ${parseErr}` }
                ],
                isError: true
              } as CallToolResult;
            }
            try {
              const positions = await this.bitgetClient.getFuturesPositions(symbol);
              logger.info('getPositions result', { symbol, positions });
              return {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify(positions, null, 2),
                  },
                ],
              } as CallToolResult;
            } catch (err) {
              logger.error('getPositions error', { error: err, symbol });
              return {
                content: [
                  { type: 'text', text: `[Bitget MCP] getPositions error: ${err}` }
                ],
                isError: true
              } as CallToolResult;
            }
          }

          case 'setLeverage': {
            const { symbol, leverage } = SetLeverageSchema.parse(args);
            const success = await this.bitgetClient.setLeverage(symbol, leverage);
            return {
              content: [
                {
                  type: 'text',
                  text: success 
                    ? `Leverage set to ${leverage}x for ${symbol}` 
                    : `Failed to set leverage for ${symbol}`,
                },
              ],
            } as CallToolResult;
          }

          case 'getMarginInfo': {
            const { symbol } = GetMarginInfoSchema.parse(args);
            const marginInfo = await this.bitgetClient.getMarginInfo(symbol);
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(marginInfo, null, 2),
                },
              ],
            } as CallToolResult;
          }

          // WebSocket Tools
          case 'connectWebSocket': {
            try {
              await this.wsClient.connect();
              return {
                content: [
                  {
                    type: 'text',
                    text: 'WebSocket connected successfully',
                  },
                ],
              } as CallToolResult;
            } catch (error: any) {
              return {
                content: [
                  {
                    type: 'text',
                    text: `Failed to connect WebSocket: ${error.message}`,
                  },
                ],
                isError: true,
              } as CallToolResult;
            }
          }

          case 'disconnectWebSocket': {
            this.wsClient.disconnect();
            return {
              content: [
                {
                  type: 'text',
                  text: 'WebSocket disconnected',
                },
              ],
            } as CallToolResult;
          }

          case 'subscribeToTicker': {
            const { symbol, instType = 'SPOT' } = args as any;
            this.wsClient.subscribe('ticker', symbol, instType);
            return {
              content: [
                {
                  type: 'text',
                  text: `Subscribed to ticker updates for ${symbol} (${instType})`,
                },
              ],
            } as CallToolResult;
          }

          case 'subscribeToOrderBook': {
            const { symbol, instType = 'SPOT' } = args as any;
            this.wsClient.subscribe('books', symbol, instType);
            return {
              content: [
                {
                  type: 'text',
                  text: `Subscribed to order book updates for ${symbol} (${instType})`,
                },
              ],
            } as CallToolResult;
          }

          case 'unsubscribeFromChannel': {
            const { channel, symbol, instType = 'SPOT' } = args as any;
            this.wsClient.unsubscribe(channel, symbol, instType);
            return {
              content: [
                {
                  type: 'text',
                  text: `Unsubscribed from ${channel} for ${symbol} (${instType})`,
                },
              ],
            } as CallToolResult;
          }

          case 'getWebSocketStatus': {
            const status = {
              connected: this.wsClient.isWebSocketConnected(),
              subscriptions: this.wsClient.getSubscriptionCount(),
            };
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(status, null, 2),
                },
              ],
            } as CallToolResult;
          }

          // Futures TPSL / Plan Orders
          case 'placeTPSL': {
            const params = PlaceTPSLSchema.parse(args);
            const ok = await this.bitgetClient.placeFuturesTPSL(params.symbol, {
              planType: params.planType,
              triggerPrice: params.triggerPrice,
              triggerType: params.triggerType,
              executePrice: params.executePrice,
              holdSide: params.holdSide,
              size: params.size,
              clientOid: params.clientOid,
              marginMode: params.marginMode,
            });
            return {
              content: [
                { type: 'text', text: ok ? 'TPSL placed successfully' : 'Failed to place TPSL' },
              ],
            } as CallToolResult;
          }

          case 'getPlanOrders': {
            const params = GetPlanOrdersSchema.parse(args);
            const list = await this.bitgetClient.getFuturesPlanOrders(params.symbol, params.planType || 'profit_loss');
            return {
              content: [
                { type: 'text', text: JSON.stringify(list, null, 2) },
              ],
            } as CallToolResult;
          }

          case 'cancelPlanOrder': {
            const params = CancelPlanOrderSchema.parse(args);
            const ok = await this.bitgetClient.cancelFuturesPlanOrder({
              symbol: params.symbol,
              orderId: params.orderId,
              clientOid: params.clientOid,
              planType: params.planType || 'profit_loss',
            });
            return {
              content: [
                { type: 'text', text: ok ? 'Plan order cancelled successfully' : 'Failed to cancel plan order' },
              ],
            } as CallToolResult;
          }

          case 'modifyTPSL': {
            const params = ModifyTPSLSchema.parse(args);
            const ok = await this.bitgetClient.modifyFuturesTPSL(params.symbol, {
              stopSurplusPrice: params.stopSurplusPrice,
              stopLossPrice: params.stopLossPrice,
            });
            return {
              content: [
                { type: 'text', text: ok ? 'TPSL modified successfully' : 'Failed to modify TPSL' },
              ],
            } as CallToolResult;
          }

          // Futures account & risk tools
          case 'setMarginMode': {
            const params = SetMarginModeSchema.parse(args);
            const ok = await this.bitgetClient.setMarginMode(params.marginMode, params.symbol);
            return {
              content: [
                { type: 'text', text: ok ? `Margin mode set to ${params.marginMode}` : 'Failed to set margin mode' },
              ],
            } as CallToolResult;
          }

          case 'closeAllPositions': {
            const params = CloseAllPositionsSchema.parse(args);
            const ok = await this.bitgetClient.closeAllPositions(params.symbol);
            return {
              content: [
                { type: 'text', text: ok ? 'Positions closed successfully' : 'Failed to close positions' },
              ],
            } as CallToolResult;
          }

          case 'getCurrentFundingRate': {
            const params = GetCurrentFundingRateSchema.parse(args);
            const data = await this.bitgetClient.getCurrentFundingRate(params.symbol);
            return {
              content: [
                { type: 'text', text: JSON.stringify(data, null, 2) },
              ],
            } as CallToolResult;
          }

          case 'getHistoricFundingRates': {
            const params = GetHistoricFundingRatesSchema.parse(args);
            const data = await this.bitgetClient.getHistoricFundingRates(params.symbol);
            return {
              content: [
                { type: 'text', text: JSON.stringify(data, null, 2) },
              ],
            } as CallToolResult;
          }

          case 'getFuturesContracts': {
            const _ = GetFuturesContractsSchema.parse(args);
            const data = await this.bitgetClient.getFuturesContracts();
            return {
              content: [
                { type: 'text', text: JSON.stringify(data, null, 2) },
              ],
            } as CallToolResult;
          }

          case 'placePlanOrder': {
            const params = PlacePlanOrderSchema.parse(args);
            const ok = await this.bitgetClient.placeFuturesPlanOrder(params.symbol, {
              planType: params.planType,
              triggerPrice: params.triggerPrice,
              triggerType: params.triggerType,
              executePrice: params.executePrice,
              holdSide: params.holdSide,
              size: params.size,
              clientOid: params.clientOid,
              marginMode: params.marginMode,
            });
            return {
              content: [
                { type: 'text', text: ok ? 'Plan order placed successfully' : 'Failed to place plan order' },
              ],
            } as CallToolResult;
          }

          case 'getFuturesStatus': {
            const { symbol, compact } = GetFuturesStatusSchema.parse(args);
            const positions = await this.bitgetClient.getFuturesPositions(symbol);
            const plans = await this.bitgetClient.getFuturesPlanOrders(symbol, 'profit_loss');

            // Filter plans for SL (pos_loss) and profit plans
            const sl = plans.find((p: any) => p.planType === 'pos_loss');
            const profitPlans = plans.filter((p: any) => p.planType === 'profit_plan');

            const summary = compact ? {
              symbol: symbol || 'ALL',
              positions: positions.map(p => ({ symbol: p.symbol, side: p.side, size: p.size, entryPrice: p.entryPrice, markPrice: p.markPrice })),
              stopLoss: sl ? { triggerPrice: sl.triggerPrice, size: sl.size, holdSide: sl.holdSide } : null,
              takeProfits: profitPlans.map((p: any) => ({ triggerPrice: p.triggerPrice, size: p.size, holdSide: p.holdSide })),
            } : {
              symbol: symbol || 'ALL',
              positions,
              stopLoss: sl ? {
                planType: sl.planType,
                triggerPrice: sl.triggerPrice,
                holdSide: sl.holdSide,
                size: sl.size,
                orderId: sl.orderId || sl.planId || sl.id,
              } : null,
              takeProfits: profitPlans.map((p: any) => ({
                triggerPrice: p.triggerPrice,
                size: p.size,
                holdSide: p.holdSide,
                orderId: p.orderId || p.planId || p.id,
              })),
            };
            return {
              content: [
                { type: 'text', text: JSON.stringify(summary, null, 2) },
              ],
            } as CallToolResult;
          }

          case 'placeEntryWithTPSLPlans': {
            const params = (await import('./types/mcp.js')).PlaceEntryWithTPSLPlansSchema.parse(args);
            const { symbol, side, type, quantity, price, marginCoin = 'USDT', marginMode, setMarginMode = false, stopLoss, takeProfits = [], triggerType = 'mark_price', compact } = params;

            // Optionally set account margin mode first
            if (setMarginMode && marginMode) {
              try { await this.bitgetClient.setMarginMode(marginMode, symbol); } catch {}
            }

            // Determine effective margin mode for order
            let effectiveMarginMode = marginMode as ('isolated' | 'crossed' | undefined);
            if (!effectiveMarginMode) {
              try {
                const info = await this.bitgetClient.getMarginInfo(symbol);
                const mode = (info?.marginMode || info?.assetMode || '').toLowerCase();
                if (mode === 'isolated' || mode === 'crossed') effectiveMarginMode = mode as any;
              } catch {}
            }

            // Place entry order
            const order = await this.bitgetClient.placeOrder({
              symbol,
              side,
              type,
              quantity,
              price,
              tradeSide: 'open',
              marginCoin,
              marginMode: effectiveMarginMode,
              timeInForce: type === 'limit' ? 'GTC' : undefined,
              clientOrderId: `${symbol.toLowerCase()}-entry-${Date.now()}`,
            } as any);

            // Attach SL
            if (stopLoss?.triggerPrice) {
              await this.bitgetClient.placeFuturesTPSL(symbol, {
                planType: 'pos_loss',
                triggerPrice: stopLoss.triggerPrice,
                triggerType,
                holdSide: side === 'buy' ? 'long' : 'short',
                size: quantity,
                clientOid: `${symbol.toLowerCase()}-sl-${Date.now()}`,
                marginMode: effectiveMarginMode,
              });
            }

            // Attach TPs
            for (const [i, tp] of takeProfits.entries()) {
              await this.bitgetClient.placeFuturesTPSL(symbol, {
                planType: 'profit_plan',
                triggerPrice: tp.triggerPrice,
                triggerType,
                holdSide: side === 'buy' ? 'long' : 'short',
                size: tp.size,
                clientOid: `${symbol.toLowerCase()}-tp${i + 1}-${Date.now()}`,
                marginMode: effectiveMarginMode,
              });
            }

            // Summary
            const positions = await this.bitgetClient.getFuturesPositions(symbol);
            const plans = await this.bitgetClient.getFuturesPlanOrders(symbol, 'profit_loss');
            const sl = plans.find((p: any) => p.planType === 'pos_loss');
            const profitPlans = plans.filter((p: any) => p.planType === 'profit_plan');

            const summary = compact ? {
              symbol,
              order: { orderId: order.orderId, side: order.side, type: order.type, quantity: order.quantity, price: order.price },
              positions: positions.map(p => ({ symbol: p.symbol, side: p.side, size: p.size, entryPrice: p.entryPrice, markPrice: p.markPrice })),
              stopLoss: sl ? { triggerPrice: sl.triggerPrice, size: sl.size } : null,
              takeProfits: profitPlans.map((p: any) => ({ triggerPrice: p.triggerPrice, size: p.size })),
            } : {
              symbol,
              order,
              positions,
              stopLoss: sl || null,
              takeProfits: profitPlans,
            };

            return {
              content: [ { type: 'text', text: JSON.stringify(summary, null, 2) } ],
            } as CallToolResult;
          }


          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${errorMessage}`,
            },
          ],
          isError: true,
        } as CallToolResult;
      }
    });
  }

  /**
   * Setup WebSocket event handlers
   */
  private setupWebSocketHandlers(): void {
    this.wsClient.on('connected', () => {
      logger.info('WebSocket connected');
    });

    this.wsClient.on('disconnected', ({ code, reason }) => {
      logger.warn('WebSocket disconnected', { code, reason });
    });

    this.wsClient.on('error', (error) => {
      logger.error('WebSocket error', { error: error.message });
    });

    this.wsClient.on('data', (message) => {
      logger.debug('Received WebSocket data', {
        channel: message.arg.channel,
        symbol: message.arg.instId,
        dataLength: message.data.length
      });
    });

    this.wsClient.on('subscribed', (arg) => {
      logger.info('WebSocket subscription confirmed', arg);
    });

    this.wsClient.on('subscriptionError', (error) => {
      logger.error('WebSocket subscription error', error);
    });

    this.wsClient.on('maxReconnectsReached', () => {
      logger.error('WebSocket max reconnection attempts reached');
    });
  }

  async run(): Promise<void> {
    await this.initialize();
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    logger.info('Bitget Trading MCP Server running on stdio');
    
    // Setup graceful shutdown
    this.setupGracefulShutdown();
  }

  /**
   * Setup graceful shutdown handlers
   */
  private setupGracefulShutdown(): void {
    const shutdown = () => {
      logger.info('Shutting down Bitget MCP Server...');
      
      // Stop cache cleanup timer
      cacheManager.stopCleanup();
      
      // Disconnect WebSocket
      this.wsClient.disconnect();
      
      // Final cleanup
      cacheManager.cleanupAll();
      
      logger.info('Graceful shutdown completed');
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    process.on('uncaughtException', (error) => {
      logger.error('Uncaught exception', { error: error.message });
      shutdown();
    });
    process.on('unhandledRejection', (reason) => {
      logger.error('Unhandled rejection', { reason });
      shutdown();
    });
  }
}

// Start the server
const server = new BitgetMCPServer();
server.run().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
