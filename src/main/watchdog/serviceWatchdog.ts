/**
 * serviceWatchdog.ts — Autonomous service health monitor and recovery engine.
 *
 * Polls all tracked services every POLL_INTERVAL_MS (30s).
 * State machine per service: healthy → degraded → failed → recovering → healthy
 *
 * When a service fails:
 *   1. Look up the recovery recipe.
 *   2. Execute recovery (if action != notify_only).
 *   3. After RECOVERY_WAIT_MS, re-probe.
 *   4. If still down and maxAttempts not exceeded, retry.
 *   5. Broadcast state transitions to subscribed BrowserWindows.
 */

import type { BrowserWindow } from 'electron'
import { log } from '../logger'
import { ingestHookEvent } from '../hooks/hookRegistry'
import { getRecipeForService, executeRecovery } from './recoveryRecipes'

// ── Constants ─────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 30_000
const PROBE_TIMEOUT_MS = 3_000
const RECOVERY_WAIT_MS = 5_000
const DEGRADED_THRESHOLD = 2  // consecutive failures before → degraded
const FAILED_THRESHOLD   = 4  // consecutive failures before → failed

// ── Types ─────────────────────────────────────────────────────────

export type WatchdogServiceState = 'unknown' | 'healthy' | 'degraded' | 'failed' | 'recovering'

export interface WatchdogServiceEntry {
  name: string
  displayName: string
  probeUrl: string
  state: WatchdogServiceState
  consecutiveFailures: number
  recoveryAttempts: number
  lastChecked: string | null
  lastHealthy: string | null
  hint: string
}

export interface WatchdogStatus {
  running: boolean
  lastSweep: string | null
  services: WatchdogServiceEntry[]
}

// ── State ─────────────────────────────────────────────────────────

const serviceEntries: WatchdogServiceEntry[] = [
  { name: 'ollama',      displayName: 'Ollama',      probeUrl: 'http://localhost:11434/api/tags', state: 'unknown', consecutiveFailures: 0, recoveryAttempts: 0, lastChecked: null, lastHealthy: null, hint: '' },
  { name: 'arc-memory',  displayName: 'ARC-Memory',  probeUrl: 'http://localhost:8082/health',    state: 'unknown', consecutiveFailures: 0, recoveryAttempts: 0, lastChecked: null, lastHealthy: null, hint: '' },
  { name: 'fabric',      displayName: 'Fabric',      probeUrl: 'http://localhost:8080/health',    state: 'unknown', consecutiveFailures: 0, recoveryAttempts: 0, lastChecked: null, lastHealthy: null, hint: '' },
  { name: 'openclaw',    displayName: 'OpenClaw',    probeUrl: 'http://localhost:18789/health',   state: 'unknown', consecutiveFailures: 0, recoveryAttempts: 0, lastChecked: null, lastHealthy: null, hint: '' },
]

let watchdogTimer: ReturnType<typeof setInterval> | null = null
let lastSweep: string | null = null
const subscribers = new Set<BrowserWindow>()

// ── Probe ─────────────────────────────────────────────────────────

async function probeService(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
    return res.ok || res.status < 500
  } catch {
    return false
  }
}

// ── State machine transition ──────────────────────────────────────

function transition(entry: WatchdogServiceEntry, isUp: boolean): WatchdogServiceState {
  const prev = entry.state

  if (isUp) {
    entry.consecutiveFailures = 0
    entry.lastHealthy = new Date().toISOString()
    if (prev === 'recovering' || prev === 'failed' || prev === 'degraded') {
      return 'healthy'
    }
    return 'healthy'
  }

  entry.consecutiveFailures++

  if (entry.consecutiveFailures >= FAILED_THRESHOLD) return 'failed'
  if (entry.consecutiveFailures >= DEGRADED_THRESHOLD) return 'degraded'
  return prev === 'unknown' ? 'unknown' : prev
}

// ── Recovery ──────────────────────────────────────────────────────

async function attemptRecovery(entry: WatchdogServiceEntry): Promise<void> {
  const recipe = getRecipeForService(entry.name)
  if (!recipe) return

  if (entry.recoveryAttempts >= recipe.maxAttempts) {
    entry.hint = `Max recovery attempts reached. ${recipe.hint}`
    return
  }

  entry.state = 'recovering'
  entry.recoveryAttempts++
  entry.hint = recipe.hint

  const launched = executeRecovery(recipe)

  if (launched) {
    // Wait a moment then re-probe
    await new Promise((r) => setTimeout(r, RECOVERY_WAIT_MS))
    const isUp = await probeService(entry.probeUrl)
    if (isUp) {
      entry.state = 'healthy'
      entry.consecutiveFailures = 0
      entry.lastHealthy = new Date().toISOString()
      entry.hint = ''
      log.info(`[watchdog] ${entry.name} recovered successfully`)
    }
  }
}

// ── Hook event emission ───────────────────────────────────────────

function emitWatchdogHook(
  entry: WatchdogServiceEntry,
  prevState: WatchdogServiceState,
  newState: WatchdogServiceState,
): void {
  if (prevState === newState) return

  const isDegraded = newState === 'degraded' || newState === 'failed'
  const isFailed = newState === 'failed'

  ingestHookEvent({
    id: `watchdog-${Date.now()}-${entry.name}`,
    eventType: isFailed ? 'runtime.failed' : isDegraded ? 'runtime.degraded' : 'request.accepted',
    stage: 'system',
    status: isFailed ? 'failed' : isDegraded ? 'failed' : 'completed',
    timestamp: new Date().toISOString(),
    requestId: `watchdog-sweep`,
    summary: `${entry.displayName} transitioned ${prevState} → ${newState}`,
    failureClass: isDegraded ? 'service_health' : undefined,
    recoveryHint: entry.hint || undefined,
  })
}

// ── Broadcast ─────────────────────────────────────────────────────

function broadcast(): void {
  const status: WatchdogStatus = {
    running: watchdogTimer !== null,
    lastSweep,
    services: serviceEntries.map((e) => ({ ...e })),
  }
  for (const win of subscribers) {
    try {
      if (!win.isDestroyed()) {
        win.webContents.send('watchdog:status', status)
      } else {
        subscribers.delete(win)
      }
    } catch {
      subscribers.delete(win)
    }
  }
}

// ── Main sweep ────────────────────────────────────────────────────

async function sweep(): Promise<void> {
  lastSweep = new Date().toISOString()

  for (const entry of serviceEntries) {
    const prevState = entry.state
    const isUp = await probeService(entry.probeUrl)
    const newState = transition(entry, isUp)
    entry.lastChecked = new Date().toISOString()

    emitWatchdogHook(entry, prevState, newState)
    entry.state = newState

    // Trigger recovery if newly failed
    if (newState === 'failed' && prevState !== 'failed' && prevState !== 'recovering') {
      await attemptRecovery(entry)
    }
  }

  broadcast()
}

// ── Public API ────────────────────────────────────────────────────

export function startWatchdog(): void {
  if (watchdogTimer) return
  log.info('[watchdog] Starting service watchdog')
  // Initial sweep immediately, then every POLL_INTERVAL_MS
  void sweep()
  watchdogTimer = setInterval(() => { void sweep() }, POLL_INTERVAL_MS)
}

export function stopWatchdog(): void {
  if (watchdogTimer) {
    clearInterval(watchdogTimer)
    watchdogTimer = null
    log.info('[watchdog] Stopped service watchdog')
  }
}

export function getWatchdogStatus(): WatchdogStatus {
  return {
    running: watchdogTimer !== null,
    lastSweep,
    services: serviceEntries.map((e) => ({ ...e })),
  }
}

export function subscribeWatchdogWindow(win: BrowserWindow): void {
  subscribers.add(win)
}

export function unsubscribeWatchdogWindow(win: BrowserWindow): void {
  subscribers.delete(win)
}

export function triggerSweep(): void {
  void sweep()
}
