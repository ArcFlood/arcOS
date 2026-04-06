import { useEffect, useState, useCallback } from 'react'
import ServiceCard from '../services/ServiceCard'
import { useServiceStore } from '../../stores/serviceStore'
import { useToolExecutionStore } from '../../stores/toolExecutionStore'

type WatchdogServiceState = 'unknown' | 'healthy' | 'degraded' | 'failed' | 'recovering'
interface WatchdogServiceEntry {
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
interface WatchdogStatus {
  running: boolean
  lastSweep: string | null
  services: WatchdogServiceEntry[]
}

const STATE_COLORS: Record<string, string> = {
  unknown:    'bg-slate-600 text-slate-300',
  healthy:    'bg-emerald-700 text-white',
  degraded:   'bg-yellow-600 text-black',
  failed:     'bg-red-700 text-white',
  recovering: 'bg-indigo-600 text-white',
}

export default function ServicePanel() {
  const services = useServiceStore((s) => s.services)
  const checkAllServices = useServiceStore((s) => s.checkAllServices)
  const runs = useToolExecutionStore((s) => s.runs)
  const abortRun = useToolExecutionStore((s) => s.abortRun)
  const clearRuns = useToolExecutionStore((s) => s.clearRuns)
  const [watchdogStatus, setWatchdogStatus] = useState<WatchdogStatus | null>(null)
  const orderedServices = [...services].sort((a, b) => {
    const order = ['openclaw', 'fabric', 'arc-memory', 'ollama']
    return order.indexOf(a.name) - order.indexOf(b.name)
  })

  useEffect(() => {
    checkAllServices().catch(() => {})
  }, [checkAllServices])

  // Load initial watchdog status
  const loadWatchdogStatus = useCallback(async () => {
    try {
      const result = await window.electron.watchdogStatus?.()
      if (result?.success && result.status) {
        setWatchdogStatus(result.status)
      }
    } catch {
      // watchdog may not be available
    }
  }, [])

  useEffect(() => {
    void loadWatchdogStatus()

    // Subscribe to live watchdog pushes
    const cleanup = window.electron.watchdogOnStatus?.((status: WatchdogStatus) => {
      setWatchdogStatus(status)
    })

    void window.electron.watchdogSubscribe?.()

    return () => {
      cleanup?.()
      void window.electron.watchdogUnsubscribe?.()
    }
  }, [loadWatchdogStatus])

  const handleForceSweep = () => {
    void window.electron.watchdogSweep?.()
  }

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-text">Services</p>
          <p className="text-xs text-text-muted">Runtime health and controls for active PAI services.</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => checkAllServices()}
            className="arcos-action rounded-md px-2.5 py-1.5 text-xs transition-colors"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Watchdog state badges */}
      {watchdogStatus && (
        <div className="rounded-xl border border-border bg-[#12161b] p-3 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm font-semibold text-text">Watchdog</p>
            <div>
              <span className={`px-2 py-1 rounded text-[10px] uppercase tracking-wider ${watchdogStatus.running ? 'bg-emerald-900/50 text-emerald-400' : 'bg-slate-700 text-slate-400'}`}>
                {watchdogStatus.running ? 'active' : 'stopped'}
              </span>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleForceSweep}
              className="arcos-action rounded-md px-2.5 py-1.5 text-xs transition-colors"
              title={`Watchdog last sweep: ${watchdogStatus.lastSweep ?? 'never'}`}
            >
              Sweep
            </button>
            <button
              onClick={() => checkAllServices()}
              className="arcos-action rounded-md px-2.5 py-1.5 text-xs transition-colors"
            >
              Refresh
            </button>
          </div>
          <p className="text-xs text-text-muted">
            Automated service monitor. Sweep forces an immediate health pass. Refresh only rechecks the service cards.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {watchdogStatus.services.map((ws: WatchdogServiceEntry) => (
              <div key={ws.name} className="flex items-center gap-1 text-[10px]" title={ws.hint || ws.state}>
                <span className={`px-1.5 py-0 rounded font-medium ${STATE_COLORS[ws.state] ?? STATE_COLORS.unknown}`}>
                  {ws.displayName}
                </span>
                <span className="text-slate-500">{ws.state}</span>
              </div>
            ))}
          </div>
          {watchdogStatus.services.some((ws: WatchdogServiceEntry) => ws.hint) && (
            <div className="text-[10px] text-yellow-400 bg-yellow-950/30 border border-yellow-800/40 rounded px-2 py-1">
              {watchdogStatus.services.filter((ws: WatchdogServiceEntry) => ws.hint).map((ws: WatchdogServiceEntry) => (
                <div key={ws.name}><span className="font-medium">{ws.displayName}:</span> {ws.hint}</div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="space-y-3">
        {orderedServices.map((service) => (
          <ServiceCard key={service.name} service={service} />
        ))}
      </div>

      <div className="rounded-xl border border-border bg-[#12161b] p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-text">Recent Tool Runs</p>
            <p className="text-xs text-text-muted">Recent Fabric execution status and output.</p>
          </div>
          <button onClick={clearRuns} className="arcos-action rounded px-2 py-1 text-[10px] uppercase tracking-wider">
            Clear
          </button>
        </div>
        <div className="mt-3 space-y-3">
          {runs.length === 0 ? (
            <div className="rounded-lg border border-border bg-[#101318] px-3 py-5 text-xs text-text-muted">
              No tool runs yet. Execute a Fabric pattern to populate this panel.
            </div>
          ) : (
            runs.map((run) => (
              <div key={run.id} className="rounded-lg border border-border bg-[#101318] px-3 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="break-words text-sm font-medium text-text">{run.title}</p>
                    <p className="mt-1 text-[11px] uppercase tracking-wider text-text-muted">
                      {run.status} · {new Date(run.startedAt).toLocaleTimeString()}
                    </p>
                    <p className="mt-1 text-[11px] uppercase tracking-wider text-text-muted">
                      {run.stageLabel ?? 'Fabric'} · {run.executionMode === 'cli' ? 'CLI fallback' : run.executionMode === 'server' ? 'Server' : 'Resolving'}
                    </p>
                  </div>
                  {run.status === 'running' ? (
                    <button onClick={() => abortRun(run.id)} className="arcos-action rounded px-2 py-1 text-[10px] uppercase tracking-wider">
                      Stop
                    </button>
                  ) : null}
                </div>
                <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-5 text-text-muted">
                  {run.output || run.error || 'Waiting for output...'}
                </p>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
