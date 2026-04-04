/**
 * sessionHistory.ts — Session summary writer and learnings capture.
 *
 * Per PRD v2 FR-11:
 * - Session summaries → ~/.noah-ai-hub/history/sessions/YYYY-MM/YYYY-MM-DD-HHMMSS_session.md
 * - Learnings       → ~/.noah-ai-hub/history/learnings/YYYY-MM/YYYY-MM-DD_learning.md
 * - Spending CSV    → ~/.noah-ai-hub/history/spending/YYYY-MM_spending.csv
 *
 * Session summaries are generated using Haiku 4.5 — cheap, fast, good enough
 * for structured extraction. Costs fractions of a cent per session.
 */

import fs from 'fs'
import path from 'path'
import os from 'os'

const HISTORY_ROOT = path.join(os.homedir(), '.noah-ai-hub', 'history')
const SESSIONS_ROOT = path.join(HISTORY_ROOT, 'sessions')
const LEARNINGS_ROOT = path.join(HISTORY_ROOT, 'learnings')
const SPENDING_ROOT = path.join(HISTORY_ROOT, 'spending')

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function monthFolder(date: Date): string {
  return date.toISOString().slice(0, 7) // YYYY-MM
}

// ── Session Summary ──────────────────────────────────────────────

export interface SessionSummaryData {
  startedAt: number        // unix ms
  endedAt: number
  messages: Array<{ role: string; content: string; model?: string; cost?: number }>
  modelBreakdown: { ollama: number; haiku: number; sonnet: number; opus: number }
  totalCost: number
  fabricPatternsUsed: string[]
  arcCalls: number
  topics?: string          // auto-extracted via Haiku (filled in after generation)
  notes?: string
}

export function writeSessionSummary(data: SessionSummaryData, haiku_topics: string): string {
  const now = new Date(data.endedAt)
  const started = new Date(data.startedAt)
  const durationMin = Math.round((data.endedAt - data.startedAt) / 60000)
  const month = monthFolder(now)
  const ts = now.toISOString().replace(/[:.]/g, '-').slice(0, 19)

  const dir = path.join(SESSIONS_ROOT, month)
  ensureDir(dir)
  const filePath = path.join(dir, `${ts}_session.md`)

  const lines = [
    `# Session — ${now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}`,
    '',
    `**Started:** ${started.toLocaleTimeString()}  `,
    `**Ended:** ${now.toLocaleTimeString()}  `,
    `**Duration:** ${durationMin} min  `,
    `**Messages:** ${data.messages.filter((m) => m.role !== 'system').length}  `,
    `**Total cost:** $${data.totalCost.toFixed(4)}  `,
    '',
    '## Model Breakdown',
    '',
    `| Tier | Messages |`,
    `|------|----------|`,
    `| Local (Ollama) | ${data.modelBreakdown.ollama} |`,
    `| Haiku | ${data.modelBreakdown.haiku} |`,
    `| A.R.C. Sonnet | ${data.modelBreakdown.sonnet} |`,
    `| A.R.C. Opus | ${data.modelBreakdown.opus} |`,
    '',
    '## Topics',
    '',
    haiku_topics || '_No topics extracted_',
    '',
    ...(data.fabricPatternsUsed.length > 0 ? [
      '## Fabric Patterns Used',
      '',
      data.fabricPatternsUsed.map((p) => `- ${p}`).join('\n'),
      '',
    ] : []),
    ...(data.arcCalls > 0 ? [`**A.R.C. calls:** ${data.arcCalls}`, ''] : []),
    ...(data.notes ? ['## Notes', '', data.notes, ''] : []),
    '---',
    `_Generated automatically by ARCOS_`,
  ]

  fs.writeFileSync(filePath, lines.join('\n'), 'utf8')
  return filePath
}

/** List session files, newest first */
export function listSessionFiles(limit = 30): Array<{ date: string; path: string; filename: string }> {
  try {
    ensureDir(SESSIONS_ROOT)
    const months = fs.readdirSync(SESSIONS_ROOT).filter((d) => /^\d{4}-\d{2}$/.test(d)).sort().reverse()
    const results: Array<{ date: string; path: string; filename: string }> = []

    for (const month of months) {
      const dir = path.join(SESSIONS_ROOT, month)
      const files = fs.readdirSync(dir)
        .filter((f) => f.endsWith('_session.md'))
        .sort()
        .reverse()
      for (const f of files) {
        results.push({
          date: f.slice(0, 10),   // YYYY-MM-DD
          path: path.join(dir, f),
          filename: f,
        })
        if (results.length >= limit) return results
      }
    }
    return results
  } catch {
    return []
  }
}

export function readSessionFile(filePath: string): string {
  try { return fs.readFileSync(filePath, 'utf8') } catch { return '' }
}

// ── Learnings / Bookmarks ────────────────────────────────────────

export interface LearningEntry {
  content: string           // The message text
  model: string             // Which model produced it
  conversationTitle: string
  userTags: string[]
}

export function saveLearning(entry: LearningEntry): string {
  const now = new Date()
  const month = monthFolder(now)
  const date = now.toISOString().slice(0, 10)
  const ts = now.toISOString().replace(/[:.]/g, '-').slice(0, 19)

  const dir = path.join(LEARNINGS_ROOT, month)
  ensureDir(dir)
  const filePath = path.join(dir, `${date}_${ts}_learning.md`)

  const lines = [
    `# Learning — ${now.toLocaleDateString()}`,
    '',
    `**Source:** ${entry.conversationTitle}  `,
    `**Model:** ${entry.model}  `,
    `**Date:** ${now.toISOString()}  `,
    ...(entry.userTags.length > 0 ? [`**Tags:** ${entry.userTags.join(', ')}  `, ''] : ['']),
    '## Content',
    '',
    entry.content,
    '',
    '---',
    '_Saved from ARCOS_',
  ]

  fs.writeFileSync(filePath, lines.join('\n'), 'utf8')
  return filePath
}

export function listLearningFiles(limit = 50): Array<{ date: string; path: string; filename: string }> {
  try {
    ensureDir(LEARNINGS_ROOT)
    const months = fs.readdirSync(LEARNINGS_ROOT).filter((d) => /^\d{4}-\d{2}$/.test(d)).sort().reverse()
    const results: Array<{ date: string; path: string; filename: string }> = []

    for (const month of months) {
      const dir = path.join(LEARNINGS_ROOT, month)
      const files = fs.readdirSync(dir)
        .filter((f) => f.endsWith('_learning.md'))
        .sort()
        .reverse()
      for (const f of files) {
        results.push({
          date: f.slice(0, 10),
          path: path.join(dir, f),
          filename: f,
        })
        if (results.length >= limit) return results
      }
    }
    return results
  } catch {
    return []
  }
}

export function readLearningFile(filePath: string): string {
  try { return fs.readFileSync(filePath, 'utf8') } catch { return '' }
}

// ── Spending CSV export ──────────────────────────────────────────

export interface SpendingCsvRow {
  id: string
  date: string
  model: string
  amount: number
  conversationId?: string
}

export function exportSpendingCsv(records: SpendingCsvRow[], monthStr?: string): string {
  const month = monthStr ?? new Date().toISOString().slice(0, 7)
  ensureDir(SPENDING_ROOT)
  const filePath = path.join(SPENDING_ROOT, `${month}_spending.csv`)

  const header = 'id,date,model,amount_usd,conversation_id\n'
  const rows = records
    .map((r) => `${r.id},${r.date},${r.model},${r.amount.toFixed(6)},${r.conversationId ?? ''}`)
    .join('\n')

  fs.writeFileSync(filePath, header + rows + '\n', 'utf8')
  return filePath
}

// ── Weekly digest ────────────────────────────────────────────────

/** Returns true if today is Monday and no digest has been shown this week */
export function shouldShowWeeklyDigest(lastDigestDate: string | null): boolean {
  const today = new Date()
  if (today.getDay() !== 1) return false // 1 = Monday
  const todayStr = today.toISOString().slice(0, 10)
  return lastDigestDate !== todayStr
}
