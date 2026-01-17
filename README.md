# 🚀 MCP Bitget Trading Server

[![MCP](https://img.shields.io/badge/MCP-Model%20Context%20Protocol-blue)](https://modelcontextprotocol.io)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0%2B-blue)](https://www.typescriptlang.org/)
[![Bitget API](https://img.shields.io/badge/Bitget%20API-v2-green)](https://www.bitget.com/api-doc/)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

MCP (Model Context Protocol) server for Bitget cryptocurrency exchange. Enables AI assistants to interact with Bitget API for spot & futures trading. Features real-time market data, order management, account balances, leverage control, and position tracking. Supports demo trading with paper trading mode.

## ✨ Features

### 📊 Market Data
- **Real-time Prices** - Get current market prices for any trading pair
- **Full Tickers** - Complete ticker information with 24h statistics
- **Order Book** - Market depth data with configurable depth levels
- **Historical Candles** - OHLCV data for technical analysis

### 💰 Account Management
- **Balance Information** - Real-time account balances for all assets
- **Position Tracking** - Monitor current futures positions
- **Margin Information** - Futures margin account details
- **Order Management** - View and manage open orders

### 🎯 Trading Operations
- **Place Orders** - Execute market and limit orders
- **Cancel Orders** - Cancel existing orders by ID
- **Leverage Control** - Set leverage for futures positions (1-125x)
- **Demo Trading** - Full support for paper trading mode

### ⚡ Technical Features
- **TypeScript** - Fully typed implementation
- **v2 API Support** - Latest Bitget API integration
- **Rate Limiting** - Built-in protection against API limits
- **Error Handling** - Comprehensive error management
- **Zod Validation** - Input validation for all parameters

## 🛠️ Installation

### Prerequisites
- Node.js 18+

1. **Clone the repository**
```bash
git clone https://github.com/gagarinyury/MCP-bitget-trading.git
cd MCP-bitget-trading
```

2. **Install dependencies**
```bash
npm install
```

3. **Configure environment**
```bash
cp .env.example .env
# Edit .env with your Bitget API credentials
```
## CLI Usage

The `trade-command.js` script lets you place and manage trades using natural language.

- Leverage: `10x`
- Side: `long` | `short`
- Symbol: `avax/usdt`, `btc/usdt` (auto-mapped to contracts like `BTC/USDT:USDT`)
- Order: `@ market` or `@ limit <price>`
- Amount: `amount <qty>` or `size <qty>`
- Stop Loss: `sl <price|percent>` (e.g., `sl 95000`, `sl -1%`)
- Take Profits: `tp <price|percent[@size|%] , ...>` (e.g., `tp 97000@50%, 98000@25%, 99000@25%`)
- Modes: `isolated` | `cross`, and `oneway` | `hedged`
- Sandbox: `sandbox` or `demo` (uses Bitget PAPTRADING)
- Resting: `--resting` converts market to limit with offset; `--resting-depth <value|%>` (default `0.5%`)
- One-way strict: `--oneway-strict` pre-flattens opposite positions and stages TP/SL separately
- Hedged fallback: disabled with `--no-hedged-fallback` (sandbox may then error with unilateral constraints)
- Maintenance: `flatten <symbol>` closes positions; `cancel tps <symbol>` cancels TP-like orders
- Preview: `--dry-run` (no orders placed), `--json` for machine-readable output

Examples:

```bash
node trade-command.js "10x short avax/usdt isolated hedged @ market amount 1 sl 12.5 tp 12.0@50%, 11.5@25%, 11.0@25% sandbox"
node trade-command.js "5x long btc/usdt cross oneway @ limit 95000 amount 0.001 sl -1% tp 1%, 2%"
node trade-command.js "10x long avax/usdt @ market amount 2 sl 13.0 tp 13.5@25%, 14.0@25%, 14.5@50% --resting --resting-depth 1%"
node trade-command.js "flatten btc/usdt sandbox"
node trade-command.js "cancel tps btc/usdt sandbox"
node trade-command.js "3x long btc/usdt @ market amount 0.002 sl 95000 tp 97000, 98000 --dry-run --json"
```

### Demo vs Live (Mainnet)

- Demo: set `BITGET_SANDBOX=true` in environment or add `sandbox` keyword in commands.
- Live: set `BITGET_SANDBOX=false` (or omit), ensure live API keys are configured.
- Claude MCP: provide the environment variables to your MCP server process as shown above; switching the flag toggles demo/mainnet.

### Spot Margin (Optional)

- Switch to spot mode by including `spot` in the command.
- Borrow/Repay:
  - Cross: `spot borrow usdt 100 cross`, `spot repay usdt 100 cross`
  - Isolated: `spot borrow usdt 100 isolated btc/usdt`, `spot repay usdt 100 isolated btc/usdt`
- Place spot margin orders:
  - `spot buy avax/usdt isolated @ market amount 100` (market buy uses quote cost; limit uses base size)
  - `spot sell avax/usdt cross @ limit 12.95 amount 10`

Notes:
- For spot market buy, `amount` represents quote cost; the CLI auto-supplies price for CCXT’s market-buy cost rules.
- Set `marginMode` via `isolated` or `cross` to route orders through margin endpoints.

4. **Build the project**
```bash
npm run build
```

5. **Start the server**
```bash
npm start
```

## 🔧 Configuration

### Environment Variables

Create a `.env` file in the root directory:

```env
# Bitget API Configuration
BITGET_API_KEY=your_api_key_here
BITGET_SECRET_KEY=your_secret_key_here
BITGET_PASSPHRASE=your_passphrase_here

# Environment settings
BITGET_SANDBOX=true  # Set to true for demo trading
BITGET_BASE_URL=https://api.bitget.com
BITGET_WS_URL=wss://wspap.bitget.com/v2/ws/public

# Optional settings
LOG_LEVEL=info
RATE_LIMIT_REQUESTS_PER_SECOND=10
```

### Claude Desktop Integration

Add to your Claude Desktop MCP settings (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "bitget-trading": {
      "command": "node",
      "args": ["/path/to/MCP-bitget-trading/dist/server.js"],
      "env": {
        "BITGET_API_KEY": "your_key",
        "BITGET_SECRET_KEY": "your_secret",
        "BITGET_PASSPHRASE": "your_passphrase",
        "BITGET_SANDBOX": "true"
      }
    }
  }
}
```

## 📚 Available Tools

### Market Data Tools

| Tool | Description | Parameters |
|------|-------------|------------|
| `getPrice` | Get current price | `symbol: string` |
| `getTicker` | Get full ticker info | `symbol: string` |
| `getOrderBook` | Get order book | `symbol: string, depth?: number` |
| `getCandles` | Get OHLCV data | `symbol: string, interval: string, limit?: number` |

### Account Tools

| Tool | Description | Parameters |
|------|-------------|------------|
| `getBalance` | Get account balance | `asset?: string` |
| `getPositions` | Get futures positions | `symbol?: string` |
| `getMarginInfo` | Get margin info | `symbol?: string` |
| `getOrders` | Get open orders | `symbol?: string, status?: string` |

### Trading Tools

| Tool | Description | Parameters |
|------|-------------|------------|
| `placeOrder` | Place new order | `symbol, side, type, quantity, price?` |
| `cancelOrder` | Cancel order | `orderId: string, symbol: string` |
| `setLeverage` | Set leverage | `symbol: string, leverage: number` |

## 🎮 Usage Examples

### Basic Price Check
```typescript
// Get current Bitcoin price
await getPrice({ symbol: "BTCUSDT" })

// Get futures price
await getPrice({ symbol: "BTCUSDT_UMCBL" })
```

### Trading Operations
```typescript
// Place a limit buy order
await placeOrder({
  symbol: "BTCUSDT",
  side: "buy",
  type: "limit",
  quantity: "0.001",
  price: "50000"
})

// Set leverage for futures
await setLeverage({
  symbol: "BTCUSDT_UMCBL",
  leverage: 10
})
```

### Account Information
```typescript
// Check balance
await getBalance({ asset: "USDT" })

// Get all positions
await getPositions({})
```

## 🏗️ Development

### Scripts
```bash
npm run dev      # Development with hot reload
npm run build    # Production build
npm run test     # Run tests
npm run lint     # Lint code
npm run format   # Format code
```

### Project Structure
```
src/
├── api/
│   └── rest-client.ts    # Bitget REST API client
├── types/
│   ├── bitget.ts         # Bitget API types
│   └── mcp.ts           # MCP schema definitions
└── server.ts            # Main MCP server
```

## 📋 Symbol Formats

### Spot Trading
- Format: `BTCUSDT`, `ETHUSDT`, `ADAUSDT`
- No suffix required

### Futures Trading
- Format: `BTCUSDT_UMCBL`, `ETHUSDT_UMCBL`
- `_UMCBL` suffix for USDT-margined contracts

## 🔒 Security

- **API Keys**: Store in environment variables, never commit to code
- **Demo Mode**: Use `BITGET_SANDBOX=true` for paper trading
- **Rate Limiting**: Built-in protection (10 requests/second default)
- **Validation**: All inputs validated with Zod schemas

## 🐛 Troubleshooting

### Common Issues

1. **Error 40009 - Sign signature error**
   - Check API key configuration
   - Ensure timestamp is synchronized

2. **Error 40099 - Exchange environment incorrect**
   - Verify demo/live mode settings
   - Check `paptrading` header for demo mode

3. **Error 400172 - Parameter verification failed**
   - Check required parameters
   - Verify symbol format

## 🤝 Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open Pull Request

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details

## ⚠️ Disclaimer

This software is for educational and development purposes. Use at your own risk. Always test in demo mode before live trading. The authors are not responsible for any financial losses.

## 🔗 Resources

- [Bitget API Documentation](https://www.bitget.com/api-doc/)
- [Model Context Protocol](https://modelcontextprotocol.io)
- [Claude Desktop](https://claude.ai/download)

## 📞 Support

- Issues: [GitHub Issues](https://github.com/gagarinyury/MCP-bitget-trading/issues)
- Discussions: [GitHub Discussions](https://github.com/gagarinyury/MCP-bitget-trading/discussions)

---

Made with ❤️ for the crypto trading community
\n+## CLI Usage
\n+The `trade-command.js` script lets you place and manage trades using natural language.
\n+- Leverage: `10x`
- Side: `long` | `short`
- Symbol: `avax/usdt`, `btc/usdt` (auto-mapped to contracts like `BTC/USDT:USDT`)
- Order: `@ market` or `@ limit <price>`
- Amount: `amount <qty>` or `size <qty>`
- Stop Loss: `sl <price|percent>` (e.g., `sl 95000`, `sl -1%`)
- Take Profits: `tp <price|percent[@size|%] , ...>` (e.g., `tp 97000@50%, 98000@25%, 99000@25%`)
- Modes: `isolated` | `cross`, and `oneway` | `hedged`
- Sandbox: `sandbox` or `demo` (uses Bitget PAPTRADING)
- Resting: `--resting` converts market to limit with offset; `--resting-depth <value|%>` (default `0.5%`)
- One-way strict: `--oneway-strict` pre-flattens opposite positions and stages TP/SL separately
- Hedged fallback: disabled with `--no-hedged-fallback` (sandbox may then error with unilateral constraints)
- Maintenance: `flatten <symbol>` closes positions; `cancel tps <symbol>` cancels TP-like orders
- Preview: `--dry-run` (no orders placed), `--json` for machine-readable output
\n+Examples:
\n+```bash
node trade-command.js "10x short avax/usdt isolated hedged @ market amount 1 sl 12.5 tp 12.0@50%, 11.5@25%, 11.0@25% sandbox"
node trade-command.js "5x long btc/usdt cross oneway @ limit 95000 amount 0.001 sl -1% tp 1%, 2%"
node trade-command.js "10x long avax/usdt @ market amount 2 sl 13.0 tp 13.5@25%, 14.0@25%, 14.5@50% --resting --resting-depth 1%"
node trade-command.js "flatten btc/usdt sandbox"
node trade-command.js "cancel tps btc/usdt sandbox"
node trade-command.js "3x long btc/usdt @ market amount 0.002 sl 95000 tp 97000, 98000 --dry-run --json"
```
\n+Notes:
- In Bitget sandbox, some one-way entries may require hedged fallback. Use `--no-hedged-fallback` to fail fast instead.
- TP/SL attachment to entries may be limited; strict one-way stages them as separate orders.