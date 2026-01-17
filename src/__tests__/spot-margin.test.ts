import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const pexec = promisify(exec);
const cwd = path.resolve(__dirname, '../..');

async function runCli(cmd: string) {
  const full = `node trade-command.js \"${cmd}\"`;
  const { stdout } = await pexec(full, { cwd });
  return stdout;
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

describe('spot margin CLI dry-run', () => {
  test('spot dry-run uses spot symbol mapping', async () => {
    const out = await runCli('spot buy avax/usdt isolated @ market amount 10 --dry-run --json');
    const payload = extractJson(out);
    expect(payload.symbol).toMatch(/USDT$/);
    expect(payload.orderType || payload.openType).toBe('market');
  });
});
