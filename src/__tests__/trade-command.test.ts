import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const pexec = promisify(exec);
const cwd = path.resolve(__dirname, '../..');

async function runCli(cmd: string) {
  const full = `node trade-command.js "${cmd}"`;
  const { stdout, stderr } = await pexec(full, { cwd });
  return { stdout, stderr };
}

function extractJson(stdout: string) {
  const start = stdout.indexOf('{');
  const end = stdout.lastIndexOf('}');
  if (start >= 0 && end >= start) {
    const jsonStr = stdout.slice(start, end + 1);
    try {
      return JSON.parse(jsonStr);
    } catch {}
  }
  throw new Error(`No JSON found in stdout. Raw: ${stdout}`);
}

describe('trade-command CLI (--dry-run --json)', () => {
  test('resting-depth converts market to limit with JSON payload', async () => {
    const cmd = '10x long btc/usdt cross oneway --resting --resting-depth 1% @ market amount 0.002 sl -1% tp 1%, 2% --dry-run --json';
    const { stdout } = await runCli(cmd);
    const payload = extractJson(stdout);
    expect(payload).toBeTruthy();
    expect(payload.symbol).toMatch(/BTC\/USDT.*USDT/);
    expect(payload.openType || payload.open_type).toBe('limit');
    expect(typeof payload.entryPrice).toBe('number');
    // tpPreview present for dry-run JSON
    if (payload.tpPreview) {
      expect(Array.isArray(payload.tpPreview)).toBe(true);
      expect(payload.tpPreview.length).toBeGreaterThan(0);
    }
  });

  test('default resting (no depth) still yields limit openType', async () => {
    const cmd = '10x short avax/usdt isolated oneway --resting @ market amount 2 sl 14.2 tp 13.2 --dry-run --json';
    const { stdout } = await runCli(cmd);
    const payload = extractJson(stdout);
    expect(payload).toBeTruthy();
    expect(payload.symbol).toMatch(/AVAX\/USDT.*USDT/);
    expect(payload.openType || payload.open_type).toBe('limit');
    expect(typeof payload.entryPrice).toBe('number');
  });
});
