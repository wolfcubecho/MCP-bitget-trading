/**
 * Simple Logger Implementation
 * Provides structured logging with different levels
 */

import { Logger } from '../types/bitget.js';
import fs from 'fs';
import path from 'path';

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3
}

export class SimpleLogger implements Logger {
  private level: LogLevel;
  private logFile: string;

  constructor(level: LogLevel = LogLevel.INFO, logFilePath?: string) {
    this.level = level;
    // Always resolve log file relative to project root, regardless of dist/src
    const rootDir = process.cwd();
    this.logFile = logFilePath || path.join(rootDir, 'logs/bitget-mcp.log');
    // Ensure log directory exists
    try {
      fs.mkdirSync(path.dirname(this.logFile), { recursive: true });
    } catch {}
  }

  private shouldLog(level: LogLevel): boolean {
    return level >= this.level;
  }

  private formatMessage(level: string, message: string, meta?: any): string {
    const timestamp = new Date().toISOString();
    const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
    return `[${timestamp}] [${level}] ${message}${metaStr}`;
  }

  private writeLog(level: string, message: string, meta?: any): void {
    const formatted = this.formatMessage(level, message, meta);
    // Write to console
    if (level === 'ERROR') {
      console.error(formatted);
    } else if (level === 'WARN') {
      console.warn(formatted);
    } else if (level === 'INFO') {
      console.info(formatted);
    } else {
      console.debug(formatted);
    }
    // Write to file (append)
    try {
      fs.appendFileSync(this.logFile, formatted + '\n', { encoding: 'utf8' });
    } catch (err) {
      // Print warning to console if file writing fails
      console.warn('[LOGGER] Failed to write to log file:', this.logFile, err?.message || err);
    }
  }

  debug(message: string, meta?: any): void {
    if (this.shouldLog(LogLevel.DEBUG)) {
      this.writeLog('DEBUG', message, meta);
    }
  }

  info(message: string, meta?: any): void {
    if (this.shouldLog(LogLevel.INFO)) {
      this.writeLog('INFO', message, meta);
    }
  }

  warn(message: string, meta?: any): void {
    if (this.shouldLog(LogLevel.WARN)) {
      this.writeLog('WARN', message, meta);
    }
  }

  error(message: string, meta?: any): void {
    if (this.shouldLog(LogLevel.ERROR)) {
      this.writeLog('ERROR', message, meta);
    }
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }
}

// Global logger instance
export const logger = new SimpleLogger(
  process.env.LOG_LEVEL === 'debug' ? LogLevel.DEBUG :
  process.env.LOG_LEVEL === 'info' ? LogLevel.INFO :
  process.env.LOG_LEVEL === 'warn' ? LogLevel.WARN :
  process.env.LOG_LEVEL === 'error' ? LogLevel.ERROR :
  LogLevel.INFO
);