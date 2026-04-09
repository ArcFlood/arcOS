import { useEffect, useState } from 'react'

type PlatformUpdateTarget = {
  id: 'openclaw' | 'fabric' | 'pai' | 'claude-parity'
  name: string
  status: 'ok' | 'warning' | 'error' | 'unknown'
  installed: boolean
  version?: string
  localPath?: string
  detail: string
  manualCheck: string
  manualUpdate: string
  lastChecked: string
}

type PlatformUpdateCheck = {
  success: boolean
  checkedAt: string
  policy: 'check-only-manual-approval'
  targets: PlatformUpdateTarget[]
  error?: string
}

const STATUS_STYLES: Record<PlatformUpdateTarget['status'], string> = {
  ok: 'border-success/30 bg-success/10 text-success',
  warning: 'border-amber-700/40 bg-amber-950/20 text-amber-300',
  error: 'border-danger/30 bg-danger/10 text-danger',
  unknown: 'border-border bg-[#161b21] text-text-muted',
}

export default function PlatformUpdatesPanel() {
  const [result, setResult] = useState<PlatformUpdateCheck | null>(null)
  const [loading, setLoading] = useState(false)

  const runCheck = async () => {
    setLoading(true)
    try {
      const next = await window.electron.platformUpdatesCheck?.()
      setResult(next ?? {
        success: false,
        checkedAt: new Date().toISOString(),
        policy: 'check-only-manual-approval',
        targets: [],
        error: 'Platform update checks are unavailable in this build.',
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void runCheck()
  }, [])

  return (
    <section className="rounded-xl border border-border bg-[#12161b] p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="arcos-kicker mb-1">Platform Updates</p>
          <p className="text-xs text-text-muted">
            Check-only maintenance status for OpenClaw, Fabric, PAI, and Claude parity. ARCOS does not run update commands automatically.
          </p>
        </div>
        <button
          onClick={() => void runCheck()}
          disabled={loading}
          className="arcos-action rounded px-2 py-1 text-[10px] uppercase tracking-wider disabled:opacity-40"
        >
          {loading ? 'Checking' : 'Check'}
        </button>
      </div>

      {result?.error && (
        <div className="mt-3 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          {result.error}
        </div>
      )}

      <div className="mt-3 space-y-2">
        {(result?.targets ?? []).map((target) => (
          <div key={target.id} className="rounded-lg border border-border bg-[#0f1318] p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-text">{target.name}</p>
                <p className="mt-1 break-words text-xs text-text-muted">{target.detail}</p>
                {target.localPath && (
                  <p className="mt-1 break-all font-mono text-[10px] text-text-muted">{target.localPath}</p>
                )}
              </div>
              <span className={`shrink-0 rounded-full border px-2 py-1 text-[10px] uppercase tracking-wider ${STATUS_STYLES[target.status]}`}>
                {target.status}
              </span>
            </div>

            <div className="mt-3 grid gap-2 md:grid-cols-2">
              <CommandBlock label="Manual Check" command={target.manualCheck} />
              <CommandBlock label="Manual Update" command={target.manualUpdate} />
            </div>
          </div>
        ))}
      </div>

      <p className="mt-3 text-[10px] uppercase tracking-wider text-text-muted">
        Policy: check only, manual approval required before any update command runs.
      </p>
    </section>
  )
}

function CommandBlock({ label, command }: { label: string; command: string }) {
  return (
    <div className="rounded-md border border-border bg-[#0b0f14] px-2 py-2">
      <p className="text-[10px] uppercase tracking-wider text-text-muted">{label}</p>
      <p className="mt-1 break-all font-mono text-[11px] text-text">{command}</p>
    </div>
  )
}
