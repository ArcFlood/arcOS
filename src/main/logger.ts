/**
 * logger.ts — File-based logger for ARCOS main process.
 *
 * Writes structured log entries to ~/.noah-ai-hub/logs/arcos.log
 * and keeps the last MAX_ENTRIES in memory for the ErrorLog panel.
 * IPC handlers: log:append, log:get-entries, log:clear
 */

import fs from 'fs'
import path from 'path'
import os from 'os'

export type LogLevel = 'info' | 'warn' | 'error'

export interface LogEntry {
  id: string
  level: LogLevel
  source: 'main' | 'renderer'
  message: string
  detail?: string
  timestamp: number // unix ms
}

const MAX_ENTRIES = 500
const LOG_DIR = path.join(os.homedir(), '.noah-ai-hub', 'logs')
const LOG_FILE = path.join(LOG_DIR, 'arcos.log')

const memoryLog: LogEntry[] = []

function ensureLogDir(): void {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true })
  }
}

function formatLine(entry: LogEntry): string {
  const ts = new Date(entry.timestamp).toISOString()
  const detail = entry.detail ? ` | ${entry.detail.replace(/\n/g, ' ↵ ')}` : ''
  return `[${ts}] [${entry.level.toUpperCase()}] [${entry.source}] ${entry.message}${detail}\n`
}

export function appendLog(
  level: LogLevel,
  source: LogEntry['source'],
  message: string,
  detail?: string
): LogEntry {
  const entry: LogEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    level,
    source,
    message,
    detail,
    timestamp: Date.now(),
  }

  // Keep in memory (cap at MAX_ENTRIES)
  memoryLog.push(entry)
  if (memoryLog.length > MAX_ENTRIES) {
    memoryLog.splice(0, memoryLog.length - MAX_ENTRIES)
  }

  // Write to file (best-effort — never crash the app over logging)
  try {
    ensureLogDir()
    fs.appendFileSync(LOG_FILE, formatLine(entry), 'utf8')
  } catch (_) {
    // intentionally silent
  }

  return entry
}

export function getLogEntries(): LogEntry[] {
  return [...memoryLog]
}

export function clearLog(): void {
  memoryLog.splice(0, memoryLog.length)
  try {
    if (fs.existsSync(LOG_FILE)) fs.writeFileSync(LOG_FILE, '', 'utf8')
  } catch {
    // Best-effort log truncation only.
  }
}

export function getLogFilePath(): string {
  return LOG_FILE
}

// Convenience helpers used throughout main.ts
export const log = {
  info: (msg: string, detail?: string) => appendLog('info', 'main', msg, detail),
  warn: (msg: string, detail?: string) => appendLog('warn', 'main', msg, detail),
  error: (msg: string, detail?: string) => appendLog('error', 'main', msg, detail),
}
