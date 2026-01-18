import crypto from 'crypto';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { 
  BitgetConfig, 
  APIResponse, 
  Ticker, 
  OrderBook, 
  Candle, 
  Order, 
  Balance, 
  Position, 
  OrderParams, 
  BitgetError,
  BitgetAPIError,
  BitgetNetworkError,
  BitgetRateLimitError,
  BitgetAuthenticationError,
  RetryConfig
} from '../types/bitget.js';
import { logger } from '../utils/logger.js';
import { retryManager, RetryManager } from '../utils/retry.js';
import { priceCache, tickerCache, orderbookCache, candlesCache, balanceCache, positionsCache } from '../utils/cache.js';

export class BitgetRestClient {
  // ...existing code...

  /**
   * Fetch all margin-enabled spot trading symbols
   */
  async getMarginSymbols(): Promise<any[]> {
    const response = await this.request<any>('GET', '/api/v2/spot/market/support-symbols', {});
    // Filter for margin-enabled pairs if needed (see API response structure)
    return (response.data && Array.isArray(response.data))
      ? response.data.filter((s: any) => s.isMarginOpen === '1')
      : [];
  }

  /**
   * Fetch all available USDT-margined futures contracts
   */
  async getUsdtFuturesContracts(): Promise<any[]> {
    const response = await this.request<any>('GET', '/api/v2/mix/market/contracts', {
      productType: 'USDT-FUTURES'
    });
    return response.data || [];
  }
  private config: BitgetConfig;
  private rateLimitRequests: number = 0;
  private rateLimitWindow: number = Date.now();
  private retryManager: RetryManager;

  constructor(config: BitgetConfig, retryConfig?: Partial<RetryConfig>) {
    this.config = config;
    this.retryManager = new RetryManager(retryConfig);
    
    logger.info('BitgetRestClient initialized', {
      sandbox: config.sandbox,
      baseUrl: config.baseUrl
    });
  }

  /**
   * Validate API credentials by making a test request
   */
  async validateCredentials(): Promise<boolean> {
    try {
      if (!this.config.apiKey || !this.config.secretKey || !this.config.passphrase) {
        throw new BitgetAuthenticationError('Missing API credentials');
      }

      // Test with a simple account info request
      await this.request('GET', '/api/v2/spot/account/assets', {}, true);
      logger.info('API credentials validated successfully');
      return true;
    } catch (error: any) {
      logger.error('API credentials validation failed', { 
        error: error.message,
        errorType: error.constructor.name 
      });
      return false;
    }
  }
  
  /**
   * Helper to determine if symbol is for futures (contains _UMCBL)
   */
  private isFuturesSymbol(symbol: string): boolean {
    return symbol.includes('_UMCBL') || symbol.includes('_');
  }

  /**
   * Helper to determine if params are for futures
   */
  private isFuturesParams(params: OrderParams): boolean {
    return !!(params.marginCoin || params.marginMode || (params.symbol && (params.symbol.includes('_UMCBL') || params.symbol.includes('_'))));
  }

  /**
   * Format interval for Bitget Futures API
   * Futures API accepts: [1m,3m,5m,15m,30m,1H,4H,6H,12H,1D,1W,1M,6Hutc,12Hutc,1Dutc,3Dutc,1Wutc,1Mutc]
   */
  private formatIntervalForFuturesAPI(interval: string): string {
    const lower = interval.toLowerCase();
    
    // Minutes: keep short format (1m, 5m, 15m, 30m)
    if (lower.match(/^\d+m$/)) {
      return lower;
    }
    
    // Hours: convert to uppercase H (1H, 4H, 6H, 12H)
    if (lower.includes('h')) {
      return lower.replace('h', 'H');
    }
    
    // Days/Weeks/Months: uppercase (1D, 1W, 1M)
    if (lower.includes('d') || lower.includes('w')) {
      return lower.toUpperCase();
    }
    
    // Default: return as is for special cases like UTC variants
    return interval;
  }

  /**
   * Format interval for Bitget Spot API  
   * Spot API accepts: [1min,3min,5min,15min,30min,1h,4h,6h,12h,1day,1week,1M,6Hutc,12Hutc,1Dutc,3Dutc,1Wutc,1Mutc]
   */
  private formatIntervalForSpotAPI(interval: string): string {
    const lower = interval.toLowerCase();
    
    // Minutes: convert to full format (1min, 5min, 15min, 30min)
    if (lower.match(/^\d+m$/)) {
      return lower.replace('m', 'min');
    }
    
    // Hours: keep lowercase (1h, 4h, 6h, 12h)
    if (lower.includes('h') && !lower.includes('utc')) {
      return lower;
    }
    
    // Days: convert to full format (1day)
    if (lower.match(/^\d+d$/)) {
      return lower.replace('d', 'day');
    }
    
    // Weeks: convert to full format (1week)  
    if (lower.match(/^\d+w$/)) {
      return lower.replace('w', 'week');
    }
    
    // Months and UTC variants: return as is
    return interval;
  }

  /**
   * Generate authentication signature for private endpoints
   */
  private generateSignature(timestamp: string, method: string, requestPath: string, body: string = ''): string {
    const message = timestamp + method.toUpperCase() + requestPath + body;
    return crypto.createHmac('sha256', this.config.secretKey).update(message).digest('base64');
  }

  /**
   * Rate limiting check
   */
  private checkRateLimit(): void {
    const now = Date.now();
    if (now - this.rateLimitWindow > 1000) {
      this.rateLimitWindow = now;
      this.rateLimitRequests = 0;
    }
    
    if (this.rateLimitRequests >= 10) {
      logger.warn('Rate limit exceeded', { 
        requests: this.rateLimitRequests,
        window: this.rateLimitWindow 
      });
      throw new BitgetRateLimitError('Rate limit exceeded: 10 requests per second');
    }
    
    this.rateLimitRequests++;
  }

  /**
   * Make authenticated request to Bitget API
   */
  private async request<T>(
    method: 'GET' | 'POST' | 'DELETE',
    endpoint: string,
    params: Record<string, any> = {},
    isPrivate: boolean = false
  ): Promise<APIResponse<T>> {
    const requestId = Math.random().toString(36).substring(7);
    const context = `${method} ${endpoint}`;

    return this.retryManager.execute(async () => {
      this.checkRateLimit();

      const timestamp = Date.now().toString();
      let url = `${this.config.baseUrl}${endpoint}`;
      let body = '';

      // Build query string for GET requests
      let queryString = '';
      if (method === 'GET' && Object.keys(params).length > 0) {
        const searchParams = new URLSearchParams();
        Object.entries(params).forEach(([key, value]) => {
          if (value !== undefined && value !== null) {
            searchParams.append(key, value.toString());
          }
        });
        queryString = searchParams.toString();
        url += `?${queryString}`;
      }

      // Handle body for POST requests
      if (method === 'POST' && Object.keys(params).length > 0) {
        body = JSON.stringify(params);
      }

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      };

      // Add authentication headers for private endpoints
      if (isPrivate) {
        // For GET requests, include query params in signature path
        const signaturePath = method === 'GET' && queryString 
          ? `${endpoint}?${queryString}`
          : endpoint;
        
        const signature = this.generateSignature(timestamp, method, signaturePath, body);
        headers['ACCESS-KEY'] = this.config.apiKey;
        headers['ACCESS-SIGN'] = signature;
        headers['ACCESS-TIMESTAMP'] = timestamp;
        headers['ACCESS-PASSPHRASE'] = this.config.passphrase;
        
        // Add demo trading header if in sandbox mode
        if (this.config.sandbox) {
          headers['paptrading'] = '1';
        }
      }

      try {
        logger.debug('Making API request', {
          requestId,
          method,
          url,
          isPrivate,
          bodyLength: body.length
        });

        // Add a timeout to prevent hangs
        const controller = new AbortController();
        const timeoutMs = 25000; // 25s timeout
        const timeout = setTimeout(() => controller.abort(), timeoutMs);

        const response = await fetch(url, {
          method,
          headers,
          body: method === 'POST' ? body : undefined,
          signal: controller.signal,
        });
        clearTimeout(timeout);

        let responseBody: string | undefined;
        let data: APIResponse<T> | undefined;
        try {
          responseBody = await response.text();
          data = JSON.parse(responseBody) as APIResponse<T>;
        } catch (parseErr) {
          logger.error('Failed to parse Bitget API response as JSON', {
            requestId,
            status: response.status,
            responseBody,
            parseErr: parseErr instanceof Error ? parseErr.message : parseErr
          });
          throw new BitgetNetworkError(`Failed to parse Bitget API response: ${responseBody}`);
        }

        if (!response.ok) {
          logger.error('Bitget API HTTP error', {
            requestId,
            status: response.status,
            statusText: response.statusText,
            responseBody
          });
          throw new BitgetNetworkError(`HTTP ${response.status}: ${response.statusText} - ${responseBody}`);
        }

        logger.debug('Received API response', {
          requestId,
          status: response.status,
          code: data.code,
          responseBody
        });

        if (data.code !== '00000') {
          const errorCode = data.code;
          const errorMessage = data.msg || 'Unknown API error';
          logger.error('Bitget API error response', {
            requestId,
            errorCode,
            errorMessage,
            responseBody
          });
          // Classify errors
          if (errorCode === '40009') {
            throw new BitgetAuthenticationError(`Authentication failed: ${errorMessage}`);
          } else if (errorCode === '40014') {
            throw new BitgetRateLimitError(`Rate limit exceeded: ${errorMessage}`);
          } else {
            throw new BitgetAPIError(errorCode, errorMessage, requestId, endpoint);
          }
        }

        return data;
      } catch (error: any) {
        logger.error('API request failed', {
          requestId,
          method,
          url,
          error: error.message,
          errorType: error.constructor.name
        });

        // Re-throw custom errors as-is
        if (error instanceof BitgetAPIError || 
            error instanceof BitgetNetworkError || 
            error instanceof BitgetRateLimitError || 
            error instanceof BitgetAuthenticationError) {
          throw error;
        }

        // Wrap other errors as network errors
        throw new BitgetNetworkError(`Network error: ${error.message}`, error);
      }
    }, context);
  }

  // ========== PUBLIC MARKET DATA METHODS ==========

  /**
   * Get current price for a symbol
   */
  async getPrice(symbol: string): Promise<string> {
    const cacheKey = `price:${symbol}`;
    
    // Try cache first
    const cachedPrice = priceCache.get(cacheKey);
    if (cachedPrice) {
      return cachedPrice;
    }

    let price: string = '';
    
    if (this.isFuturesSymbol(symbol)) {
      // Futures ticker (v2 API requires symbol without _UMCBL and productType)
      const cleanSymbol = symbol.replace('_UMCBL', '');
      const response = await this.request<any>('GET', '/api/v2/mix/market/ticker', { 
        symbol: cleanSymbol,
        productType: 'USDT-FUTURES'
      });
      if (response.data?.last) {
        price = response.data.last;
      } else {
        throw new Error(`Price not found for symbol: ${symbol}`);
      }
    } else {
      // Spot ticker - use v2 public API
      const response = await this.request<any>('GET', '/api/v2/spot/market/tickers', {});
      if (response.data && Array.isArray(response.data)) {
        const ticker = response.data.find((t: any) => t.symbol === symbol);
        if (ticker) {
          price = ticker.close;
        } else {
          throw new Error(`Price not found for symbol: ${symbol}`);
        }
      } else {
        throw new Error(`Price not found for symbol: ${symbol}`);
      }
    }
    
    // Cache the result
    priceCache.set(cacheKey, price);
    return price;
  }

  /**
   * Get full ticker information
   */
  async getTicker(symbol: string): Promise<Ticker> {
    const cacheKey = `ticker:${symbol}`;
    
    // Try cache first
    const cachedTicker = tickerCache.get(cacheKey);
    if (cachedTicker) {
      return cachedTicker;
    }

    let ticker: Ticker = {
      symbol: '',
      last: '',
      bid: '',
      ask: '',
      high24h: '',
      low24h: '',
      volume24h: '',
      change24h: '',
      changePercent24h: '',
      timestamp: 0
    };
    
    if (this.isFuturesSymbol(symbol)) {
      // Futures ticker (v2 API requires symbol without _UMCBL and productType)
      const cleanSymbol = symbol.replace('_UMCBL', '');
      const response = await this.request<any>('GET', '/api/v2/mix/market/ticker', { 
        symbol: cleanSymbol,
        productType: 'USDT-FUTURES'
      });
      if (response.data) {
        const tickerData = response.data;
        ticker = {
          symbol: tickerData.symbol,
          last: tickerData.last,
          bid: tickerData.bestBid,
          ask: tickerData.bestAsk,
          high24h: tickerData.high24h,
          low24h: tickerData.low24h,
          volume24h: tickerData.baseVolume,
          change24h: ((parseFloat(tickerData.last) - parseFloat(tickerData.openUtc)) / parseFloat(tickerData.openUtc) * 100).toFixed(2),
          changePercent24h: tickerData.priceChangePercent,
          timestamp: parseInt(tickerData.timestamp) || Date.now()
        };
      } else {
        throw new Error(`Ticker not found for symbol: ${symbol}`);
      }
    } else {
      // Spot ticker - use v2 public API
      const response = await this.request<any>('GET', '/api/v2/spot/market/tickers', {});
      if (response.data && Array.isArray(response.data)) {
        const tickerData = response.data.find((t: any) => t.symbol === symbol);
        if (tickerData) {
          ticker = {
            symbol: tickerData.symbol,
            last: tickerData.close,
            bid: tickerData.buyOne,
            ask: tickerData.sellOne,
            high24h: tickerData.high24h,
            low24h: tickerData.low24h,
            volume24h: tickerData.baseVol,
            change24h: tickerData.change,
            changePercent24h: tickerData.changePercent,
            timestamp: parseInt(tickerData.ts) || Date.now()
          };
        } else {
          throw new Error(`Ticker not found for symbol: ${symbol}`);
        }
      } else {
        throw new Error(`Ticker not found for symbol: ${symbol}`);
      }
    }
    
    // Cache the result
    tickerCache.set(cacheKey, ticker);
    return ticker;
  }

  /**
   * Get order book
   */
  async getOrderBook(symbol: string, depth: number = 20): Promise<OrderBook> {
    const cacheKey = `orderbook:${symbol}:${depth}`;
    
    // Try cache first
    const cachedOrderBook = orderbookCache.get(cacheKey);
    if (cachedOrderBook) {
      return cachedOrderBook;
    }

    let orderBook: OrderBook = {
      symbol: '',
      bids: [],
      asks: [],
      timestamp: 0
    };
    
    if (this.isFuturesSymbol(symbol)) {
      // Futures orderbook (v2 API requires symbol without _UMCBL and productType)
      const cleanSymbol = symbol.replace('_UMCBL', '');
      const response = await this.request<any>('GET', '/api/v2/mix/market/depth', { 
        symbol: cleanSymbol,
        productType: 'USDT-FUTURES',
        limit: depth.toString()
      });
      
      orderBook = {
        symbol: symbol,
        bids: response.data?.bids || [],
        asks: response.data?.asks || [],
        timestamp: response.data?.timestamp || Date.now()
      };
    } else {
      // Spot orderbook
      const response = await this.request<any>('GET', '/api/v2/spot/market/orderbook', { 
        symbol, 
        type: 'step0',
        limit: depth.toString()
      });
      
      orderBook = {
        symbol,
        bids: response.data?.bids || [],
        asks: response.data?.asks || [],
        timestamp: response.data?.ts || Date.now()
      };
    }
    
    // Cache the result
    orderbookCache.set(cacheKey, orderBook);
    return orderBook;
  }

  /**
   * Get historical candles/klines
   */
  async getCandles(symbol: string, interval: string, limit: number = 100): Promise<Candle[]> {
    if (this.isFuturesSymbol(symbol)) {
      // Futures candles - use v2 API with productType
      // Remove _UMCBL suffix if present for v2 API
      const cleanSymbol = symbol.replace('_UMCBL', '');
      const response = await this.request<string[][]>('GET', '/api/v2/mix/market/candles', {
        productType: 'USDT-FUTURES',
        symbol: cleanSymbol,
        granularity: this.formatIntervalForFuturesAPI(interval), // Format interval for futures API
        limit: limit.toString()
      });

      if (!response.data || response.data.length === 0) {
        return [];
      }

      return response.data.map(candle => ({
        symbol: symbol, // Keep original symbol format
        timestamp: parseInt(candle[0]),
        open: candle[1],
        high: candle[2],
        low: candle[3],
        close: candle[4],
        volume: candle[5]
      }));
    } else {
      // Spot candles
      const response = await this.request<string[][]>('GET', '/api/v2/spot/market/candles', {
        symbol,
        granularity: this.formatIntervalForSpotAPI(interval), // Format interval for spot API
        limit: limit.toString()
      });

      if (!response.data || response.data.length === 0) {
        return [];
      }

      return response.data.map(candle => ({
        symbol,
        timestamp: parseInt(candle[0]),
        open: candle[1],
        high: candle[2],
        low: candle[3],
        close: candle[4],
        volume: candle[5]
      }));
    }
  }

  // ========== PRIVATE TRADING METHODS ==========

  /**
   * Get account balance
   */
  async getBalance(asset?: string): Promise<Balance[]> {
    const response = await this.request<any>('GET', '/api/v2/spot/account/assets', {}, true);
    
    const balances = response.data.map((item: any) => ({
      asset: item.coin,
      free: item.available,
      locked: item.frozen,
      total: (parseFloat(item.available) + parseFloat(item.frozen)).toString()
    }));

    if (asset) {
      return balances.filter((balance: Balance) => balance.asset === asset);
    }
    
    return balances;
  }

  /**
   * Place a new order (automatically detects spot vs futures)
   */
  async placeOrder(params: OrderParams): Promise<Order> {
    if (this.isFuturesParams(params)) {
      return this.placeFuturesOrder(params);
    } else {
      return this.placeSpotOrder(params);
    }
  }

  /**
   * Place a spot order
   */
  private async placeSpotOrder(params: OrderParams): Promise<Order> {
    const orderData: any = {
      symbol: params.symbol,
      side: params.side,
      orderType: params.type,
      size: params.quantity,  // v2 API uses 'size' instead of 'quantity'
    };

    if (params.type === 'limit' && params.price) {
      orderData.price = params.price;
    }

    if (params.timeInForce) {
      orderData.force = params.timeInForce;  // v2 API uses 'force' instead of 'timeInForceValue'
    } else if (params.type === 'limit') {
      orderData.force = 'GTC';  // Default to GTC for limit orders
    }

    if (params.clientOrderId) {
      orderData.clientOid = params.clientOrderId;
    }

    const response = await this.request<any>('POST', '/api/v2/spot/trade/place-order', orderData, true);

    return {
      orderId: response.data.orderId,
      clientOrderId: response.data.clientOid,
      symbol: params.symbol,
      side: params.side,
      type: params.type,
      quantity: params.quantity,
      price: params.price,
      status: 'open',
      filled: '0',
      remaining: params.quantity,
      timestamp: Date.now(),
      updateTime: Date.now()
    };
  }

  /**
   * Place a futures order
   */
  private async placeFuturesOrder(params: OrderParams): Promise<Order> {
    // In sandbox, do NOT append _UMCBL; use the base symbol as-is
    let symbol = params.symbol;
    if (this.config.sandbox) {
      // Use the symbol as provided (e.g., BTCUSDT)
    } else {
      // In production, append _UMCBL if not present
      if (!symbol.endsWith('_UMCBL')) {
        symbol = symbol + '_UMCBL';
      }
    }

    // For v2 mix endpoints, symbol should be the base symbol (no _UMCBL)
    const cleanSymbol = symbol.replace('_UMCBL', '');

    const orderData: any = {
      symbol: cleanSymbol,
      productType: 'USDT-FUTURES',
      marginCoin: params.marginCoin || 'USDT',
      side: params.side,
      orderType: params.type,
      size: params.quantity,  // For futures, this is in contracts
    };
    // Only include marginMode if explicitly provided; avoid implicit account mode change errors
    if (params.marginMode) {
      orderData.marginMode = params.marginMode;
    }

    if (params.type === 'limit' && params.price) {
      orderData.price = params.price;
    }

    if (params.timeInForce) {
      orderData.timeInForceValue = params.timeInForce;  // v2 API uses timeInForceValue
    } else if (params.type === 'limit') {
      orderData.timeInForceValue = 'GTC';  // v2 API uses 'GTC'
    }

    if (params.clientOrderId) {
      orderData.clientOid = params.clientOrderId;
    }

    // Unilateral position mode support: tradeSide 'open' | 'close'
    if (params.tradeSide) {
      orderData.tradeSide = params.tradeSide;
      // Do not include reduceOnly; tradeSide governs close/open semantics in v2
    } else if (params.reduceOnly === true) {
      orderData.tradeSide = 'close';
      // Do not include reduceOnly
    } else {
      orderData.tradeSide = 'open';
      // Do not include reduceOnly
    }

    console.error('Placing futures order with data:', JSON.stringify(orderData, null, 2));
    
    // Try v2 API endpoint
    const response = await this.request<any>('POST', '/api/v2/mix/order/place-order', orderData, true);

    return {
      orderId: response.data.orderId,
      clientOrderId: response.data.clientOid,
      symbol: params.symbol, // Return original symbol with suffix
      side: params.side,
      type: params.type,
      quantity: params.quantity,
      price: params.price,
      status: 'open',
      filled: '0',
      remaining: params.quantity,
      timestamp: Date.now(),
      updateTime: Date.now()
    };
  }

  /**
   * Set futures margin mode (isolated or crossed)
   */
  async setMarginMode(marginMode: 'isolated' | 'crossed', symbol?: string): Promise<boolean> {
    const payload: any = {
      productType: 'USDT-FUTURES',
      marginCoin: 'USDT',
      marginMode,
    };
    if (symbol) payload.symbol = symbol.replace('_UMCBL', '');
    const response = await this.request<any>('POST', '/api/v2/mix/account/set-margin-mode', payload, true);
    return response.code === '00000';
  }

  /**
   * Close all positions for a futures symbol or all symbols if none provided
   */
  async closeAllPositions(symbol?: string): Promise<boolean> {
    const payload: any = {
      productType: 'USDT-FUTURES',
      marginCoin: 'USDT',
    };
    if (symbol) payload.symbol = symbol.replace('_UMCBL', '');
    const response = await this.request<any>('POST', '/api/v2/mix/order/close-positions', payload, true);
    return response.code === '00000';
  }

  /**
   * Get current funding rate for a futures symbol
   */
  async getCurrentFundingRate(symbol: string): Promise<any> {
    const params: any = { symbol: symbol.replace('_UMCBL', '') };
    const response = await this.request<any>('GET', '/api/v2/mix/market/current-fund-rate', params, false);
    return response.data;
  }

  /**
   * Get historical funding rates for a futures symbol
   */
  async getHistoricFundingRates(symbol: string): Promise<any[]> {
    const params: any = { symbol: symbol.replace('_UMCBL', '') };
    const response = await this.request<any>('GET', '/api/v2/mix/market/history-fund-rate', params, false);
    return response.data || [];
  }

  /**
   * List futures contracts configuration
   */
  async getFuturesContracts(): Promise<any[]> {
    const response = await this.request<any>('GET', '/api/v2/mix/market/contracts', { productType: 'USDT-FUTURES' }, false);
    return response.data || [];
  }

  /**
   * Cancel an order (automatically detects spot vs futures)
   */
  async cancelOrder(orderId: string, symbol: string): Promise<boolean> {
    if (this.isFuturesSymbol(symbol)) {
      return this.cancelFuturesOrder(orderId, symbol);
    } else {
      return this.cancelSpotOrder(orderId, symbol);
    }
  }

  /**
   * Cancel a spot order
   */
  private async cancelSpotOrder(orderId: string, symbol: string): Promise<boolean> {
    const response = await this.request<any>('POST', '/api/v2/spot/trade/cancel-order', {
      orderId,
      symbol
    }, true);

    return response.code === '00000';
  }

  /**
   * Cancel a futures order
   */
  private async cancelFuturesOrder(orderId: string, symbol: string): Promise<boolean> {
    // Remove _UMCBL suffix for v1 API
    const cleanSymbol = symbol.replace('_UMCBL', '');
    
    const response = await this.request<any>('POST', '/api/v2/mix/order/cancel-order', {
      orderId,
      symbol: cleanSymbol,
      productType: 'USDT-FUTURES',
      marginCoin: 'USDT'
    }, true);

    return response.code === '00000';
  }

  /**
   * Modify TPSL (Take Profit / Stop Loss) for futures position or order
   * Pass at least one of stopSurplusPrice (TP) or stopLossPrice (SL)
   */
  async modifyFuturesTPSL(
    symbol: string,
    options: { stopSurplusPrice?: string; stopLossPrice?: string }
  ): Promise<boolean> {
    const cleanSymbol = symbol.replace('_UMCBL', '');
    const payload: any = {
      symbol: cleanSymbol,
      productType: 'USDT-FUTURES',
      marginCoin: 'USDT',
    };
    if (options.stopSurplusPrice) payload.stopSurplusPrice = options.stopSurplusPrice;
    if (options.stopLossPrice) payload.stopLossPrice = options.stopLossPrice;

    if (!payload.stopSurplusPrice && !payload.stopLossPrice) {
      throw new Error('modifyFuturesTPSL requires stopSurplusPrice or stopLossPrice');
    }

    // Use v2 mix modify TPSL endpoint
    const response = await this.request<any>('POST', '/api/v2/mix/order/modify-tpsl-order', payload, true);
    return response.code === '00000';
  }

  /**
   * Place a TPSL order (trigger-based TP/SL) for futures
   * Useful to attach new TP/SL when opening a position
   */
  async placeFuturesTPSL(
    symbol: string,
    options: {
      planType: 'pos_profit' | 'pos_loss' | 'profit_plan' | 'loss_plan' | 'moving_plan';
      triggerPrice: string;
      triggerType?: 'fill_price' | 'mark_price';
      executePrice?: string;
      holdSide: 'long' | 'short' | 'buy' | 'sell';
      size: string;
      clientOid?: string;
    }
  ): Promise<boolean> {
    const cleanSymbol = symbol.replace('_UMCBL', '');
    const payload: any = {
      symbol: cleanSymbol,
      productType: 'USDT-FUTURES',
      marginCoin: 'USDT',
      planType: options.planType,
      triggerPrice: options.triggerPrice,
      triggerType: options.triggerType || 'mark_price',
      holdSide: options.holdSide,
      size: options.size,
    };
    if (options.executePrice) payload.executePrice = options.executePrice;
    if (options.clientOid) payload.clientOid = options.clientOid;

    const response = await this.request<any>('POST', '/api/v2/mix/order/place-tpsl-order', payload, true);
    return response.code === '00000';
  }

  /**
   * Get open orders (supports both spot and futures)
   */
  async getOrders(symbol?: string, status?: string): Promise<Order[]> {
    if (symbol && this.isFuturesSymbol(symbol)) {
      return this.getFuturesOrders(symbol, status);
    } else {
      return this.getSpotOrders(symbol, status);
    }
  }

  /**
   * Get spot orders
   */
  private async getSpotOrders(symbol?: string, status?: string): Promise<Order[]> {
    const params: any = {};
    if (symbol) params.symbol = symbol;
    
    const response = await this.request<any[]>('GET', '/api/v2/spot/trade/unfilled-orders', params, true);

    return response.data.map(order => ({
      orderId: order.orderId,
      clientOrderId: order.clientOid,
      symbol: order.symbol,
      side: order.side,
      type: order.orderType,
      quantity: order.quantity,
      price: order.price,
      status: order.status,
      filled: order.fillQuantity,
      remaining: (parseFloat(order.quantity) - parseFloat(order.fillQuantity)).toString(),
      timestamp: parseInt(order.cTime),
      updateTime: parseInt(order.uTime)
    }));
  }

  /**
   * Get futures orders
   */
  private async getFuturesOrders(symbol?: string, status?: string): Promise<Order[]> {
    const params: any = {};
    
    if (symbol) {
      // Remove _UMCBL suffix for v1 API
      params.symbol = symbol.replace('_UMCBL', '');
    }

    const response = await this.request<any[]>('GET', '/api/mix/v1/order/current', params, true);

    return response.data.map(order => ({
      orderId: order.orderId,
      clientOrderId: order.clientOid,
      symbol: symbol || `${order.symbol}_UMCBL`, // Add suffix back for consistency
      side: order.side,
      type: order.orderType,
      quantity: order.size,
      price: order.price,
      status: order.state,
      filled: order.fillSize,
      remaining: (parseFloat(order.size) - parseFloat(order.fillSize || '0')).toString(),
      timestamp: parseInt(order.cTime),
      updateTime: parseInt(order.uTime)
    }));
  }

  // ========== FUTURES METHODS ==========

  /**
   * Get futures positions
   */
  async getFuturesPositions(symbol?: string): Promise<Position[]> {
    const params: any = { productType: 'USDT-FUTURES' };
    if (symbol) {
      // Add _UMCBL suffix for futures if not present
      params.symbol = symbol.includes('_') ? symbol : `${symbol}_UMCBL`;
    }

    const response = await this.request<any>('GET', '/api/v2/mix/position/all-position', params, true);

    const positions = response.data || [];
    return positions.map((position: any) => ({
      symbol: position.symbol,
      side: position.holdSide || (parseFloat(position.size || '0') > 0 ? 'long' : 'short'),
      size: Math.abs(parseFloat(position.size || position.total || '0')).toString(),
      entryPrice: position.averageOpenPrice || position.openPriceAvg,
      markPrice: position.markPrice,
      pnl: position.unrealizedPL || position.achievedProfits,
      pnlPercent: position.unrealizedPLR || '0',
      margin: position.margin || position.marginSize,
      leverage: position.leverage,
      timestamp: parseInt(position.cTime || Date.now().toString())
    }));
  }

  /**
   * Set leverage for futures trading
   */
  async setLeverage(symbol: string, leverage: number): Promise<boolean> {
    // Remove _UMCBL suffix for v2 API (like in candles)
    const cleanSymbol = symbol.replace('_UMCBL', '');
    
    const response = await this.request<any>('POST', '/api/v2/mix/account/set-leverage', {
      symbol: cleanSymbol,
      productType: 'USDT-FUTURES',
      marginCoin: 'USDT',  // Required parameter!
      leverage: leverage.toString(),
      holdSide: 'long'
    }, true);

    return response.code === '00000';
  }

  /**
   * Get margin information
   */
  async getMarginInfo(symbol?: string): Promise<any> {
    const params: any = { productType: 'USDT-FUTURES' };
    if (symbol) {
      // Add _UMCBL suffix for futures if not present
      params.symbol = symbol.includes('_') ? symbol : `${symbol}_UMCBL`;
    }

    const response = await this.request<any>('GET', '/api/v2/mix/account/accounts', params, true);
    return response.data;
  }

  /**
   * List pending futures plan orders (including TPSL)
   */
  async getFuturesPlanOrders(symbol?: string, planType: 'normal_plan' | 'track_plan' | 'profit_loss' = 'profit_loss'): Promise<any[]> {
    const params: any = {
      productType: 'USDT-FUTURES',
      planType,
    };
    if (symbol) params.symbol = symbol.replace('_UMCBL', '');

    const response = await this.request<any>('GET', '/api/v2/mix/order/orders-plan-pending', params, true);
    return response.data?.entrustedList || [];
  }

  /**
   * Cancel a futures plan order (by orderId or clientOid)
   */
  async cancelFuturesPlanOrder(options: { symbol?: string; orderId?: string; clientOid?: string; planType?: 'normal_plan' | 'track_plan' | 'profit_loss' }): Promise<boolean> {
    const payload: any = {
      productType: 'USDT-FUTURES',
      marginCoin: 'USDT',
      planType: options.planType || 'profit_loss',
    };
    if (options.symbol) payload.symbol = options.symbol.replace('_UMCBL', '');
    if (options.orderId) payload.orderIdList = [{ orderId: options.orderId }];
    if (options.clientOid) payload.orderIdList = [{ clientOid: options.clientOid }];

    const response = await this.request<any>('POST', '/api/v2/mix/order/cancel-plan-order', payload, true);
    return response.code === '00000';
  }

  /**
   * Cancel all futures orders, optionally just for a symbol
   */
  async cancelAllFuturesOrders(symbol?: string): Promise<boolean> {
    const payload: any = {
      productType: 'USDT-FUTURES',
      marginCoin: 'USDT',
    };
    if (symbol) payload.symbol = symbol.replace('_UMCBL', '');
    const response = await this.request<any>('POST', '/api/v2/mix/order/cancel-all-orders', payload, true);
    return response.code === '00000';
  }
}
