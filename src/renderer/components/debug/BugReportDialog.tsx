/**
 * BugReportDialog.tsx — Lightweight bug report submission dialog.
 *
 * Collects a title and description from the user, then calls
 * window.electron.bugReportSubmit() which assembles environment metadata,
 * recent errors, service health, and submits via gh CLI or saves locally.
 *
 * Never includes conversation content or API keys.
 */

import { useState } from 'react'

interface Props {
  open: boolean
  onClose: () => void
}

type SubmitState = 'idle' | 'submitting' | 'success' | 'error'

export default function BugReportDialog({ open, onClose }: Props) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [submitState, setSubmitState] = useState<SubmitState>('idle')
  const [resultMessage, setResultMessage] = useState('')

  const handleSubmit = async () => {
    if (!title.trim()) return
    setSubmitState('submitting')
    try {
      const result = await window.electron.bugReportSubmit({ title: title.trim(), description: description.trim() })
      if (result.success) {
        const via = result.issueUrl
          ? `GitHub issue created: ${result.issueUrl}`
          : `Saved locally: ${result.filePath ?? 'unknown path'}`
        setResultMessage(via)
        setSubmitState('success')
      } else {
        setResultMessage(result.error ?? 'Submission failed.')
        setSubmitState('error')
      }
    } catch (e) {
      setResultMessage(String(e))
      setSubmitState('error')
    }
  }

  const handleClose = () => {
    setTitle('')
    setDescription('')
    setSubmitState('idle')
    setResultMessage('')
    onClose()
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="relative flex flex-col bg-[#111318] border border-slate-700/60 rounded-xl shadow-2xl w-[540px] max-w-[95vw]">

        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-700/50 shrink-0">
          <span className="text-base font-semibold text-slate-100">Report a Bug</span>
          <button
            onClick={handleClose}
            className="ml-auto text-slate-400 hover:text-slate-100 text-lg leading-none transition-colors"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-col gap-4 px-4 py-4">

          {submitState === 'success' ? (
            <div className="flex flex-col gap-3">
              <div className="text-emerald-400 text-sm font-medium">Bug report submitted successfully.</div>
              <div className="text-slate-400 text-xs break-all bg-slate-800 rounded px-3 py-2 border border-slate-600">
                {resultMessage}
              </div>
              <p className="text-xs text-slate-500">
                Environment metadata and recent error logs were included. No conversation content or API keys were attached.
              </p>
            </div>
          ) : (
            <>
              <div className="text-xs text-slate-400">
                Automatically attaches environment info and recent error logs.
                <span className="text-slate-500"> No conversation content or API keys are included.</span>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-300">Title *</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Brief description of the issue…"
                  disabled={submitState === 'submitting'}
                  className="bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 disabled:opacity-60"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-300">Details <span className="text-slate-500">(optional)</span></label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Steps to reproduce, what you expected, what actually happened…"
                  disabled={submitState === 'submitting'}
                  rows={5}
                  className="bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 resize-none disabled:opacity-60"
                />
              </div>

              {submitState === 'error' && (
                <div className="text-red-400 text-xs bg-red-950/30 border border-red-800/40 rounded px-3 py-2">
                  {resultMessage}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-slate-700/40 shrink-0">
          {submitState === 'success' ? (
            <button
              onClick={handleClose}
              className="px-4 py-1.5 text-sm rounded bg-slate-700 hover:bg-slate-600 text-slate-100 transition-colors"
            >
              Close
            </button>
          ) : (
            <>
              <button
                onClick={handleClose}
                className="px-4 py-1.5 text-sm rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-600 transition-colors"
                disabled={submitState === 'submitting'}
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={!title.trim() || submitState === 'submitting'}
                className="px-4 py-1.5 text-sm rounded bg-indigo-600 hover:bg-indigo-500 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitState === 'submitting' ? 'Submitting…' : 'Submit Report'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
