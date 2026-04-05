/**
 * auditEngine.ts — Scheduled workspace integrity and chain quality auditor.
 *
 * Runs 7 audit checks on a daily schedule:
 *   1. workspace_integrity    — OpenClaw workspace files present and readable
 *   2. service_health         — All 4 services reachable
 *   3. chain_quality          — Recent chain validation results reviewed
 *   4. memory_freshness       — ARC-Memory last indexed < 48h ago
 *   5. fabric_pattern_coverage — CHAIN_VALIDATION logs checked for pattern failures
 *   6. log_anomalies          — High error rate in last 24h log entries
 *   7. recovery_effectiveness — Watchdog recovery success rate
 *
 * Results stored as JSON in ~/.noah-ai-hub/audits/YYYY-MM-DD.json
 */

import fs from 'fs'
import path from 'path'
import os from 'os'
import { getLogEntries } from '../logger'
import { getWatchdogStatus } from '../watchdog/serviceWatchdog'
import { log } from '../logger'

// ── Types ─────────────────────────────────────────────────────────

export type AuditStatus = 'pass' | 'warn' | 'fail' | 'skip'

export interface AuditCheckResult {
  name: string
  status: AuditStatus
  summary: string
  details?: string
  recommendation?: string
}

export interface AuditReport {
  id: string
  date: string
  runAt: string
  durationMs: number
  overall: AuditStatus
  checks: AuditCheckResult[]
}

// ── Storage ───────────────────────────────────────────────────────

const AUDIT_DIR = path.join(os.homedir(), '.noah-ai-hub', 'audits')

function ensureAuditDir(): void {
  if (!fs.existsSync(AUDIT_DIR)) fs.mkdirSync(AUDIT_DIR, { recursive: true })
}

function saveAuditReport(report: AuditReport): string {
  ensureAuditDir()
  const filePath = path.join(AUDIT_DIR, `${report.date}.json`)
  fs.writeFileSync(filePath, JSON.stringify(report, null, 2), 'utf8')
  return filePath
}

// ── Probe helpers ─────────────────────────────────────────────────

async function probeUrl(url: string, timeoutMs = 2500): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    return res.ok || res.status < 500
  } catch {
    return false
  }
}

// ── Individual checks ─────────────────────────────────────────────

async function checkWorkspaceIntegrity(): Promise<AuditCheckResult> {
  const workspacePath = path.join(os.homedir(), '.openclaw', 'workspace')
  const required = ['AGENTS.md', 'BOOTSTRAP.md', 'SOUL.md', 'IDENTITY.md', 'USER.md', 'TOOLS.md', 'ARCOS_RUNTIME.md', 'HOOKS.md']
  const missing: string[] = []
  const present: string[] = []

  for (const file of required) {
    const full = path.join(workspacePath, file)
    if (fs.existsSync(full)) {
      present.push(file)
    } else {
      missing.push(file)
    }
  }

  if (missing.length === 0) {
    return { name: 'workspace_integrity', status: 'pass', summary: `All ${required.length} workspace files present`, details: `Path: ${workspacePath}` }
  }
  if (missing.length <= 2) {
    return { name: 'workspace_integrity', status: 'warn', summary: `${missing.length} workspace files missing`, details: `Missing: ${missing.join(', ')}`, recommendation: `Run openclaw-boot.sh to regenerate missing files.` }
  }
  return { name: 'workspace_integrity', status: 'fail', summary: `${missing.length} of ${required.length} workspace files missing`, details: `Missing: ${missing.join(', ')}`, recommendation: 'Workspace may need re-initialization. Run openclaw-boot.sh.' }
}

async function checkServiceHealth(): Promise<AuditCheckResult> {
  const services = [
    { name: 'Ollama',     url: 'http://localhost:11434/api/tags' },
    { name: 'ARC-Memory', url: 'http://localhost:8082/health' },
    { name: 'Fabric',     url: 'http://localhost:8080/health' },
    { name: 'OpenClaw',   url: 'http://localhost:18789/health' },
  ]
  const results = await Promise.all(services.map(async (s) => ({ ...s, up: await probeUrl(s.url) })))
  const down = results.filter((r) => !r.up)

  if (down.length === 0) {
    return { name: 'service_health', status: 'pass', summary: 'All 4 services reachable' }
  }
  if (down.length <= 2) {
    return { name: 'service_health', status: 'warn', summary: `${down.length} services unreachable`, details: down.map((d) => d.name).join(', '), recommendation: 'Start missing services before running chains.' }
  }
  return { name: 'service_health', status: 'fail', summary: `${down.length} of 4 services unreachable`, details: down.map((d) => d.name).join(', '), recommendation: 'Most services are down. Check system resources.' }
}

async function checkChainQuality(): Promise<AuditCheckResult> {
  // Look for CHAIN_VALIDATION_LATEST.md in arcos docs
  const candidates = [
    path.join(os.homedir(), 'AI Project', 'arcos', 'docs', 'CHAIN_VALIDATION_LATEST.md'),
    path.join(os.homedir(), 'arcos', 'docs', 'CHAIN_VALIDATION_LATEST.md'),
  ]

  for (const p of candidates) {
    if (fs.existsSync(p)) {
      try {
        const content = fs.readFileSync(p, 'utf8')
        const degradedFallbackCount = (content.match(/degraded-fallback/g) ?? []).length
        const fabricFailures = (content.match(/Fabric executed: no/g) ?? []).length
        if (degradedFallbackCount === 0) {
          return { name: 'chain_quality', status: 'pass', summary: 'All chain paths are optimal' }
        }
        if (fabricFailures > 0) {
          return { name: 'chain_quality', status: 'warn', summary: `${degradedFallbackCount} degraded-fallback paths, ${fabricFailures} Fabric failures`, recommendation: 'Run `fabric -l` to verify pattern availability. Fabric patterns may need reinstall.' }
        }
        return { name: 'chain_quality', status: 'warn', summary: `${degradedFallbackCount} chain paths running degraded`, recommendation: 'Check service availability and re-run chain validation.' }
      } catch {
        // continue
      }
    }
  }

  return { name: 'chain_quality', status: 'skip', summary: 'CHAIN_VALIDATION_LATEST.md not found', recommendation: 'Run chain validation to generate a baseline.' }
}

async function checkMemoryFreshness(): Promise<AuditCheckResult> {
  try {
    const res = await fetch('http://localhost:8082/status', { signal: AbortSignal.timeout(2500) })
    if (!res.ok) throw new Error('non-ok')
    const data = await res.json() as { last_indexed?: string; indexed_docs?: number }
    if (!data.last_indexed) {
      return { name: 'memory_freshness', status: 'warn', summary: 'ARC-Memory has no index timestamp', recommendation: 'Run a memory ingest to initialize the index.' }
    }
    const ageHours = (Date.now() - new Date(data.last_indexed).getTime()) / 3_600_000
    if (ageHours < 48) {
      return { name: 'memory_freshness', status: 'pass', summary: `Memory index ${ageHours.toFixed(1)}h old (${data.indexed_docs ?? '?'} docs)` }
    }
    return { name: 'memory_freshness', status: 'warn', summary: `Memory index ${ageHours.toFixed(1)}h old`, recommendation: 'Trigger a memory ingest to refresh the index.' }
  } catch {
    return { name: 'memory_freshness', status: 'skip', summary: 'ARC-Memory service not reachable for freshness check' }
  }
}

async function checkFabricPatternCoverage(): Promise<AuditCheckResult> {
  // Check whether fabric patterns are available
  const fabricPatternCandidates = [
    path.join(os.homedir(), '.config', 'fabric', 'patterns'),
    path.join(os.homedir(), '.local', 'share', 'fabric', 'patterns'),
  ]

  for (const dir of fabricPatternCandidates) {
    if (fs.existsSync(dir)) {
      try {
        const patterns = fs.readdirSync(dir).filter((f) => fs.statSync(path.join(dir, f)).isDirectory())
        const required = ['code_review', 'prompt_rebuilder', 'summarize']
        const missing = required.filter((p) => !patterns.includes(p))
        if (missing.length === 0) {
          return { name: 'fabric_pattern_coverage', status: 'pass', summary: `${patterns.length} patterns available, required patterns present` }
        }
        return { name: 'fabric_pattern_coverage', status: 'warn', summary: `${missing.length} required patterns missing: ${missing.join(', ')}`, recommendation: 'Run `fabric --update` or manually add missing patterns to the patterns directory.' }
      } catch {
        // continue
      }
    }
  }

  return { name: 'fabric_pattern_coverage', status: 'skip', summary: 'Fabric patterns directory not found', recommendation: 'Install Fabric and run `fabric --setup` to configure patterns.' }
}

async function checkLogAnomalies(): Promise<AuditCheckResult> {
  const entries = getLogEntries()
  const cutoff = Date.now() - 24 * 3_600_000
  const recent = entries.filter((e) => e.timestamp > cutoff)
  const errors = recent.filter((e) => e.level === 'error')
  const warns = recent.filter((e) => e.level === 'warn')
  const errorRate = recent.length > 0 ? errors.length / recent.length : 0

  if (errors.length === 0) {
    return { name: 'log_anomalies', status: 'pass', summary: `0 errors in last 24h (${recent.length} entries, ${warns.length} warnings)` }
  }
  if (errorRate < 0.1) {
    return { name: 'log_anomalies', status: 'warn', summary: `${errors.length} errors in last 24h (${(errorRate * 100).toFixed(1)}% error rate)`, details: errors.slice(-3).map((e) => e.message).join('; ') }
  }
  return { name: 'log_anomalies', status: 'fail', summary: `High error rate: ${errors.length} errors in last 24h (${(errorRate * 100).toFixed(1)}%)`, details: errors.slice(-5).map((e) => e.message).join('; '), recommendation: 'Open the Error Log to investigate recurring errors.' }
}

async function checkRecoveryEffectiveness(): Promise<AuditCheckResult> {
  const watchdog = getWatchdogStatus()
  const attemptedRecoveries = watchdog.services.filter((s) => s.recoveryAttempts > 0)
  const successfulRecoveries = watchdog.services.filter((s) => s.recoveryAttempts > 0 && s.state === 'healthy')

  if (attemptedRecoveries.length === 0) {
    return { name: 'recovery_effectiveness', status: 'pass', summary: 'No recovery attempts — all services stable' }
  }

  const rate = successfulRecoveries.length / attemptedRecoveries.length
  if (rate >= 0.75) {
    return { name: 'recovery_effectiveness', status: 'pass', summary: `${successfulRecoveries.length}/${attemptedRecoveries.length} recoveries successful` }
  }
  const failedNames = watchdog.services.filter((s) => s.recoveryAttempts > 0 && s.state !== 'healthy').map((s) => s.displayName)
  return { name: 'recovery_effectiveness', status: 'warn', summary: `${successfulRecoveries.length}/${attemptedRecoveries.length} recoveries successful`, details: `Still unhealthy: ${failedNames.join(', ')}`, recommendation: 'Manually inspect failed services.' }
}

// ── Main audit runner ─────────────────────────────────────────────

export async function runAudit(): Promise<AuditReport> {
  const startTime = Date.now()
  const date = new Date().toISOString().slice(0, 10)
  log.info('[audit] Starting daily audit run')

  const checks = await Promise.all([
    checkWorkspaceIntegrity(),
    checkServiceHealth(),
    checkChainQuality(),
    checkMemoryFreshness(),
    checkFabricPatternCoverage(),
    checkLogAnomalies(),
    checkRecoveryEffectiveness(),
  ])

  const statusRank: Record<AuditStatus, number> = { pass: 0, skip: 1, warn: 2, fail: 3 }
  const overall: AuditStatus = checks.reduce<AuditStatus>((worst, c) => {
    return statusRank[c.status] > statusRank[worst] ? c.status : worst
  }, 'pass')

  const report: AuditReport = {
    id: `audit-${date}-${Math.random().toString(36).slice(2, 6)}`,
    date,
    runAt: new Date().toISOString(),
    durationMs: Date.now() - startTime,
    overall,
    checks,
  }

  const filePath = saveAuditReport(report)
  log.info(`[audit] Completed — overall: ${overall}, saved to ${filePath}`)

  return report
}

// ── Listing stored reports ────────────────────────────────────────

export function listAuditReports(limit = 30): Array<{ date: string; filePath: string; overall?: AuditStatus }> {
  try {
    ensureAuditDir()
    return fs
      .readdirSync(AUDIT_DIR)
      .filter((f) => f.endsWith('.json'))
      .sort()
      .reverse()
      .slice(0, limit)
      .map((f) => {
        const filePath = path.join(AUDIT_DIR, f)
        const date = f.replace('.json', '')
        try {
          const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as AuditReport
          return { date, filePath, overall: parsed.overall }
        } catch {
          return { date, filePath }
        }
      })
  } catch {
    return []
  }
}

export function readAuditReport(filePath: string): AuditReport | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as AuditReport
  } catch {
    return null
  }
}

// ── Scheduler ─────────────────────────────────────────────────────

let auditTimer: ReturnType<typeof setTimeout> | null = null

function scheduleNextAudit(): void {
  // Run at 3:00 AM local time daily
  const now = new Date()
  const next = new Date(now)
  next.setHours(3, 0, 0, 0)
  if (next <= now) next.setDate(next.getDate() + 1)
  const delay = next.getTime() - now.getTime()

  auditTimer = setTimeout(() => {
    void runAudit()
    scheduleNextAudit()
  }, delay)

  log.info(`[audit] Next audit scheduled for ${next.toISOString()}`)
}

export function startAuditScheduler(): void {
  if (auditTimer) return
  scheduleNextAudit()
}

export function stopAuditScheduler(): void {
  if (auditTimer) {
    clearTimeout(auditTimer)
    auditTimer = null
  }
}

export function getAuditDir(): string {
  return AUDIT_DIR
}
