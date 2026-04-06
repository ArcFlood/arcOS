import { useState } from 'react'
import { ServiceStatus } from '../../stores/types'
import { useServiceStore } from '../../stores/serviceStore'
import StatusIndicator from './StatusIndicator'
import ServiceButton from './ServiceButton'

export default function ServiceCard({ service }: { service: ServiceStatus }) {
  const [logsOpen, setLogsOpen] = useState(false)
  const [restarting, setRestarting] = useState(false)
  const [copied, setCopied] = useState(false)
  const startService = useServiceStore((s) => s.startService)
  const stopService = useServiceStore((s) => s.stopService)
  const availableOllamaModels = useServiceStore((s) => s.availableOllamaModels)
  const ollamaNoModelsLoaded =
    service.name === 'ollama' &&
    service.running &&
    !service.checking &&
    !restarting &&
    availableOllamaModels.length === 0

  const handleRestart = async () => {
    setRestarting(true)
    await stopService(service.name)
    await new Promise((r) => setTimeout(r, 800))
    await startService(service.name)
    setRestarting(false)
  }

  const statusLabel = service.checking
    ? 'Checking...'
    : restarting
    ? 'Restarting...'
    : ollamaNoModelsLoaded
    ? 'No Models Loaded'
    : service.running
    ? 'Running'
    : 'Stopped'

  const openLink = async (target: string, kind: 'url' | 'path') => {
    if (kind === 'url') {
      await window.electron.openExternal(target)
      return
    }
    await window.electron.openPath(target)
  }

  const canManagePower = service.name !== 'ollama' && service.manageable !== false
  const logLines = [
    service.running ? `${service.displayName} is running` : 'Service not running',
    service.running ? `Listening on port ${service.port}` : null,
    service.name === 'ollama' ? `API: http://localhost:${service.port}/api` : null,
    service.name === 'fabric' ? `REST: http://localhost:${service.port}/api/patterns` : null,
    ...(service.detailLines ?? []),
    service.name === 'ollama' && ollamaNoModelsLoaded ? 'API reachable, but no chat-capable models are currently loaded.' : null,
  ].filter((line): line is string => Boolean(line))

  const handleCopyLogs = async () => {
    await navigator.clipboard.writeText(logLines.join('\n'))
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1200)
  }

  return (
    <div
      className={`rounded-xl border p-3 space-y-3 transition-colors duration-300 ${
        service.running
          ? 'arcos-subpanel border-success/35'
          : 'arcos-subpanel'
      }`}
    >
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <StatusIndicator
            running={service.running}
            checking={service.checking || restarting}
            warning={ollamaNoModelsLoaded}
          />
          <span className="text-sm font-medium text-text">{service.displayName}</span>
          <span className="text-[11px] text-text-muted">:{service.port}</span>
        </div>
        <span
          className={`text-[11px] font-semibold uppercase tracking-wider transition-colors ${
            ollamaNoModelsLoaded
              ? 'text-warning'
              : service.running
              ? 'text-success'
              : service.checking || restarting
              ? 'text-warning'
              : 'text-text-muted'
          }`}
        >
          {statusLabel}
        </span>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-1.5">
        {service.manageable === false ? (
          <p className="text-[11px] text-text-muted">{service.managementNote ?? 'Managed outside ARCOS'}</p>
        ) : (
          <>
            {!canManagePower ? (
              <p className="text-[11px] text-text-muted">
                Ollama is managed outside ARCOS. Restarting it here can disconnect loaded models from the runtime.
              </p>
            ) : !service.running ? (
              <ServiceButton
                label="Start"
                variant="start"
                disabled={service.checking || restarting}
                onClick={() => startService(service.name)}
              />
            ) : (
              <ServiceButton
                label="Stop"
                variant="stop"
                disabled={service.checking || restarting}
                onClick={() => stopService(service.name)}
              />
            )}
            {canManagePower && (
              <ServiceButton
                label={restarting ? 'Restarting...' : 'Restart'}
                variant="restart"
                disabled={service.checking || restarting}
                onClick={handleRestart}
              />
            )}
          </>
        )}
        <button
          onClick={() => setLogsOpen((v) => !v)}
          className="ml-auto text-[11px] text-text-muted hover:text-text transition-colors"
        >
          Logs {logsOpen ? '▾' : '▸'}
        </button>
      </div>

      {/* Error */}
      {service.error && (
        <p className="text-xs text-danger bg-danger/10 rounded-lg px-2 py-1.5">{service.error}</p>
      )}

      {service.name === 'fabric' && (
        <div className="rounded-lg border border-border bg-[#11151a] px-2.5 py-2 text-[11px] text-text-muted">
          Stopping Fabric disables prompt-pattern execution. Restart it when pattern listing or execution becomes unavailable, or after changing the external Fabric runtime.
        </div>
      )}
      {service.name === 'arc-memory' && (
        <div className="rounded-lg border border-border bg-[#11151a] px-2.5 py-2 text-[11px] text-text-muted">
          Stopping ARC-Memory disables retrieval, indexing, and vault synchronization. Restart it after vault-path changes, ingestion issues, or when the memory service becomes unresponsive.
        </div>
      )}

      {/* Logs panel */}
      {logsOpen && (
        <div className="rounded-lg border border-border bg-[#11151a] p-2 text-xs font-mono min-h-[40px] space-y-1">
          <div className="mb-2 flex items-center justify-end">
            <button
              onClick={() => void handleCopyLogs()}
              className="rounded border border-border px-2 py-1 text-[10px] uppercase tracking-wider text-text-muted transition-colors hover:border-[#93a5b8]/35 hover:text-text"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          {service.running ? (
            <>
              <p className="text-success">{service.displayName} is running</p>
              <p className="text-text-muted">Listening on port {service.port}</p>
              {service.name === 'ollama' && (
                <>
                  <p className="text-text-muted">API: http://localhost:{service.port}/api</p>
                  {ollamaNoModelsLoaded && (
                    <p className="text-warning">API reachable, but no chat-capable models are currently loaded.</p>
                  )}
                </>
              )}
              {service.name === 'fabric' && (
                <p className="text-text-muted">REST: http://localhost:{service.port}/api/patterns</p>
              )}
              {service.detailLines?.map((line) => (
                <p key={line} className="text-text-muted">{line}</p>
              ))}
            </>
          ) : (
            <>
              <p className="text-text-muted italic">Service not running</p>
              {service.detailLines?.map((line) => (
                <p key={line} className="text-text-muted">{line}</p>
              ))}
            </>
          )}
          {service.links && service.links.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {service.links.map((link) => (
                <button
                  key={`${service.name}-${link.label}`}
                  onClick={() => openLink(link.target, link.kind)}
                  className="rounded border border-border px-2 py-1 text-[10px] uppercase tracking-wider text-text-muted transition-colors hover:border-[#93a5b8]/35 hover:text-text"
                >
                  {link.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
