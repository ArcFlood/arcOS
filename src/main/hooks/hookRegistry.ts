/**
 * hookRegistry.ts — Main process hook event bus.
 *
 * Receives hook events emitted by the canonical chain (renderer → IPC → main),
 * keeps a rolling in-memory log, persists to disk (optional), and
 * forwards events to any registered BrowserWindow subscribers.
 *
 * Built-in internal hooks from openclaw-template/workspace/HOOKS.md:
 *   session-memory, command-logger, bootstrap-extra-files, boot-md
 * These are tracked as registry entries but executed in OpenClaw — ARCOS
 * just records that they exist.
 */

import fs from 'fs'
import path from 'path'
import os from 'os'
import type { BrowserWindow } from 'electron'
import type { HookEvent, HookEventType, HookRegistryEntry } from '../../renderer/stores/hookTypes'

// ── Storage ───────────────────────────────────────────────────────

const HOOK_LOG_DIR = path.join(os.homedir(), '.noah-ai-hub', 'hook-logs')
const MAX_MEMORY_EVENTS = 200
const HOOK_REGISTRY_SOURCE = fs.existsSync(path.join(process.cwd(), 'src/main/hooks/hookRegistry.ts'))
  ? path.join(process.cwd(), 'src/main/hooks/hookRegistry.ts')
  : __filename

const memoryEvents: HookEvent[] = []
const subscribers = new Set<BrowserWindow>()

function ensureHookLogDir(): void {
  if (!fs.existsSync(HOOK_LOG_DIR)) {
    fs.mkdirSync(HOOK_LOG_DIR, { recursive: true })
  }
}

// ── Built-in registry entries (OpenClaw-managed) ──────────────────

const BUILTIN_HOOKS: HookRegistryEntry[] = [
  {
    name: 'session-memory',
    description: 'Persists session state to OpenClaw workspace memory files.',
    subscribedEvents: ['request.accepted', 'model.dispatch.completed'],
    active: true,
    sourceFile: HOOK_REGISTRY_SOURCE,
  },
  {
    name: 'command-logger',
    description: 'Logs all tool and file actions to the OpenClaw command log.',
    subscribedEvents: ['tool.action', 'file.action'],
    active: true,
    sourceFile: HOOK_REGISTRY_SOURCE,
  },
  {
    name: 'bootstrap-extra-files',
    description: 'Loads additional workspace files at boot time.',
    subscribedEvents: ['pai_context.loaded'],
    active: true,
    sourceFile: HOOK_REGISTRY_SOURCE,
  },
  {
    name: 'boot-md',
    description: 'Injects boot-time markdown context into the first request.',
    subscribedEvents: ['request.accepted'],
    active: true,
    sourceFile: HOOK_REGISTRY_SOURCE,
  },
]

// ── Event ingestion ───────────────────────────────────────────────

export function ingestHookEvent(event: HookEvent): void {
  // Rolling memory buffer
  memoryEvents.push(event)
  if (memoryEvents.length > MAX_MEMORY_EVENTS) {
    memoryEvents.splice(0, memoryEvents.length - MAX_MEMORY_EVENTS)
  }

  // Persist to daily NDJSON log (best-effort)
  try {
    ensureHookLogDir()
    const dateStr = new Date().toISOString().slice(0, 10)
    const logFile = path.join(HOOK_LOG_DIR, `hooks-${dateStr}.ndjson`)
    fs.appendFileSync(logFile, JSON.stringify(event) + '\n', 'utf8')
  } catch {
    // intentionally silent
  }

  // Broadcast to all subscribed renderer windows
  for (const win of subscribers) {
    try {
      if (!win.isDestroyed()) {
        win.webContents.send('hook:event', event)
      } else {
        subscribers.delete(win)
      }
    } catch {
      subscribers.delete(win)
    }
  }
}

// ── Subscription management ───────────────────────────────────────

export function subscribeWindow(win: BrowserWindow): void {
  subscribers.add(win)
}

export function unsubscribeWindow(win: BrowserWindow): void {
  subscribers.delete(win)
}

// ── Queries ───────────────────────────────────────────────────────

export function getRecentHookEvents(limit = 100): HookEvent[] {
  return memoryEvents.slice(-limit)
}

export function getHookEventsByType(eventType: HookEventType, limit = 50): HookEvent[] {
  return memoryEvents.filter((e) => e.eventType === eventType).slice(-limit)
}

export function getHookEventsByRequest(requestId: string): HookEvent[] {
  return memoryEvents.filter((e) => e.requestId === requestId)
}

export function getRegisteredHooks(): HookRegistryEntry[] {
  return [...BUILTIN_HOOKS]
}

export function getHookStats(): {
  totalEvents: number
  byType: Record<string, number>
  byStatus: Record<string, number>
  recentFailures: number
} {
  const byType: Record<string, number> = {}
  const byStatus: Record<string, number> = {}
  let recentFailures = 0
  const cutoff = Date.now() - 30 * 60 * 1000 // last 30 min

  for (const e of memoryEvents) {
    byType[e.eventType] = (byType[e.eventType] ?? 0) + 1
    byStatus[e.status] = (byStatus[e.status] ?? 0) + 1
    if (e.status === 'failed' && new Date(e.timestamp).getTime() > cutoff) {
      recentFailures++
    }
  }

  return { totalEvents: memoryEvents.length, byType, byStatus, recentFailures }
}

// ── Daily log file listing ────────────────────────────────────────

export function listHookLogDates(): string[] {
  try {
    ensureHookLogDir()
    return fs
      .readdirSync(HOOK_LOG_DIR)
      .filter((f) => f.startsWith('hooks-') && f.endsWith('.ndjson'))
      .map((f) => f.replace('hooks-', '').replace('.ndjson', ''))
      .sort()
      .reverse()
  } catch {
    return []
  }
}

export function readHookLogForDate(dateStr: string): HookEvent[] {
  try {
    const logFile = path.join(HOOK_LOG_DIR, `hooks-${dateStr}.ndjson`)
    if (!fs.existsSync(logFile)) return []
    return fs
      .readFileSync(logFile, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as HookEvent)
  } catch {
    return []
  }
}
