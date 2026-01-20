import fs from 'fs';
import path from 'path';

type HobRecord = {
  ts: number;
  symbol: string;
  interval: string;
  latestClose?: number;
  hob: any;
};

function ensureDir(dirPath: string) {
  try {
    if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
  } catch {}
}

function telemetryFile(): string {
  const outDir = path.resolve(process.cwd(), 'data');
  ensureDir(outDir);
  return path.join(outDir, 'telemetry.jsonl');
}

export function logHOBs(symbol: string, interval: string, latestClose: number | undefined, hobs: any[]): void {
  if (!Array.isArray(hobs) || hobs.length === 0) return;
  const file = telemetryFile();
  const now = Date.now();
  const lines = hobs.map(h => JSON.stringify({ ts: now, symbol, interval, latestClose, hob: h } as HobRecord)).join('\n') + '\n';
  try {
    fs.appendFileSync(file, lines, { encoding: 'utf-8' });
  } catch {}
}

export function logNote(note: Record<string, any>): void {
  const file = telemetryFile();
  const payload = { ts: Date.now(), type: 'note', ...note };
  try {
    fs.appendFileSync(file, JSON.stringify(payload) + '\n', { encoding: 'utf-8' });
  } catch {}
}

export function logSnapshot(symbol: string, interval: string, latestClose: number | undefined, features: Record<string, any>): void {
  const file = telemetryFile();
  const payload = { ts: Date.now(), type: 'snapshot_features', symbol, interval, latestClose, features };
  try {
    fs.appendFileSync(file, JSON.stringify(payload) + '\n', { encoding: 'utf-8' });
  } catch {}
}