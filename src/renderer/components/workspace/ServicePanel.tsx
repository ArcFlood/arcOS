import { useEffect, useState, useCallback } from 'react'
import ServiceCard from '../services/ServiceCard'
import { useServiceStore } from '../../stores/serviceStore'

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
  const [watchdogStatus, setWatchdogStatus] = useState<WatchdogStatus | null>(null)

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
          <p className="arcos-kicker mb-1">Runtime Control</p>
          <p className="text-sm font-semibold text-text">Services</p>
          <p className="text-xs text-text-muted">Runtime health and controls for active PAI services.</p>
        </div>
        <div className="flex gap-2">
          {watchdogStatus && (
            <button
              onClick={handleForceSweep}
              className="arcos-action rounded-md px-2.5 py-1.5 text-xs transition-colors"
              title={`Watchdog last sweep: ${watchdogStatus.lastSweep ?? 'never'}`}
            >
              Sweep
            </button>
          )}
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
        <div className="space-y-1">
          <p className="text-xs text-text-muted font-medium">
            Watchdog{' '}
            <span className={`px-1.5 py-0 rounded text-[10px] ml-1 ${watchdogStatus.running ? 'bg-emerald-900/50 text-emerald-400' : 'bg-slate-700 text-slate-400'}`}>
              {watchdogStatus.running ? 'active' : 'stopped'}
            </span>
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
            <div className="text-[10px] text-yellow-400 bg-yellow-950/30 border border-yellow-800/40 rounded px-2 py-1 mt-1">
              {watchdogStatus.services.filter((ws: WatchdogServiceEntry) => ws.hint).map((ws: WatchdogServiceEntry) => (
                <div key={ws.name}><span className="font-medium">{ws.displayName}:</span> {ws.hint}</div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="space-y-3">
        {services.map((service) => (
          <ServiceCard key={service.name} service={service} />
        ))}
      </div>
    </div>
  )
}
