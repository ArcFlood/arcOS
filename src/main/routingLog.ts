/**
 * routingLog.ts — JSONL logger for every routing decision.
 *
 * Per PRD v2 FR-11: Every tier selection is logged with reason, confidence,
 * and whether the user overrode it. Stored at:
 *   ~/.noah-ai-hub/history/routing/YYYY-MM-DD_routing.jsonl
 *
 * This gives you a searchable record of all AI routing decisions — useful
 * for identifying patterns, improving routing rules, and debugging bad routes.
 */

import fs from 'fs'
import path from 'path'
import os from 'os'

export interface RoutingEntry {
  timestamp: string          // ISO 8601
  queryPreview: string       // First 50 chars of query
  chosenTier: string         // 'ollama' | 'haiku' | 'arc-sonnet' | 'arc-opus'
  reason: string             // Human-readable routing rationale
  confidence: number         // 0-1, how confident the router was
  wasOverridden: boolean     // true if user manually changed the tier
  conversationId?: string
  estimatedCost?: number     // USD estimate before send
  requestTokens?: {
    used: number
    max: number
    remaining: number
    modelId?: string
  }
}

const HISTORY_ROOT = path.join(os.homedir(), '.noah-ai-hub', 'history', 'routing')

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function todayLogPath(): string {
  const d = new Date()
  const date = d.toISOString().slice(0, 10) // YYYY-MM-DD
  ensureDir(HISTORY_ROOT)
  return path.join(HISTORY_ROOT, `${date}_routing.jsonl`)
}

export function appendRoutingEntry(entry: RoutingEntry): void {
  try {
    const line = JSON.stringify(entry) + '\n'
    fs.appendFileSync(todayLogPath(), line, 'utf8')
  } catch (e) {
    // Never crash the app over logging
    console.warn('[RoutingLog] Failed to write entry:', e)
  }
}

export function getRoutingEntries(dateStr?: string): RoutingEntry[] {
  try {
    const date = dateStr ?? new Date().toISOString().slice(0, 10)
    const filePath = path.join(HISTORY_ROOT, `${date}_routing.jsonl`)
    if (!fs.existsSync(filePath)) return []
    const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n').filter(Boolean)
    return lines.map((l) => {
      try { return JSON.parse(l) as RoutingEntry } catch { return null }
    }).filter(Boolean) as RoutingEntry[]
  } catch {
    return []
  }
}

/** List all dates that have routing logs */
export function getRoutingLogDates(): string[] {
  try {
    ensureDir(HISTORY_ROOT)
    return fs
      .readdirSync(HISTORY_ROOT)
      .filter((f) => f.endsWith('_routing.jsonl'))
      .map((f) => f.replace('_routing.jsonl', ''))
      .sort()
      .reverse()
  } catch {
    return []
  }
}
