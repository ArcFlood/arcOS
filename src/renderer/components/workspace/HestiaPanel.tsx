import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'

const STORAGE_KEY = 'arcos-hestia-widget-settings-v5'

type LocalHestiaSystemMetrics = Awaited<ReturnType<NonNullable<typeof window.electron.hestiaSystemMetrics>>>
type HestiaWidgetId =
  | 'cpu'
  | 'memory'
  | 'disk'
  | 'uptime'
  | 'cpu-cores'
  | 'network'
  | 'disk-usage'
  | 'top-processes'
  | 'sensors'

type HestiaSensorReading = { id: string; label: string; value: string; type: 'temperature' | 'fan' | 'power' | 'current' | 'voltage' | 'battery'; numericValue?: number; max?: number; suffix?: string }
type HestiaWidgetRect = { x: number; y: number; w: number; h: number }

type HestiaWidgetSettings = {
  order: HestiaWidgetId[]
  hidden: HestiaWidgetId[]
  visibleSensorIds: string[]
  layout: Record<HestiaWidgetId, HestiaWidgetRect>
}

type HestiaHistoryPoint = {
  sampledAt: number
  cpu: number
  memory: number
  disk: number
  networkIn: number
  networkOut: number
  topProcessCpu: number
}

type HestiaWidgetDefinition = {
  id: HestiaWidgetId
  title: string
  description: string
  render: () => ReactNode
}

const GRID_COLUMNS = 4
const GRID_ROW_HEIGHT = 92
const GRID_GAP = 0

const DEFAULT_WIDGET_ORDER: HestiaWidgetId[] = [
  'cpu',
  'memory',
  'disk',
  'disk-usage',
  'cpu-cores',
  'top-processes',
  'network',
  'sensors',
  'uptime',
]

const DEFAULT_WIDGET_LAYOUT: Record<HestiaWidgetId, HestiaWidgetRect> = {
  cpu: { x: 0, y: 0, w: 1, h: 2 },
  memory: { x: 1, y: 0, w: 1, h: 2 },
  disk: { x: 2, y: 0, w: 1, h: 2 },
  'disk-usage': { x: 3, y: 0, w: 1, h: 2 },
  'cpu-cores': { x: 0, y: 2, w: 2, h: 3 },
  'top-processes': { x: 2, y: 2, w: 2, h: 3 },
  network: { x: 0, y: 5, w: 2, h: 3 },
  sensors: { x: 2, y: 5, w: 2, h: 4 },
  uptime: { x: 0, y: 8, w: 2, h: 2 },
}

export default function HestiaPanel() {
  const [systemMetrics, setSystemMetrics] = useState<LocalHestiaSystemMetrics | null>(null)
  const [metricsError, setMetricsError] = useState<string | null>(null)
  const [settings, setSettings] = useState<HestiaWidgetSettings>(() => loadWidgetSettings())
  const [history, setHistory] = useState<HestiaHistoryPoint[]>([])
  const [draggedWidgetId, setDraggedWidgetId] = useState<HestiaWidgetId | null>(null)
  const [sensorConfigOpen, setSensorConfigOpen] = useState(false)
  const previousNetworkTotalRef = useRef<number | null>(null)
  const gridRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let active = true
    const loadMetrics = async () => {
      try {
        const next = await window.electron.hestiaSystemMetrics?.()
        if (!active || !next) return
        setSystemMetrics(next)
        const rootDisk = next.disks.find((disk) => disk.mount === '/') ?? next.disks[0]
        const networkIn = next.network.reduce((sum, network) => sum + (network.bytesIn ?? 0), 0)
        const networkOut = next.network.reduce((sum, network) => sum + (network.bytesOut ?? 0), 0)
        const networkTotal = networkIn + networkOut
        const previousNetworkTotal = previousNetworkTotalRef.current
        previousNetworkTotalRef.current = networkTotal
        const networkDelta = previousNetworkTotal === null ? 0 : Math.max(0, networkTotal - previousNetworkTotal)
        if (next.success) {
          const topProcessCpu = next.topProcesses[0]?.cpuPercent ?? 0
          setHistory((current) => [
            ...current,
            {
              sampledAt: next.sampledAt,
              cpu: next.cpu.totalPercent,
              memory: next.memory.usedPercent,
              disk: rootDisk?.usedPercent ?? 0,
              networkIn: networkDelta,
              networkOut: 0,
              topProcessCpu,
            },
          ].slice(-32))
        }
        setMetricsError(next.success ? null : next.error ?? 'System metrics unavailable.')
      } catch (error) {
        if (active) setMetricsError(String(error))
      }
    }

    void loadMetrics()
    const intervalId = window.setInterval(() => void loadMetrics(), 2500)
    return () => {
      active = false
      window.clearInterval(intervalId)
    }
  }, [])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  }, [settings])

  const rootDisk = systemMetrics?.disks.find((disk) => disk.mount === '/') ?? systemMetrics?.disks[0]
  const sampledAt = systemMetrics ? new Date(systemMetrics.sampledAt).toLocaleTimeString() : 'waiting'

  const sensorReadings = useMemo(() => buildSensorReadings(systemMetrics), [systemMetrics])

  const visibleSensorIds = settings.visibleSensorIds.length > 0
    ? settings.visibleSensorIds
    : sensorReadings.map((reading) => reading.id)
  const visibleSensorIdSet = useMemo(() => new Set(visibleSensorIds), [visibleSensorIds])

  const toggleSensorReading = useCallback((id: string) => {
    setSettings((current) => {
      const seed = current.visibleSensorIds.length > 0 ? current.visibleSensorIds : sensorReadings.map((reading) => reading.id)
      const visibleSensorIds = seed.includes(id)
        ? seed.filter((entry) => entry !== id)
        : [...seed, id]
      return { ...current, visibleSensorIds }
    })
  }, [sensorReadings])

  const updateWidgetRect = useCallback((id: HestiaWidgetId, rect: HestiaWidgetRect) => {
    setSettings((current) => ({
      ...current,
      layout: {
        ...current.layout,
        [id]: clampWidgetRect(rect),
      },
    }))
  }, [])

  const definitions = useMemo<HestiaWidgetDefinition[]>(() => [
    {
      id: 'cpu',
      title: 'CPU',
      description: 'Total local CPU utilization.',
      render: () => (
        <MetricContent
          value={formatPercent(systemMetrics?.cpu.totalPercent)}
          detail={systemMetrics ? `${systemMetrics.cpu.coreCount} cores | ${systemMetrics.cpu.model}` : 'waiting for sample'}
          chartValues={history.map((point) => point.cpu)}
          timelineStart={history[0]?.sampledAt}
          timelineEnd={history[history.length - 1]?.sampledAt}
        />
      ),
    },
    {
      id: 'memory',
      title: 'Memory',
      description: 'Local RAM pressure.',
      render: () => (
        <MetricContent
          value={formatPercent(systemMetrics?.memory.usedPercent)}
          detail={systemMetrics ? `${formatBytes(systemMetrics.memory.usedBytes)} / ${formatBytes(systemMetrics.memory.totalBytes)}` : 'waiting for sample'}
          chartValues={history.map((point) => point.memory)}
          timelineStart={history[0]?.sampledAt}
          timelineEnd={history[history.length - 1]?.sampledAt}
        />
      ),
    },
    {
      id: 'disk',
      title: 'Disk',
      description: 'Primary disk usage.',
      render: () => (
        <MetricContent
          value={formatPercent(rootDisk?.usedPercent)}
          detail={rootDisk ? `${rootDisk.mount} | ${formatBytes(rootDisk.usedBytes)} / ${formatBytes(rootDisk.sizeBytes)}` : 'waiting for sample'}
          chartValues={history.map((point) => point.disk)}
          timelineStart={history[0]?.sampledAt}
          timelineEnd={history[history.length - 1]?.sampledAt}
        />
      ),
    },
    {
      id: 'uptime',
      title: 'Uptime / Boot',
      description: 'Local OS uptime and boot timestamp.',
      render: () => (
        <>
          <MetricContent
            value={systemMetrics ? formatDuration(systemMetrics.uptimeSeconds) : 'waiting'}
            detail={systemMetrics ? `${systemMetrics.hostname} | ${systemMetrics.platform}` : 'waiting for sample'}
          />
          <MetricLine
            label="Boot"
            value={systemMetrics ? new Date(systemMetrics.bootTimeIso).toLocaleString() : 'waiting'}
          />
        </>
      ),
    },
    {
      id: 'cpu-cores',
      title: 'CPU Cores',
      description: 'Per-core utilization from local OS telemetry.',
      render: () => (
        <div className="grid gap-1 sm:grid-cols-2">
          {(systemMetrics?.cpu.cores ?? []).slice(0, 12).map((core) => (
            <BarRow key={core.index} label={`Core ${core.index + 1}`} value={core.percent} />
          ))}
          {!systemMetrics && <p className="text-xs text-text-muted">Waiting for CPU sample.</p>}
        </div>
      ),
    },
    {
      id: 'network',
      title: 'Network',
      description: 'Active network interfaces, IP addresses, and traffic counters.',
      render: () => (
        <div className="space-y-2">
          <Sparkline
            values={history.map((point) => point.networkIn + point.networkOut)}
            height={44}
            max={Math.max(1, ...history.map((point) => point.networkIn + point.networkOut))}
            timelineStart={history[0]?.sampledAt}
            timelineEnd={history[history.length - 1]?.sampledAt}
          />
          {systemMetrics?.network.map((network) => (
            <div key={`${network.interfaceName}-${network.address ?? 'unknown'}`} className="hestia-signal">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-semibold text-text">{network.interfaceName}</p>
                <span className="text-[10px] text-text-muted">{network.address ?? 'no address'}</span>
              </div>
              <p className="mt-1 text-[11px] text-text-muted">
                In {formatBytes(network.bytesIn)} | Out {formatBytes(network.bytesOut)}
              </p>
            </div>
          ))}
          {systemMetrics?.network.length === 0 && <p className="text-xs text-text-muted">No active local network interface found.</p>}
          {!systemMetrics && <p className="text-xs text-text-muted">Waiting for network sample.</p>}
        </div>
      ),
    },
    {
      id: 'disk-usage',
      title: 'Disk Usage',
      description: 'Mounted filesystems from local disk telemetry.',
      render: () => (
        <div className="space-y-2">
          {systemMetrics?.disks.slice(0, 1).map((disk) => (
            <DiskPieChart key={`${disk.filesystem}-${disk.mount}`} disk={disk} />
          ))}
          {systemMetrics?.disks.length === 0 && <p className="text-xs text-text-muted">No disk sample available.</p>}
          {!systemMetrics && <p className="text-xs text-text-muted">Waiting for disk sample.</p>}
        </div>
      ),
    },
    {
      id: 'top-processes',
      title: 'Top Processes',
      description: 'Highest CPU processes from the local process table.',
      render: () => (
        <div className="space-y-2">
          <ProcessGraphList processes={systemMetrics?.topProcesses ?? []} />
          {systemMetrics?.topProcesses.length === 0 && <p className="text-xs text-text-muted">No process sample available.</p>}
          {!systemMetrics && <p className="text-xs text-text-muted">Waiting for process sample.</p>}
        </div>
      ),
    },
    {
      id: 'sensors',
      title: 'Sensors',
      description: 'Temperature and sensor readings if a local backend exists.',
      render: () => (
        <div className="space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-text">
                {systemMetrics?.sensors.available
                  ? `${visibleSensorIds.length} visible`
                  : 'Unavailable'}
              </p>
              <p className="truncate text-[10px] text-text-muted">
                {systemMetrics?.sensors.detail ?? 'Waiting for sensor sample.'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSensorConfigOpen((current) => !current)}
              className="arcos-action shrink-0 rounded px-2 py-1 text-[9px] uppercase tracking-wider"
            >
              Configure
            </button>
          </div>
          {sensorConfigOpen && (
            <div className="max-h-40 space-y-1 overflow-auto border border-border bg-[#0b0f14] p-1">
              {sensorReadings.map((reading) => (
                <label key={reading.id} className="flex items-center justify-between gap-2 text-[9px] uppercase tracking-wider text-text-muted">
                  <span className="flex min-w-0 items-center gap-1">
                    <input
                      type="checkbox"
                      checked={visibleSensorIdSet.has(reading.id)}
                      onChange={() => toggleSensorReading(reading.id)}
                    />
                    <span className="truncate">{reading.label}</span>
                  </span>
                  <span className="shrink-0 text-text-muted">{reading.type}</span>
                </label>
              ))}
              {sensorReadings.length === 0 && <p className="text-[10px] text-text-muted">No iSMC readings available yet.</p>}
            </div>
          )}
          <div className="hestia-sensor-grid">
            {sensorReadings.filter((reading) => visibleSensorIdSet.has(reading.id)).map((reading) => (
              <MetricLine key={reading.id} label={reading.label} value={reading.value} />
            ))}
          </div>
        </div>
      ),
    },
  ], [history, rootDisk, sensorConfigOpen, sensorReadings, systemMetrics, toggleSensorReading, visibleSensorIdSet, visibleSensorIds.length])

  const definitionsById = useMemo(() => new Map(definitions.map((definition) => [definition.id, definition])), [definitions])
  const visibleDefinitions = settings.order
    .map((id) => definitionsById.get(id))
    .filter((definition): definition is HestiaWidgetDefinition => Boolean(definition))
    .filter((definition) => !settings.hidden.includes(definition.id))
  const gridRows = Math.max(
    1,
    ...visibleDefinitions.map((definition) => {
      const rect = settings.layout[definition.id] ?? DEFAULT_WIDGET_LAYOUT[definition.id]
      return rect.y + rect.h
    })
  )

  const swapWidgets = (targetId: HestiaWidgetId) => {
    if (!draggedWidgetId || draggedWidgetId === targetId) return
    setSettings((current) => {
      const draggedRect = current.layout[draggedWidgetId] ?? DEFAULT_WIDGET_LAYOUT[draggedWidgetId]
      const targetRect = current.layout[targetId] ?? DEFAULT_WIDGET_LAYOUT[targetId]
      return {
        ...current,
        layout: {
          ...current.layout,
          [draggedWidgetId]: { ...targetRect },
          [targetId]: { ...draggedRect },
        },
      }
    })
    setDraggedWidgetId(null)
  }

  const moveWidgetToPointer = (id: HestiaWidgetId, clientX: number, clientY: number) => {
    const grid = gridRef.current
    if (!grid) return
    const bounds = grid.getBoundingClientRect()
    const rect = settings.layout[id] ?? DEFAULT_WIDGET_LAYOUT[id]
    const columnWidth = bounds.width / GRID_COLUMNS
    const nextX = Math.floor((clientX - bounds.left) / columnWidth)
    const nextY = Math.floor((clientY - bounds.top) / (GRID_ROW_HEIGHT + GRID_GAP))
    updateWidgetRect(id, { ...rect, x: nextX, y: nextY })
  }

  return (
    <div className="hestia-surface h-full overflow-auto p-3">
      <header className="hestia-header">
        <div>
          <p className="arcos-kicker mb-1">Hestia</p>
          <p className="text-sm font-semibold tracking-[0.18em] text-text">ARCOS LOCAL TELEMETRY</p>
          <p className="mt-1 max-w-3xl text-[11px] leading-4 text-text-muted">
            Local tracking only: CPU, memory, disk, network interfaces, top processes, uptime, and sensors when available.
            ARCOS chain, routing, and service state live in their dedicated modules.
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <span className="hestia-live-badge">sampled {sampledAt}</span>
        </div>
      </header>

      {metricsError && (
        <div className="mt-4 rounded border border-danger/40 bg-danger/10 p-3 text-xs text-danger">
          {metricsError}
        </div>
      )}

      <div
        ref={gridRef}
        className="hestia-grid mt-3"
        style={{ minHeight: `${gridRows * (GRID_ROW_HEIGHT + GRID_GAP)}px` }}
      >
        {visibleDefinitions.map((definition) => (
          <WidgetShell
            key={definition.id}
            definition={definition}
            rect={settings.layout[definition.id] ?? DEFAULT_WIDGET_LAYOUT[definition.id]}
            isDragging={draggedWidgetId === definition.id}
            onDragStart={() => setDraggedWidgetId(definition.id)}
            onDragEnd={(event) => {
              moveWidgetToPointer(definition.id, event.clientX, event.clientY)
              setDraggedWidgetId(null)
            }}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => swapWidgets(definition.id)}
          >
            {definition.render()}
          </WidgetShell>
        ))}
      </div>

      <p className="mt-4 text-[10px] uppercase tracking-wider text-text-muted">
        Hestia source: local MIT-licensed hestia-core dashboard. Ported scope: local tracking only.
      </p>
    </div>
  )
}

function WidgetShell({
  definition,
  rect,
  isDragging,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  children,
}: {
  definition: HestiaWidgetDefinition
  rect: HestiaWidgetRect
  isDragging: boolean
  onDragStart: () => void
  onDragEnd: (event: React.DragEvent<HTMLElement>) => void
  onDragOver: (event: React.DragEvent<HTMLElement>) => void
  onDrop: () => void
  children: ReactNode
}) {
  return (
    <section
      className={`hestia-card hestia-widget group ${isDragging ? 'opacity-70' : ''}`}
      onDragOver={onDragOver}
      onDrop={onDrop}
      style={{
        left: `${(rect.x / GRID_COLUMNS) * 100}%`,
        top: `${rect.y * (GRID_ROW_HEIGHT + GRID_GAP)}px`,
        width: `${(rect.w / GRID_COLUMNS) * 100}%`,
        height: `${rect.h * (GRID_ROW_HEIGHT + GRID_GAP)}px`,
      }}
    >
      <div
        className="hestia-widget-header cursor-grab active:cursor-grabbing"
        draggable
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = 'move'
          event.dataTransfer.setData('text/plain', definition.id)
          onDragStart()
        }}
        onDragEnd={onDragEnd}
      >
        <div className="min-w-0">
          <p className="arcos-kicker">{definition.title}</p>
          <p className="mt-0.5 text-[10px] leading-4 text-text-muted">{definition.description}</p>
        </div>
      </div>
      <div className="hestia-widget-body mt-2">{children}</div>
    </section>
  )
}

function MetricContent({
  value,
  detail,
  chartValues,
  timelineStart,
  timelineEnd,
}: {
  value: string
  detail: string
  chartValues?: number[]
  timelineStart?: number
  timelineEnd?: number
}) {
  return (
    <>
      <p className="text-lg font-semibold text-text">{value}</p>
      <p className="mt-1 truncate text-[11px] text-text-muted">{detail}</p>
      {chartValues && <Sparkline values={chartValues} timelineStart={timelineStart} timelineEnd={timelineEnd} />}
    </>
  )
}

function Sparkline({
  values,
  height = 52,
  max = 100,
  timelineStart,
  timelineEnd,
}: {
  values: number[]
  height?: number
  max?: number
  timelineStart?: number
  timelineEnd?: number
}) {
  if (values.length < 2) {
    return <div className="mt-2 h-[42px] border border-border bg-[#0b0f14]" />
  }
  const width = 160
  const ceiling = Math.max(1, max)
  const latest = values[values.length - 1] ?? 0
  const latestPercent = (latest / ceiling) * 100
  const stroke = latestPercent >= 90
    ? 'var(--arcos-danger)'
    : latestPercent >= 50
      ? 'var(--arcos-warning)'
      : 'var(--arcos-success)'
  const fill = latestPercent >= 90
    ? 'rgba(221, 92, 92, 0.16)'
    : latestPercent >= 50
      ? 'rgba(221, 170, 72, 0.16)'
      : 'rgba(90, 167, 115, 0.16)'
  const points = values.map((value, index) => {
    const x = (index / (values.length - 1)) * width
    const y = height - (Math.max(0, Math.min(ceiling, value)) / ceiling) * height
    return `${x.toFixed(2)},${y.toFixed(2)}`
  }).join(' ')
  const area = `0,${height} ${points} ${width},${height}`
  return (
    <div className="mt-2">
      <svg className="h-[42px] w-full border border-border bg-[#0b0f14]" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="Recent metric trend">
        <line x1="0" y1={height * 0.5} x2={width} y2={height * 0.5} stroke="rgba(143, 161, 179, 0.18)" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
        <polyline points={area} fill={fill} stroke="none" />
        <polyline points={points} fill="none" stroke={stroke} strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="mt-1 flex items-center justify-between text-[9px] uppercase tracking-wider text-text-muted">
        <span>{timelineStart ? formatChartTime(timelineStart) : 'start'}</span>
        <span>{timelineEnd ? formatChartTime(timelineEnd) : 'now'}</span>
      </div>
    </div>
  )
}

function DiskPieChart({
  disk,
}: {
  disk: NonNullable<LocalHestiaSystemMetrics>['disks'][number]
}) {
  const percent = Math.max(0, Math.min(100, disk.usedPercent))
  const radius = 24
  const circumference = 2 * Math.PI * radius
  const dash = (percent / 100) * circumference
  const color = percent >= 90 ? 'var(--arcos-danger)' : percent >= 50 ? 'var(--arcos-warning)' : 'var(--arcos-success)'
  return (
    <div className="flex items-center gap-2">
      <svg className="h-14 w-14 shrink-0" viewBox="0 0 64 64" role="img" aria-label={`${disk.mount} disk usage`}>
        <circle cx="32" cy="32" r={radius} fill="none" stroke="rgba(143, 161, 179, 0.22)" strokeWidth="8" />
        <circle
          cx="32"
          cy="32"
          r={radius}
          fill="none"
          stroke={color}
          strokeDasharray={`${dash} ${circumference - dash}`}
          strokeLinecap="butt"
          strokeWidth="8"
          transform="rotate(-90 32 32)"
        />
        <text x="32" y="36" textAnchor="middle" className="fill-current text-[12px] font-semibold text-text">
          {Math.round(percent)}%
        </text>
      </svg>
      <div className="min-w-0">
        <p className="truncate text-xs font-semibold text-text">{disk.mount}</p>
        <p className="mt-0.5 truncate text-[10px] text-text-muted">
          {disk.filesystem} | {formatBytes(disk.usedBytes)} used
        </p>
        <p className="mt-0.5 truncate text-[10px] text-text-muted">
          {formatBytes(disk.availableBytes)} free
        </p>
      </div>
    </div>
  )
}

function ProcessGraphList({
  processes,
}: {
  processes: NonNullable<LocalHestiaSystemMetrics>['topProcesses']
}) {
  const visible = processes.slice(0, 6)
  const maxCpu = Math.max(1, ...visible.map((processInfo) => processInfo.cpuPercent))
  return (
    <div className="space-y-1" role="img" aria-label="Top process CPU graph list">
      {visible.map((processInfo, index) => {
        const percent = Math.max(2, (processInfo.cpuPercent / maxCpu) * 100)
        const color = processInfo.cpuPercent >= 90
          ? 'var(--arcos-danger)'
          : processInfo.cpuPercent >= 50
            ? 'var(--arcos-warning)'
            : 'var(--arcos-success)'
        return (
          <div
            key={`${processInfo.pid}-${processInfo.command}`}
            className="grid grid-cols-[1.4rem_minmax(0,1fr)_3.25rem] items-center gap-2 text-[10px]"
          >
            <span className="text-text-muted">{index + 1}</span>
            <div className="min-w-0">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-semibold text-text">{processInfo.command}</span>
                <span className="shrink-0 text-text-muted">pid {processInfo.pid}</span>
              </div>
              <div className="mt-1 h-2 bg-[#0b0f14]">
                <div className="h-full" style={{ width: `${percent}%`, background: color }} />
              </div>
            </div>
            <span className="text-right text-text-muted">{formatPercent(processInfo.cpuPercent)}</span>
          </div>
        )
      })}
    </div>
  )
}

function MetricLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border border-border bg-[#0b0f14] px-2 py-0.5">
      <p className="truncate text-[11px] font-semibold text-text">{label}</p>
      <span className="shrink-0 text-[10px] text-text-muted">{value}</span>
    </div>
  )
}

function BarRow({ label, value, max = 100, suffix = '%' }: { label: string; value: number; max?: number; suffix?: string }) {
  const safeValue = Math.max(0, Math.min(max, value))
  const percent = max > 0 ? (safeValue / max) * 100 : 0
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <p className="truncate text-[11px] font-semibold text-text">{label}</p>
        <span className="text-[10px] text-text-muted">{suffix === '%' ? formatPercent(safeValue) : `${Math.round(safeValue)}${suffix}`}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden bg-[#0b0f14]">
        <div className="h-full bg-accent" style={{ width: `${percent}%` }} />
      </div>
    </div>
  )
}

function loadWidgetSettings(): HestiaWidgetSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) as Partial<HestiaWidgetSettings> : null
    const order = [
      ...(parsed?.order ?? []).filter((id): id is HestiaWidgetId => DEFAULT_WIDGET_ORDER.includes(id as HestiaWidgetId)),
      ...DEFAULT_WIDGET_ORDER,
    ].filter((id, index, values) => values.indexOf(id) === index)
    const hidden = (parsed?.hidden ?? []).filter((id): id is HestiaWidgetId => DEFAULT_WIDGET_ORDER.includes(id as HestiaWidgetId))
    const visibleSensorIds = Array.isArray(parsed?.visibleSensorIds)
      ? parsed.visibleSensorIds.filter((id): id is string => typeof id === 'string')
      : []
    const layout = normalizeWidgetLayout(parsed?.layout)
    return { order, hidden, visibleSensorIds, layout }
  } catch {
    return { order: DEFAULT_WIDGET_ORDER, hidden: [], visibleSensorIds: [], layout: DEFAULT_WIDGET_LAYOUT }
  }
}

function normalizeWidgetLayout(value: unknown): Record<HestiaWidgetId, HestiaWidgetRect> {
  const raw = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Partial<Record<HestiaWidgetId, Partial<HestiaWidgetRect>>>
    : {}
  return Object.fromEntries(DEFAULT_WIDGET_ORDER.map((id) => {
    const fallback = DEFAULT_WIDGET_LAYOUT[id]
    const rect = raw[id]
    return [id, clampWidgetRect({
      x: typeof rect?.x === 'number' ? rect.x : fallback.x,
      y: typeof rect?.y === 'number' ? rect.y : fallback.y,
      w: typeof rect?.w === 'number' ? rect.w : fallback.w,
      h: typeof rect?.h === 'number' ? rect.h : fallback.h,
    })]
  })) as Record<HestiaWidgetId, HestiaWidgetRect>
}

function clampWidgetRect(rect: HestiaWidgetRect): HestiaWidgetRect {
  const initialX = Math.round(rect.x)
  const initialY = Math.round(rect.y)
  const x = Math.max(0, Math.min(GRID_COLUMNS - 1, initialX))
  const y = Math.max(0, initialY)
  const w = Math.max(1, Math.min(GRID_COLUMNS - x, Math.round(rect.w)))
  const h = Math.max(1, Math.min(6, Math.round(rect.h)))
  return { x, y, w, h }
}

function buildSensorReadings(metrics: LocalHestiaSystemMetrics | null): HestiaSensorReading[] {
  const sensors = metrics?.sensors
  if (!sensors) return []
  return [
    ...sensors.temperatures.map((sensor) => ({
      id: `temperature:${sensor.name}`,
      label: formatSensorLabel(sensor.name),
      value: `${Math.round(sensor.valueCelsius)}C`,
      type: 'temperature' as const,
      numericValue: sensor.valueCelsius,
      max: 110,
      suffix: 'C',
    })),
    ...sensors.fans.map((fan) => ({
      id: `fan:${fan.name}`,
      label: formatSensorLabel(fan.name),
      value: `${Math.round(fan.rpm)} rpm`,
      type: 'fan' as const,
    })),
    ...sensors.power.map((power) => ({
      id: `power:${power.name}`,
      label: formatSensorLabel(power.name),
      value: `${power.watts.toFixed(1)} W`,
      type: 'power' as const,
    })),
    ...sensors.current.map((current) => ({
      id: `current:${current.name}`,
      label: formatSensorLabel(current.name),
      value: `${current.amps.toFixed(2)} A`,
      type: 'current' as const,
    })),
    ...sensors.voltage.map((voltage) => ({
      id: `voltage:${voltage.name}`,
      label: formatSensorLabel(voltage.name),
      value: `${voltage.volts.toFixed(2)} V`,
      type: 'voltage' as const,
    })),
    ...sensors.battery.map((battery) => ({
      id: `battery:${battery.name}`,
      label: formatSensorLabel(battery.name),
      value: battery.value,
      type: 'battery' as const,
    })),
  ]
}

function formatSensorLabel(label: string): string {
  return label
    .replace(/\bCPU Efficiency Core\b/gi, 'E. Core')
    .replace(/\bCPU Performance Core\b/gi, 'CPU P. Core')
}

function formatPercent(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'waiting'
  return `${Math.round(value)}%`
}

function formatBytes(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'unknown'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let amount = value
  let unitIndex = 0
  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024
    unitIndex += 1
  }
  return `${amount >= 10 || unitIndex === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[unitIndex]}`
}

function formatDuration(seconds: number): string {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  if (days > 0) return `${days}d ${hours}h`
  const minutes = Math.floor((seconds % 3600) / 60)
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

function formatChartTime(value: number): string {
  return new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })
}
