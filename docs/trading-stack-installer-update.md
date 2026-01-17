# Trading Stack Installer Update Guide

This guide describes the changes needed in https://github.com/wolfcubecho/trading-stack to include the CCXT fork and install MCP Bitget Trading with all dependencies.

## 1) CCXT Fork Dependency

CCXT (`github:wolfcubecho/ccxt`) is already declared in the `package.json` of `mcp/MCP-bitget-trading`. Running `npm ci` or `npm install` inside that folder will automatically download and install the forked CCXT. You do not need to add CCXT to the root `trading-stack` `package.json` unless you want it available globally.

## 2) Ensure MCP Bitget Trading Dependencies

If the installer clones or lays out `mcp/MCP-bitget-trading`, add an installer step to install dependencies (which includes the CCXT fork). Prefer `npm ci` for reproducibility when a lockfile is present.

Windows PowerShell:

```powershell
$mcpRepo = Join-Path $RepoRoot "mcp\MCP-bitget-trading"
if (-not (Test-Path $mcpRepo)) { Write-Error "MCP-bitget-trading folder not found at $mcpRepo"; exit 1 }
Push-Location $mcpRepo
if (Test-Path "package-lock.json") { npm ci } else { npm install }
# Optional: run tests if desired
npm test --silent
Pop-Location
```

Bash (existing Linux/macOS installers):

```bash
cd mcp/MCP-bitget-trading
if [ -f package-lock.json ]; then npm ci; else npm install; fi
npm test --silent
```

## 3) Environment Setup for Demo vs Live

- Demo (paper): set `BITGET_SANDBOX=true` and provide demo keys.
- Live (mainnet): set `BITGET_SANDBOX=false` and provide live keys.

Windows PowerShell (temporary for current session):

```powershell
$env:BITGET_API_KEY = "<your_demo_or_live_key>"
$env:BITGET_SECRET_KEY = "<your_demo_or_live_secret>"
$env:BITGET_PASSPHRASE = "<your_demo_or_live_passphrase>"
$env:BITGET_SANDBOX = "true"  # set to "false" for live
$env:BITGET_BASE_URL = "https://api.bitget.com"
$env:BITGET_WS_URL = "wss://ws.bitget.com/v2/ws/public"
```

Windows PowerShell (persistent for user profile):

```powershell
setx BITGET_API_KEY "<your_demo_or_live_key>"
setx BITGET_SECRET_KEY "<your_demo_or_live_secret>"
setx BITGET_PASSPHRASE "<your_demo_or_live_passphrase>"
setx BITGET_SANDBOX "true"  # set to "false" for live
setx BITGET_BASE_URL "https://api.bitget.com"
setx BITGET_WS_URL "wss://ws.bitget.com/v2/ws/public"
```

## 4) Optional: Installer Script Snippet

If the trading-stack has an `install.ps1`, add:

```powershell
Write-Host "Installing MCP-bitget-trading deps (includes CCXT fork)"
$mcpRepo = Join-Path $RepoRoot "mcp\MCP-bitget-trading"
if (-not (Test-Path $mcpRepo)) { Write-Error "Missing $mcpRepo"; exit 1 }
Push-Location $mcpRepo
if (Test-Path "package-lock.json") { npm ci } else { npm install }
Pop-Location
```

For bash-based installers:

```bash
if [ -d "mcp/MCP-bitget-trading" ]; then
  (cd mcp/MCP-bitget-trading && if [ -f package-lock.json ]; then npm ci; else npm install; fi && npm test --silent)
fi
```

## 5) README Update (trading-stack)

Add a note that the MCP Bitget Trading project requires the CCXT fork and that demo/mainnet is controlled via `BITGET_SANDBOX`.

- Demo keyword can also be added directly in commands (e.g., `sandbox`).
- Live runs omit the `sandbox` keyword and use live keys.

## 6) Quick Verification

From `mcp/MCP-bitget-trading`:

```bash
node trade-command.js "10x long btc/usdt cross oneway @ market amount 0.002 sl -1% tp 1%, 2% --dry-run --json"
```

Then try demo vs live:

```bash
# Demo
$env:BITGET_SANDBOX = "true"
node trade-command.js "10x short avax/usdt isolated oneway @ market amount 2 sl 14.2 tp 13.2@50%, 13.0@25%, 12.8@25% sandbox"

# Live
$env:BITGET_SANDBOX = "false"
node trade-command.js "10x short avax/usdt isolated oneway @ market amount 2 sl 14.2 tp 13.2@50%, 13.0@25%, 12.8@25%"
```
