/**
 * AuditPanel.tsx — Workspace audit viewer and manual trigger.
 *
 * Shows the latest audit report, status per check, and allows
 * the user to trigger a manual audit run or open the audit directory.
 */

import { useEffect, useState } from 'react'

type AuditStatus = 'pass' | 'warn' | 'fail' | 'skip'
interface AuditCheckResult {
  name: string
  status: AuditStatus
  summary: string
  details?: string
  recommendation?: string
}
interface AuditReport {
  id: string
  date: string
  runAt: string
  durationMs: number
  overall: AuditStatus
  checks: AuditCheckResult[]
}
interface AuditReportMeta {
  date: string
  filePath: string
  overall?: AuditStatus
}

const STATUS_COLORS: Record<AuditStatus, string> = {
  pass: 'bg-emerald-700 text-white',
  warn: 'bg-yellow-600 text-black',
  fail: 'bg-red-700 text-white',
  skip: 'bg-slate-600 text-slate-200',
}

const STATUS_RING: Record<AuditStatus, string> = {
  pass: 'border-emerald-700/50',
  warn: 'border-yellow-600/50',
  fail: 'border-red-700/50',
  skip: 'border-slate-600/50',
}

export default function AuditPanel() {
  const [report, setReport] = useState<AuditReport | null>(null)
  const [reports, setReports] = useState<AuditReportMeta[]>([])
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadLatest = async () => {
    try {
      const listResult = await window.electron.auditList?.(5)
      if (listResult?.success && listResult.reports?.length) {
        setReports(listResult.reports)
        const latest = listResult.reports[0]
        const readResult = await window.electron.auditRead?.(latest.filePath)
        if (readResult?.success && readResult.report) {
          setReport(readResult.report)
        }
      }
    } catch (e) {
      setError(String(e))
    }
  }

  useEffect(() => {
    void loadLatest()
  }, [])

  const handleRunAudit = async () => {
    setRunning(true)
    setError(null)
    try {
      const result = await window.electron.auditRun?.()
      if (result?.success && result.report) {
        setReport(result.report)
        void loadLatest()
      } else {
        setError(result?.error ?? 'Audit failed')
      }
    } catch (e) {
      setError(String(e))
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="flex flex-col h-full bg-[#0f1117] text-slate-200 text-xs">

      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-700/50 shrink-0">
        <span className="font-semibold text-sm text-slate-100">Audit</span>
        {report && (
          <span className={`ml-1 px-1.5 py-0 rounded text-[10px] font-bold ${STATUS_COLORS[report.overall]}`}>
            {report.overall.toUpperCase()}
          </span>
        )}
        <div className="ml-auto flex gap-1.5">
          <button
            onClick={() => void window.electron.auditOpenDir?.()}
            className="text-[10px] px-2 py-0.5 rounded border border-slate-600 bg-slate-800 text-slate-300 hover:text-white transition-colors"
          >
            Open dir
          </button>
          <button
            onClick={() => void handleRunAudit()}
            disabled={running}
            className="text-[10px] px-2 py-0.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white transition-colors disabled:opacity-50"
          >
            {running ? 'Running…' : 'Run audit'}
          </button>
        </div>
      </div>

      {error && (
        <div className="mx-3 mt-2 text-red-400 text-[10px] bg-red-950/30 border border-red-800/40 rounded px-2 py-1.5">
          {error}
        </div>
      )}

      {/* Report history pills */}
      {reports.length > 0 && (
        <div className="flex gap-1.5 px-3 py-2 border-b border-slate-700/40 overflow-x-auto shrink-0">
          {reports.map((r) => (
            <button
              key={r.filePath}
              onClick={async () => {
                const result = await window.electron.auditRead?.(r.filePath)
                if (result?.success && result.report) setReport(result.report)
              }}
              className={`px-2 py-0.5 rounded text-[10px] border whitespace-nowrap transition-colors ${
                report?.date === r.date
                  ? 'bg-slate-600 border-slate-500 text-white'
                  : 'bg-slate-800 border-slate-600 text-slate-400 hover:text-slate-200'
              }`}
            >
              {r.date}
              {r.overall && (
                <span className={`ml-1 px-1 rounded text-[9px] ${STATUS_COLORS[r.overall]}`}>{r.overall}</span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Current report */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
        {!report && !running && (
          <div className="flex items-center justify-center h-24 text-slate-500">
            No audit reports yet. Click "Run audit" to run a scan.
          </div>
        )}
        {running && (
          <div className="flex items-center justify-center h-24 text-slate-400">
            Running audit checks…
          </div>
        )}
        {report && !running && (
          <>
            <div className="flex items-center gap-2 text-[10px] text-slate-500 mb-1">
              <span>Run at {new Date(report.runAt).toLocaleString()}</span>
              <span>·</span>
              <span>{report.durationMs}ms</span>
            </div>
            {report.checks.map((check: AuditCheckResult) => (
              <div
                key={check.name}
                className={`rounded border px-3 py-2 ${STATUS_RING[check.status]}`}
              >
                <div className="flex items-center gap-2">
                  <span className={`px-1.5 py-0 rounded text-[9px] font-bold shrink-0 ${STATUS_COLORS[check.status]}`}>
                    {check.status.toUpperCase()}
                  </span>
                  <span className="font-mono text-[11px] text-slate-200">{check.name}</span>
                </div>
                <div className="mt-1 text-slate-300">{check.summary}</div>
                {check.details && (
                  <div className="mt-0.5 text-slate-500">{check.details}</div>
                )}
                {check.recommendation && (
                  <div className="mt-0.5 text-yellow-400">→ {check.recommendation}</div>
                )}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}
