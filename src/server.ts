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
                symbol: { type: 'string', description: 'Trading pair symbol' }
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
                depth: { type: 'number', description: 'Order book depth (default: 20)' }
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
                limit: { type: 'number', description: 'Number of candles (default: 100)' }
              },
              required: ['symbol', 'interval']
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
            const { symbol } = GetTickerSchema.parse(args);
            const ticker = await this.bitgetClient.getTicker(symbol);
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(ticker, null, 2),
                },
              ],
            } as CallToolResult;
          }

          case 'getOrderBook': {
            const { symbol, depth = 20 } = GetOrderBookSchema.parse(args);
            const orderBook = await this.bitgetClient.getOrderBook(symbol, depth);
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(orderBook, null, 2),
                },
              ],
            } as CallToolResult;
          }

          case 'getCandles': {
            const { symbol, interval, limit = 100 } = GetCandlesSchema.parse(args);
            const candles = await this.bitgetClient.getCandles(symbol, interval, limit);
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(candles, null, 2),
                },
              ],
            } as CallToolResult;
          }

          // Account
          case 'getBalance': {
            const { asset } = GetBalanceSchema.parse(args);
            const balance = await this.bitgetClient.getBalance(asset);
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(balance, null, 2),
                },
              ],
            } as CallToolResult;
          }

          // Trading
          case 'placeOrder': {
            const orderParams = PlaceOrderSchema.parse(args);
            console.error('Received placeOrder request:', JSON.stringify(orderParams, null, 2));
            
            // Determine if this is a futures order
            const isFutures = orderParams.marginCoin || orderParams.marginMode || orderParams.symbol.includes('_UMCBL') || orderParams.symbol.includes('_');
            console.error(`Order type detected: ${isFutures ? 'futures' : 'spot'}`);
            
            const order = await this.bitgetClient.placeOrder(orderParams);
            return {
              content: [
                {
                  type: 'text',
                  text: `Order placed successfully (${isFutures ? 'futures' : 'spot'}):\\n${JSON.stringify(order, null, 2)}`,
                },
              ],
            } as CallToolResult;
          }

          case 'cancelOrder': {
            const { orderId, symbol } = CancelOrderSchema.parse(args);
            const success = await this.bitgetClient.cancelOrder(orderId, symbol);
            return {
              content: [
                {
                  type: 'text',
                  text: success ? `Order ${orderId} cancelled successfully` : `Failed to cancel order ${orderId}`,
                },
              ],
            } as CallToolResult;
          }

          case 'getOrders': {
            const { symbol, status } = GetOrdersSchema.parse(args);
            const orders = await this.bitgetClient.getOrders(symbol, status);
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(orders, null, 2),
                },
              ],
            } as CallToolResult;
          }

          // Futures
          case 'getPositions': {
            const { symbol } = GetPositionsSchema.parse(args);
            const positions = await this.bitgetClient.getFuturesPositions(symbol);
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(positions, null, 2),
                },
              ],
            } as CallToolResult;
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
