import { useEffect } from 'react'
import { useCodingRuntimeStore } from '../../stores/codingRuntimeStore'
import AuditPanel from './AuditPanel'
import ErrorLogPanel from '../debug/ErrorLogPanel'

const READINESS_STYLES = {
  ready: 'border-success/30 bg-success/10 text-success',
  needs_sync: 'border-amber-700/40 bg-amber-950/10 text-amber-300',
  pending_local_changes: 'border-[#93a5b8]/30 bg-[#161b21] text-text',
  conflicted: 'border-danger/30 bg-danger/10 text-danger',
  unknown: 'border-border bg-[#161b21] text-text-muted',
} as const

export default function CodingRuntimePanel() {
  const status = useCodingRuntimeStore((s) => s.status)
  const loading = useCodingRuntimeStore((s) => s.loading)
  const error = useCodingRuntimeStore((s) => s.error)
  const refresh = useCodingRuntimeStore((s) => s.refresh)

  useEffect(() => {
    if (!status && !loading) {
      refresh().catch(() => {})
    }
  }, [status, loading, refresh])

  return (
    <div className="space-y-4 p-4">
      <section className="rounded-xl border border-border bg-[#12161b] p-3">
        <div className="mb-3">
          <p className="arcos-kicker mb-1">Error Log</p>
          <p className="text-xs text-text-muted">Main and renderer process logs for troubleshooting ARCOS runtime issues.</p>
        </div>
        <ErrorLogPanel embedded />
      </section>

      <section className="arcos-subpanel rounded-xl p-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="arcos-kicker mb-1">Coding Runtime</p>
            <p className="text-sm font-semibold text-text">Structured repo and verification status</p>
            <p className="text-xs text-text-muted">
              Git/worktree state is normalized here so ARCOS can supervise coding flows without relying on raw terminal output.
            </p>
          </div>
          <button onClick={() => refresh()} className="arcos-action rounded px-2 py-1 text-[10px] uppercase tracking-wider">
            Refresh
          </button>
        </div>
      </section>

      {error && (
        <div className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-3 text-xs text-danger">
          {error}
        </div>
      )}

      {!status ? (
        <div className="rounded-xl border border-border bg-[#12161b] px-4 py-6 text-xs text-text-muted">
          {loading ? 'Loading coding runtime...' : 'No coding runtime data loaded yet.'}
        </div>
      ) : (
        <>
          <section className="grid gap-3 xl:grid-cols-2">
            <div className="rounded-xl border border-border bg-[#12161b] px-3 py-3">
              <div className="flex items-center justify-between gap-2">
                <p className="arcos-kicker">Repository</p>
                <span className={`rounded-full px-2 py-1 text-[10px] uppercase tracking-wider ${READINESS_STYLES[status.mergeReadiness]}`}>
                  {status.mergeReadiness.replace('_', ' ')}
                </span>
              </div>
              <div className="mt-3 space-y-2 text-xs text-text-muted">
                <Stat label="Environment" value={status.environment} />
                <Stat label="Linked OpenClaw workspace" value={status.linkedWorkspacePath} />
                <Stat label="Active repository" value={status.activeRepositoryPath ?? 'Unavailable'} mono />
                <Stat label="Branch" value={status.branch ?? 'Detached / unavailable'} />
                <Stat label="HEAD" value={status.headShortSha ?? 'Unavailable'} mono />
                <Stat label="Upstream" value={status.upstream ?? 'No upstream configured'} mono />
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <OpenPathButton label="Open Repo" path={status.activeRepositoryPath} />
                <OpenPathButton label="Open Workspace" path={status.linkedWorkspacePath} />
                {status.openClawControlUrl && <OpenExternalButton label="Open OpenClaw" url={status.openClawControlUrl} />}
              </div>
            </div>

            <div className="rounded-xl border border-border bg-[#12161b] px-3 py-3">
              <p className="arcos-kicker">Runtime Truth</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Metric label="Worktrees" value={String(status.worktreeCount)} />
                <Metric label="Ahead" value={String(status.aheadCount)} />
                <Metric label="Behind" value={String(status.behindCount)} />
                <Metric label="Conflicts" value={String(status.conflictCount)} />
                <Metric label="Staged" value={String(status.stagedChanges)} />
                <Metric label="Unstaged" value={String(status.unstagedChanges)} />
                <Metric label="Untracked" value={String(status.untrackedFiles)} />
                <Metric label="Stale Branch" value={status.staleBranch ? 'Yes' : 'No'} />
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-border bg-[#12161b] px-3 py-3">
            <p className="arcos-kicker">Verification Scope</p>
            {status.verificationCommands.length === 0 ? (
              <p className="mt-3 text-xs text-text-muted">No structured verification commands detected for the active repository.</p>
            ) : (
              <div className="mt-3 space-y-2">
                {status.verificationCommands.map((command) => (
                  <div key={command} className="rounded-lg border border-border bg-[#0f1318] px-3 py-2">
                    <p className="font-mono text-xs text-text">{command}</p>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      <section className="rounded-xl border border-border bg-[#12161b]">
        <AuditPanel embedded />
      </section>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-[#0f1318] px-3 py-2">
      <p className="text-[10px] uppercase tracking-wider text-text-muted">{label}</p>
      <p className="mt-1 text-sm font-medium text-text">{value}</p>
    </div>
  )
}

function Stat({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-text-muted">{label}</p>
      <p className={`mt-1 break-all ${mono ? 'font-mono text-[11px]' : 'text-xs'} text-text`}>{value}</p>
    </div>
  )
}

function OpenPathButton({ label, path }: { label: string; path: string | null }) {
  return (
    <button
      onClick={() => path && window.electron.openPath(path)}
      disabled={!path}
      className="arcos-action rounded px-2 py-1 text-[10px] uppercase tracking-wider disabled:opacity-40"
    >
      {label}
    </button>
  )
}

function OpenExternalButton({ label, url }: { label: string; url: string }) {
  return (
    <button
      onClick={() => window.electron.openExternal(url)}
      className="arcos-action rounded px-2 py-1 text-[10px] uppercase tracking-wider"
    >
      {label}
    </button>
  )
}
