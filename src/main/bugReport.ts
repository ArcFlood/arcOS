/**
 * bugReport.ts — Bug report collection, serialization, and GitHub submission.
 *
 * Collects environment metadata (OS, app version, service health) plus any
 * explicit user description and recent log entries. Intentionally excludes
 * message/conversation content and API keys.
 *
 * Submission path: runs `gh issue create` via the gh CLI if available.
 * Fallback: saves a .json file to ~/.noah-ai-hub/bug-reports/ and opens it.
 */

import os from 'os'
import fs from 'fs'
import path from 'path'
import { execSync, spawnSync } from 'child_process'
import { app } from 'electron'
import { getLogEntries } from './logger'

// ── Types ─────────────────────────────────────────────────────────

export interface BugReportEnvironment {
  appVersion: string
  platform: string
  arch: string
  osRelease: string
  nodeVersion: string
  electronVersion: string
  packaged: boolean
  timestamp: string
}

export interface BugReportServiceHealth {
  ollama: boolean
  arcMemory: boolean
  fabric: boolean
  openClaw: boolean
}

export interface BugReport {
  id: string
  createdAt: string
  title: string
  description: string
  environment: BugReportEnvironment
  serviceHealth: BugReportServiceHealth
  recentErrors: Array<{ timestamp: number; level: string; message: string; detail?: string }>
}

export interface BugReportSubmitResult {
  success: boolean
  method: 'github' | 'file'
  filePath?: string
  issueUrl?: string
  error?: string
}

// ── Environment snapshot ──────────────────────────────────────────

function collectEnvironment(): BugReportEnvironment {
  return {
    appVersion: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    osRelease: os.release(),
    nodeVersion: process.versions.node,
    electronVersion: process.versions.electron ?? 'unknown',
    packaged: app.isPackaged,
    timestamp: new Date().toISOString(),
  }
}

// ── Service health snapshot ───────────────────────────────────────

async function probeService(url: string, timeoutMs = 2000): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    return res.ok || res.status < 500
  } catch {
    return false
  }
}

async function collectServiceHealth(): Promise<BugReportServiceHealth> {
  const [ollama, arcMemory, fabric, openClaw] = await Promise.all([
    probeService('http://localhost:11434/api/tags'),
    probeService('http://localhost:8082/health'),
    probeService('http://localhost:8080/health'),
    probeService('http://localhost:18789/health'),
  ])
  return { ollama, arcMemory, fabric, openClaw }
}

// ── Recent error extraction ───────────────────────────────────────

function collectRecentErrors(maxEntries = 20) {
  try {
    const entries = getLogEntries()
    return entries
      .filter((e) => e.level === 'error' || e.level === 'warn')
      .slice(-maxEntries)
      .map((e) => ({
        timestamp: e.timestamp,
        level: e.level,
        message: e.message,
        detail: e.detail,
      }))
  } catch {
    return []
  }
}

// ── Report assembly ───────────────────────────────────────────────

export async function assembleBugReport(
  title: string,
  description: string,
): Promise<BugReport> {
  const id = `bug-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  const [environment, serviceHealth] = await Promise.all([
    Promise.resolve(collectEnvironment()),
    collectServiceHealth(),
  ])
  const recentErrors = collectRecentErrors()

  return {
    id,
    createdAt: new Date().toISOString(),
    title,
    description,
    environment,
    serviceHealth,
    recentErrors,
  }
}

// ── Serialization to markdown ─────────────────────────────────────

function reportToMarkdown(report: BugReport): string {
  const env = report.environment
  const health = report.serviceHealth

  const serviceLines = [
    `- Ollama (11434): ${health.ollama ? '✅ up' : '❌ down'}`,
    `- ARC-Memory (8082): ${health.arcMemory ? '✅ up' : '❌ down'}`,
    `- Fabric (8080): ${health.fabric ? '✅ up' : '❌ down'}`,
    `- OpenClaw (18789): ${health.openClaw ? '✅ up' : '❌ down'}`,
  ].join('\n')

  const errorLines =
    report.recentErrors.length === 0
      ? '_No recent errors._'
      : report.recentErrors
          .map((e) => {
            const ts = new Date(e.timestamp).toISOString()
            const detail = e.detail ? `\n  > ${e.detail}` : ''
            return `- [${ts}] **${e.level.toUpperCase()}** ${e.message}${detail}`
          })
          .join('\n')

  return `## Bug Report: ${report.title}

**ID:** ${report.id}
**Created:** ${report.createdAt}

### Description
${report.description || '_No description provided._'}

### Environment
- App version: ${env.appVersion}
- Platform: ${env.platform} (${env.arch})
- OS release: ${env.osRelease}
- Node: ${env.nodeVersion}
- Electron: ${env.electronVersion}
- Packaged: ${env.packaged}

### Service Health at Time of Report
${serviceLines}

### Recent Errors / Warnings
${errorLines}
`
}

// ── Storage ───────────────────────────────────────────────────────

function getBugReportsDir(): string {
  const dir = path.join(os.homedir(), '.noah-ai-hub', 'bug-reports')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return dir
}

function saveBugReportFile(report: BugReport): string {
  const dir = getBugReportsDir()
  const safeTitle = report.title.replace(/[^a-z0-9]+/gi, '-').slice(0, 40)
  const fileName = `${report.id}-${safeTitle}.json`
  const filePath = path.join(dir, fileName)
  fs.writeFileSync(filePath, JSON.stringify(report, null, 2), 'utf8')
  return filePath
}

// ── GitHub submission via gh CLI ──────────────────────────────────

function isGhCliAvailable(): boolean {
  try {
    execSync('gh --version', { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function getRepoRemote(): string | null {
  // Try to find the ARCOS repo remote from the project directory.
  const candidates = [
    path.join(os.homedir(), 'AI Project', 'arcos'),
    path.join(os.homedir(), 'arcos'),
  ]
  for (const candidate of candidates) {
    try {
      const remote = execSync('git remote get-url origin', { cwd: candidate, encoding: 'utf8' }).trim()
      if (remote) return remote
    } catch {
      // try next candidate
    }
  }
  return null
}

async function submitToGitHub(report: BugReport): Promise<BugReportSubmitResult> {
  const body = reportToMarkdown(report)
  const labels = 'bug,arcos-auto-report'

  // Find a repo dir with a remote
  const repoRemote = getRepoRemote()
  const repoCandidates = [
    path.join(os.homedir(), 'AI Project', 'arcos'),
    path.join(os.homedir(), 'arcos'),
    process.cwd(),
  ]

  let repoDir: string | null = null
  for (const candidate of repoCandidates) {
    if (fs.existsSync(path.join(candidate, '.git'))) {
      repoDir = candidate
      break
    }
  }

  if (!repoDir) {
    return {
      success: false,
      method: 'github',
      error: 'Could not find ARCOS git repository directory.',
    }
  }

  const result = spawnSync(
    'gh',
    ['issue', 'create', '--title', report.title, '--body', body, '--label', labels],
    { cwd: repoDir, encoding: 'utf8' },
  )

  if (result.status === 0 && result.stdout) {
    const issueUrl = result.stdout.trim()
    return { success: true, method: 'github', issueUrl }
  }

  return {
    success: false,
    method: 'github',
    error: result.stderr || 'gh issue create failed with no stderr',
  }
}

// ── Public entry point ────────────────────────────────────────────

export async function submitBugReport(
  title: string,
  description: string,
): Promise<BugReportSubmitResult> {
  const report = await assembleBugReport(title, description)

  // Always save locally first so the report is never lost.
  const filePath = saveBugReportFile(report)

  if (isGhCliAvailable()) {
    const ghResult = await submitToGitHub(report)
    if (ghResult.success) {
      return { ...ghResult, filePath }
    }
    // GitHub failed — still have the local file
    return { success: true, method: 'file', filePath, error: ghResult.error }
  }

  return { success: true, method: 'file', filePath }
}

export function getBugReportsDirPath(): string {
  return getBugReportsDir()
}
