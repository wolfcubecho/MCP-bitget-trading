/**
 * MCP Tool Schemas
 * Zod schemas for validation of MCP tool parameters
 */

import { z } from 'zod';

// Market Data Schemas
export const GetPriceSchema = z.object({
  symbol: z.string().describe('Trading pair symbol (e.g., BTCUSDT for spot, BTCUSDT_UMCBL for futures)')
});

export const GetTickerSchema = z.object({
  symbol: z.string().describe('Trading pair symbol (BTCUSDT for spot, BTCUSDT_UMCBL for futures)'),
  compact: z.boolean().optional().describe('If true, returns a trimmed ticker')
});

export const GetOrderBookSchema = z.object({
  symbol: z.string().describe('Trading pair symbol (BTCUSDT for spot, BTCUSDT_UMCBL for futures)'),
  depth: z.number().optional().describe('Order book depth (default: 20)'),
  compact: z.boolean().optional().describe('If true, trims to top-of-book levels')
});

export const GetCandlesSchema = z.object({
  symbol: z.string().describe('Trading pair symbol (BTCUSDT for spot, BTCUSDT_UMCBL for futures)'),
  interval: z.enum([
    // Minutes (lowercase)
    '1m', '3m', '5m', '15m', '30m',
    // Hours (can be lowercase, will be converted)
    '1h', '4h', '6h', '12h', '1H', '4H', '6H', '12H',
    // Days/Weeks/Months (can be lowercase, will be converted)
    '1d', '1w', '1D', '1W', '1M',
    // UTC variants
    '6Hutc', '12Hutc', '1Dutc', '3Dutc', '1Wutc', '1Mutc'
  ]).describe('Candle interval - API will auto-format to correct case'),
  limit: z.number().optional().describe('Number of candles (default: 100)'),
  compact: z.boolean().optional().describe('If true, returns only essential OHLCV fields')
});

// Trading Schemas
export const PlaceOrderSchema = z.object({
  symbol: z.string().describe('Trading pair symbol'),
  side: z.enum(['buy', 'sell']).describe('Order side'),
  type: z.enum(['market', 'limit']).describe('Order type'),
  quantity: z.string().describe('Order quantity'),
  price: z.string().optional().describe('Order price (required for limit orders)'),
  timeInForce: z.enum(['GTC', 'IOC', 'FOK']).optional().describe('Time in force'),
  clientOrderId: z.string().optional().describe('Client order ID'),
  reduceOnly: z.boolean().optional().describe('Reduce only flag for futures'),
  tradeSide: z.enum(['open', 'close']).optional().describe('Unilateral position action: open or close (futures)'),
  marginMode: z.enum(['crossed', 'isolated']).optional().describe('Margin mode for futures (default: crossed)'),
  marginCoin: z.string().optional().describe('Margin coin for futures (default: USDT)')
});

export const CancelOrderSchema = z.object({
  orderId: z.string().describe('Order ID to cancel'),
  symbol: z.string().describe('Trading pair symbol')
});

export const GetOrdersSchema = z.object({
  symbol: z.string().optional().describe('Filter by symbol'),
  status: z.enum(['open', 'filled', 'cancelled']).optional().describe('Filter by status')
});

// Account Schemas
export const GetBalanceSchema = z.object({
  asset: z.string().optional().describe('Specific asset to query')
});

export const GetPositionsSchema = z.object({
  symbol: z.string().optional().describe('Filter by symbol')
});

// WebSocket Schemas
export const SubscribePriceSchema = z.object({
  symbols: z.array(z.string()).describe('Array of symbols to subscribe to')
});

export const SubscribeTickerSchema = z.object({
  symbols: z.array(z.string()).describe('Array of symbols to subscribe to')
});

export const SubscribeOrderBookSchema = z.object({
  symbol: z.string().describe('Symbol to subscribe to order book updates')
});

export const UnsubscribeSchema = z.object({
  channel: z.string().describe('Channel to unsubscribe from')
});

// Futures Schemas
export const SetLeverageSchema = z.object({
  symbol: z.string().describe('Trading pair symbol'),
  leverage: z.number().min(1).max(125).describe('Leverage value (1-125)')
});

export const GetMarginInfoSchema = z.object({
  symbol: z.string().optional().describe('Filter by symbol')
});

// TPSL / Plan order Schemas (Futures)
export const PlaceTPSLSchema = z.object({
  symbol: z.string().describe('Trading pair symbol (e.g., AVAXUSDT)'),
  planType: z.enum(['pos_profit', 'pos_loss', 'profit_plan', 'loss_plan', 'moving_plan']).describe('TPSL plan type'),
  triggerPrice: z.string().describe('Trigger price for TP/SL'),
  triggerType: z.enum(['fill_price', 'mark_price']).optional().describe('Trigger type (default: mark_price)'),
  executePrice: z.string().optional().describe('Execution price for limit TP/SL (omit for market)'),
  holdSide: z.enum(['long', 'short', 'buy', 'sell']).describe('Position side to apply'),
  size: z.string().describe('Quantity/size for TPSL'),
  clientOid: z.string().optional().describe('Client OID for TPSL order'),
  marginMode: z.enum(['isolated', 'crossed']).optional().describe('Margin mode for futures (default depends on account)')
});

export const GetPlanOrdersSchema = z.object({
  symbol: z.string().optional().describe('Filter by symbol'),
  planType: z.enum(['normal_plan', 'track_plan', 'profit_loss']).optional().describe('Plan type filter (default: profit_loss)')
});

export const CancelPlanOrderSchema = z.object({
  symbol: z.string().optional().describe('Trading pair symbol'),
  orderId: z.string().optional().describe('Plan order ID to cancel'),
  clientOid: z.string().optional().describe('Plan order client OID to cancel'),
  planType: z.enum(['normal_plan', 'track_plan', 'profit_loss']).optional().describe('Plan type (default: profit_loss)')
}).refine((data) => !!(data.orderId || data.clientOid), {
  message: 'Either orderId or clientOid is required',
  path: ['orderId']
});

export const ModifyTPSLSchema = z.object({
  symbol: z.string().describe('Trading pair symbol (e.g., AVAXUSDT)'),
  stopSurplusPrice: z.string().optional().describe('Take profit price to set/modify'),
  stopLossPrice: z.string().optional().describe('Stop loss price to set/modify')
}).refine((data) => !!(data.stopSurplusPrice || data.stopLossPrice), {
  message: 'Provide at least stopSurplusPrice or stopLossPrice',
  path: ['stopSurplusPrice']
});

// Futures account & risk
export const SetMarginModeSchema = z.object({
  symbol: z.string().optional().describe('Trading pair symbol (optional)'),
  marginMode: z.enum(['isolated', 'crossed']).describe('Margin mode to set')
});

export const CloseAllPositionsSchema = z.object({
  symbol: z.string().optional().describe('Trading pair symbol to close (optional)')
});

export const GetCurrentFundingRateSchema = z.object({
  symbol: z.string().describe('Trading pair symbol (e.g., AVAXUSDT)')
});

export const GetHistoricFundingRatesSchema = z.object({
  symbol: z.string().describe('Trading pair symbol (e.g., AVAXUSDT)')
});

export const GetFuturesContractsSchema = z.object({
  productType: z.literal('USDT-FUTURES').optional().describe('Product type (defaults to USDT-FUTURES)')
});

// Plan orders (explicit)
export const PlacePlanOrderSchema = z.object({
  symbol: z.string().describe('Trading pair symbol (e.g., AVAXUSDT)'),
  planType: z.enum(['profit_plan', 'loss_plan', 'moving_plan']).describe('Plan order type'),
  triggerPrice: z.string().describe('Trigger price for plan order'),
  triggerType: z.enum(['fill_price', 'mark_price']).optional().describe('Trigger type (default: mark_price)'),
  executePrice: z.string().optional().describe('Execution price for limit plan order'),
  holdSide: z.enum(['long', 'short', 'buy', 'sell']).describe('Position side'),
  size: z.string().describe('Quantity/size for plan order'),
  clientOid: z.string().optional().describe('Client OID for plan order')
}).extend({
  marginMode: z.enum(['isolated', 'crossed']).optional().describe('Margin mode for futures (default depends on account)')
});

// Status summary of futures position and TPSL/plan orders
export const GetFuturesStatusSchema = z.object({
  symbol: z.string().optional().describe('Trading pair symbol (e.g., AVAXUSDT). If omitted, returns all.'),
  compact: z.boolean().optional().describe('If true, returns a trimmed summary')
});

// Type exports for use in server
export type GetPriceParams = z.infer<typeof GetPriceSchema>;
export type GetTickerParams = z.infer<typeof GetTickerSchema>;
export type GetOrderBookParams = z.infer<typeof GetOrderBookSchema>;
export type GetCandlesParams = z.infer<typeof GetCandlesSchema>;
export type PlaceOrderParams = z.infer<typeof PlaceOrderSchema>;
export type CancelOrderParams = z.infer<typeof CancelOrderSchema>;
export type GetOrdersParams = z.infer<typeof GetOrdersSchema>;
export type GetBalanceParams = z.infer<typeof GetBalanceSchema>;
export type GetPositionsParams = z.infer<typeof GetPositionsSchema>;
export type SubscribePriceParams = z.infer<typeof SubscribePriceSchema>;
export type SubscribeTickerParams = z.infer<typeof SubscribeTickerSchema>;
export type SubscribeOrderBookParams = z.infer<typeof SubscribeOrderBookSchema>;
export type UnsubscribeParams = z.infer<typeof UnsubscribeSchema>;
export type SetLeverageParams = z.infer<typeof SetLeverageSchema>;
export type GetMarginInfoParams = z.infer<typeof GetMarginInfoSchema>;
export type PlaceTPSLParams = z.infer<typeof PlaceTPSLSchema>;
export type GetPlanOrdersParams = z.infer<typeof GetPlanOrdersSchema>;
export type CancelPlanOrderParams = z.infer<typeof CancelPlanOrderSchema>;
export type ModifyTPSLParams = z.infer<typeof ModifyTPSLSchema>;
export type SetMarginModeParams = z.infer<typeof SetMarginModeSchema>;
export type CloseAllPositionsParams = z.infer<typeof CloseAllPositionsSchema>;
export type GetCurrentFundingRateParams = z.infer<typeof GetCurrentFundingRateSchema>;
export type GetHistoricFundingRatesParams = z.infer<typeof GetHistoricFundingRatesSchema>;
export type GetFuturesContractsParams = z.infer<typeof GetFuturesContractsSchema>;
export type PlacePlanOrderParams = z.infer<typeof PlacePlanOrderSchema>;

// Market Snapshot Schema
export const GetMarketSnapshotSchema = z.object({
  symbol: z.string().describe('Trading pair symbol (e.g., BTCUSDT or AVAXUSDT)'),
  interval: z.enum(['1m','3m','5m','15m','30m','1h','4h','6h','12h','1d']).describe('Analysis interval'),
  limit: z.number().optional().default(150).describe('Number of candles to analyze (default 150)'),
  includeCMC: z.boolean().optional().default(false).describe('If true and COINMARKET_API_KEY provided, include CMC metadata'),
  compact: z.boolean().optional().default(true).describe('If true, return trimmed summary'),
  emas: z.array(z.number()).optional().default([20,50,200]).describe('EMA periods to include'),
  atrPeriod: z.number().optional().default(14).describe('ATR period to include'),
  fvgLookback: z.number().optional().default(60).describe('Bars to scan for FVGs'),
  minQuality: z.number().optional().default(0.6).describe('Minimum quality score for hidden order blocks'),
  requireLTFConfirmations: z.boolean().optional().default(false).describe('Require LTF confirmations for HOBs'),
  excludeInvalidated: z.boolean().optional().default(true).describe('Exclude HOBs marked invalidated'),
  onlyFullyMitigated: z.boolean().optional().default(false).describe('Include only fully mitigated HOBs')
});

export type GetMarketSnapshotParams = z.infer<typeof GetMarketSnapshotSchema>;

export const GetMarketSnapshotsSchema = z.object({
  symbols: z.array(z.string()).describe('Array of trading symbols (e.g., ["BTCUSDT","ETHUSDT"])'),
  interval: z.enum(['1m','3m','5m','15m','30m','1h','4h','6h','12h','1d']).describe('Analysis interval'),
  limit: z.number().optional().default(150).describe('Number of candles to analyze'),
  compact: z.boolean().optional().default(true).describe('If true, return trimmed summary'),
  emas: z.array(z.number()).optional().default([20,50,200]).describe('EMA periods'),
  atrPeriod: z.number().optional().default(14).describe('ATR period'),
  fvgLookback: z.number().optional().default(60).describe('Bars to scan for FVGs'),
  minQuality: z.number().optional().default(0.6).describe('Minimum quality score for hidden order blocks'),
  requireLTFConfirmations: z.boolean().optional().default(false).describe('Require LTF confirmations for HOBs'),
  excludeInvalidated: z.boolean().optional().default(true).describe('Exclude HOBs marked invalidated'),
  onlyFullyMitigated: z.boolean().optional().default(false).describe('Include only fully mitigated HOBs')
});

export type GetMarketSnapshotsParams = z.infer<typeof GetMarketSnapshotsSchema>;

// Aggregated cross-source market summary
// (Intentionally blank) Aggregated market summary moved to CMC MCP server

// Aggregated entry + TPSL plans
export const PlaceEntryWithTPSLPlansSchema = z.object({
  symbol: z.string().describe('Trading pair symbol (e.g., AVAXUSDT)'),
  side: z.enum(['buy', 'sell']).describe('Entry side'),
  type: z.enum(['market', 'limit']).describe('Entry order type'),
  quantity: z.string().describe('Entry quantity'),
  price: z.string().optional().describe('Entry price for limit orders'),
  marginCoin: z.string().optional().default('USDT').describe('Futures margin coin (default: USDT)'),
  marginMode: z.enum(['isolated', 'crossed']).optional().describe('Margin mode to apply for orders'),
  setMarginMode: z.boolean().optional().default(false).describe('If true, attempt to set account margin mode before placing entry'),
  stopLoss: z.object({
    triggerPrice: z.string().describe('Stop loss trigger price'),
  }).optional(),
  takeProfits: z.array(z.object({
    triggerPrice: z.string().describe('Take profit trigger price'),
    size: z.string().describe('Partial size for the take profit'),
  })).optional().describe('Array of partial take profits (profit_plan)'),
  triggerType: z.enum(['fill_price', 'mark_price']).optional().default('mark_price').describe('Trigger type for TPSL and plans'),
  compact: z.boolean().optional().describe('If true, return trimmed summary only')
});

export type PlaceEntryWithTPSLPlansParams = z.infer<typeof PlaceEntryWithTPSLPlansSchema>;
export type GetFuturesStatusParams = z.infer<typeof GetFuturesStatusSchema>;