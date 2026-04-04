import { useMemo, useRef } from 'react'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { WORKSPACE_PANELS } from '../../workspace/presets'
import { WorkspacePanelId } from '../../workspace/types'
import PanelErrorBoundary from './PanelErrorBoundary'
import WorkspacePanelContent from './WorkspacePanelContent'

interface WorkspaceShellProps {
  onOpenHistory: () => void
  onOpenMemory: () => void
  onOpenLog: () => void
  onOpenSettings: () => void
}

export default function WorkspaceShell(props: WorkspaceShellProps) {
  const layout = useWorkspaceStore((s) => s.layout)
  const diagnostics = useWorkspaceStore((s) => s.diagnostics)
  const panelFailureCounts = useWorkspaceStore((s) => s.panelFailureCounts)
  const clearDiagnostics = useWorkspaceStore((s) => s.clearDiagnostics)
  const resetWorkspace = useWorkspaceStore((s) => s.resetWorkspace)
  const beginPlacement = useWorkspaceStore((s) => s.beginPlacement)
  const pendingPlacement = useWorkspaceStore((s) => s.pendingPlacement)
  const cancelPlacement = useWorkspaceStore((s) => s.cancelPlacement)
  const addPanelAtPending = useWorkspaceStore((s) => s.addPanelAtPending)

  const failureCount = Object.values(panelFailureCounts).reduce((sum, count) => sum + (count ?? 0), 0)
  const occupiedCells = useMemo(() => {
    const cells = new Set<string>()
    for (const module of layout.modules) {
      for (let row = module.row; row < module.row + module.height; row += 1) {
        for (let column = module.column; column < module.column + module.width; column += 1) {
          cells.add(`${column}:${row}`)
        }
      }
    }
    return cells
  }, [layout.modules])

  return (
    <div className="arcos-shell flex-1 overflow-hidden">
      {(diagnostics.length > 0 || failureCount > 0) && (
        <div className="border-b border-border bg-[#12171d] px-4 py-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="arcos-kicker mb-1">Workspace Recovery</p>
              <p className="text-sm font-semibold text-text">ARCOS detected recoverable workspace issues.</p>
              <div className="mt-2 space-y-1 text-xs text-text-muted">
                {diagnostics.slice(-3).map((entry, index) => (
                  <p key={`${entry}-${index}`}>{entry}</p>
                ))}
                {failureCount > 0 && <p>{failureCount} isolated panel failure event{failureCount === 1 ? '' : 's'}.</p>}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button onClick={clearDiagnostics} className="arcos-action rounded px-3 py-2 text-xs">
                Clear Notices
              </button>
              <button onClick={resetWorkspace} className="arcos-action-primary rounded px-3 py-2 text-xs">
                Reset Empty Workspace
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="h-full overflow-auto p-0">
        <div
          data-arcos-grid-shell="true"
          className="grid h-full min-h-[640px] gap-px bg-[rgba(70,81,94,0.58)]"
          style={{
            gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${layout.rows}, minmax(160px, 1fr))`,
          }}
        >
          {Array.from({ length: layout.rows * layout.columns }, (_, index) => {
            const column = (index % layout.columns) + 1
            const row = Math.floor(index / layout.columns) + 1
            const cellKey = `${column}:${row}`
            if (occupiedCells.has(cellKey)) return null

            const isPickerOpen = pendingPlacement?.column === column && pendingPlacement?.row === row
            return (
              <div
                key={cellKey}
                className="relative bg-[#12161b]"
                style={{ gridColumn: `${column} / span 1`, gridRow: `${row} / span 1` }}
              >
                <button
                  onClick={() => isPickerOpen ? cancelPlacement() : beginPlacement(column, row)}
                  className="flex h-full w-full items-center justify-center text-center transition-colors hover:bg-[#151a21]"
                  title="Add module"
                />

                {isPickerOpen && (
                  <div className="absolute inset-0 z-20 overflow-auto border border-border bg-[#0f1318] p-2 shadow-xl">
                    <div className="mb-2 flex items-center justify-between">
                      <p className="arcos-kicker">Add Module</p>
                      <button onClick={cancelPlacement} className="arcos-action rounded px-2 py-1 text-[10px] uppercase tracking-wider">
                        Close
                      </button>
                    </div>
                    <div className="space-y-2">
                      {WORKSPACE_PANELS.map((panel) => (
                        <button
                          key={panel.id}
                          onClick={() => addPanelAtPending(panel.id)}
                          className="w-full border border-border bg-[#12161b] px-2 py-2 text-left transition-colors hover:border-[#8fa1b3]/30 hover:bg-[#171c22]"
                        >
                          <div className="flex items-start gap-3">
                            <span className="text-lg">{panel.icon}</span>
                            <div>
                              <p className="text-sm font-medium text-text">{panel.title}</p>
                              <p className="mt-1 text-xs leading-5 text-text-muted">{panel.description}</p>
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )
          })}

          {layout.modules.map((module) => (
            <GridModule key={module.id} moduleId={module.id} panelId={module.panelId} {...props} />
          ))}
        </div>
      </div>
    </div>
  )
}

function GridModule({
  moduleId,
  panelId,
  onOpenHistory,
  onOpenMemory,
  onOpenLog,
  onOpenSettings,
}: WorkspaceShellProps & { moduleId: string; panelId: WorkspacePanelId }) {
  const module = useWorkspaceStore((s) => s.layout.modules.find((entry) => entry.id === moduleId))
  const removeModule = useWorkspaceStore((s) => s.removeModule)
  const moveModule = useWorkspaceStore((s) => s.moveModule)
  const resizeModule = useWorkspaceStore((s) => s.resizeModule)
  const detachPanel = useWorkspaceStore((s) => s.detachPanel)
  const recordPanelFailure = useWorkspaceStore((s) => s.recordPanelFailure)
  const resetWorkspace = useWorkspaceStore((s) => s.resetWorkspace)
  const frameRef = useRef<HTMLElement | null>(null)

  if (!module) return null

  const panel = WORKSPACE_PANELS.find((entry) => entry.id === panelId)
  if (!panel) return null

  return (
    <section
      ref={frameRef}
      className="arcos-panel group relative flex min-h-0 flex-col overflow-hidden"
      style={{
        gridColumn: `${module.column} / span ${module.width}`,
        gridRow: `${module.row} / span ${module.height}`,
      }}
    >
      <header
        className="titlebar-no-drag arcos-panel-head flex cursor-move items-center justify-between border-b px-2 py-1.5"
        onMouseDown={(event) => startMove(event, module, frameRef.current, moveModule)}
      >
        <div className="min-w-0">
          <p className="arcos-kicker mb-0.5">Module</p>
          <h2 className="truncate text-sm font-semibold text-text">{panel.icon} {panel.title}</h2>
          <p className="truncate text-[11px] text-text-muted">{panel.description}</p>
        </div>
        <div className="ml-3 flex items-center gap-1">
          <button
            onClick={() => detachPanel(panel.id)}
            className="arcos-action rounded px-1.5 py-1 text-[10px] uppercase tracking-wider"
            title="Detach module"
          >
            []
          </button>
          <button
            onClick={() => removeModule(module.id)}
            className="arcos-action rounded px-1.5 py-1 text-[10px] uppercase tracking-wider"
            title="Remove module"
          >
            ×
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto">
        <PanelErrorBoundary
          panelId={panel.id}
          onError={recordPanelFailure}
          onRecoverWorkspace={resetWorkspace}
        >
          <WorkspacePanelContent
            panelId={panel.id}
            onOpenHistory={onOpenHistory}
            onOpenMemory={onOpenMemory}
            onOpenLog={onOpenLog}
            onOpenSettings={onOpenSettings}
          />
        </PanelErrorBoundary>
      </div>
      <ResizeHandle
        orientation="left"
        onResizeStart={(event) => startResize(event, 'left', module, frameRef.current, resizeModule)}
      />
      <ResizeHandle
        orientation="right"
        onResizeStart={(event) => startResize(event, 'right', module, frameRef.current, resizeModule)}
      />
      <ResizeHandle
        orientation="top"
        onResizeStart={(event) => startResize(event, 'top', module, frameRef.current, resizeModule)}
      />
      <ResizeHandle
        orientation="bottom"
        onResizeStart={(event) => startResize(event, 'bottom', module, frameRef.current, resizeModule)}
      />
      <ResizeHandle
        orientation="top_left"
        onResizeStart={(event) => startResize(event, 'top_left', module, frameRef.current, resizeModule)}
      />
      <ResizeHandle
        orientation="corner"
        onResizeStart={(event) => startResize(event, 'corner', module, frameRef.current, resizeModule)}
      />
    </section>
  )
}

function ResizeHandle({
  orientation,
  onResizeStart,
}: {
  orientation: 'left' | 'right' | 'top' | 'bottom' | 'top_left' | 'corner'
  onResizeStart: (event: React.MouseEvent<HTMLDivElement>) => void
}) {
  const shared = 'absolute titlebar-no-drag bg-[#93a5b8]/22 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-[#93a5b8]/45'

  if (orientation === 'left') {
    return (
      <div
        onMouseDown={onResizeStart}
        className={`${shared} left-1 top-1/2 h-16 w-2 -translate-y-1/2 cursor-ew-resize`}
        title="Resize width"
      />
    )
  }

  if (orientation === 'right') {
    return (
      <div
        onMouseDown={onResizeStart}
        className={`${shared} group right-1 top-1/2 h-16 w-2 -translate-y-1/2 cursor-ew-resize`}
        title="Resize width"
      />
    )
  }

  if (orientation === 'top') {
    return (
      <div
        onMouseDown={onResizeStart}
        className={`${shared} left-1/2 top-1 h-2 w-16 -translate-x-1/2 cursor-ns-resize`}
        title="Resize height"
      />
    )
  }

  if (orientation === 'bottom') {
    return (
      <div
        onMouseDown={onResizeStart}
        className={`${shared} group bottom-1 left-1/2 h-2 w-16 -translate-x-1/2 cursor-ns-resize`}
        title="Resize height"
      />
    )
  }

  if (orientation === 'top_left') {
    return (
      <div
        onMouseDown={onResizeStart}
        className={`${shared} left-1 top-1 h-4 w-4 cursor-nwse-resize`}
        title="Resize module"
      />
    )
  }

  return (
    <div
      onMouseDown={onResizeStart}
      className={`${shared} group bottom-1 right-1 h-4 w-4 cursor-nwse-resize`}
      title="Resize module"
    />
  )
}

function startResize(
  event: React.MouseEvent<HTMLDivElement>,
  orientation: 'left' | 'right' | 'top' | 'bottom' | 'top_left' | 'corner',
  module: { id: string; column: number; row: number; width: number; height: number },
  frame: HTMLElement | null,
  resizeModule: (moduleId: string, column: number, row: number, width: number, height: number) => void
) {
  event.preventDefault()
  event.stopPropagation()
  if (!frame) return

  const gridShell = frame.parentElement
  if (!gridShell || gridShell.getAttribute('data-arcos-grid-shell') !== 'true') return

  const gridStyles = window.getComputedStyle(gridShell)
  const columnGap = parseFloat(gridStyles.columnGap || gridStyles.gap || '0')
  const rowGap = parseFloat(gridStyles.rowGap || gridStyles.gap || '0')
  const columns = gridStyles.gridTemplateColumns.split(' ').length
  const rows = gridStyles.gridTemplateRows.split(' ').length
  const rect = gridShell.getBoundingClientRect()
  const cellWidth = (rect.width - columnGap * Math.max(columns - 1, 0)) / columns
  const cellHeight = (rect.height - rowGap * Math.max(rows - 1, 0)) / rows
  const originLeft = rect.left + (module.column - 1) * (cellWidth + columnGap)
  const originTop = rect.top + (module.row - 1) * (cellHeight + rowGap)
  const farRight = originLeft + module.width * cellWidth + (module.width - 1) * columnGap
  const farBottom = originTop + module.height * cellHeight + (module.height - 1) * rowGap

  const onMove = (moveEvent: MouseEvent) => {
    let nextColumn = module.column
    let nextRow = module.row
    let nextWidth = module.width
    let nextHeight = module.height

    if (orientation === 'right' || orientation === 'corner') {
      nextWidth = Math.max(1, Math.round((moveEvent.clientX - originLeft + columnGap) / (cellWidth + columnGap)))
    }

    if (orientation === 'bottom' || orientation === 'corner') {
      nextHeight = Math.max(1, Math.round((moveEvent.clientY - originTop + rowGap) / (cellHeight + rowGap)))
    }

    if (orientation === 'left' || orientation === 'top_left') {
      const newLeftSpan = Math.round((farRight - moveEvent.clientX + columnGap) / (cellWidth + columnGap))
      nextWidth = Math.max(1, newLeftSpan)
      nextColumn = module.column + module.width - nextWidth
    }

    if (orientation === 'top' || orientation === 'top_left') {
      const newTopSpan = Math.round((farBottom - moveEvent.clientY + rowGap) / (cellHeight + rowGap))
      nextHeight = Math.max(1, newTopSpan)
      nextRow = module.row + module.height - nextHeight
    }

    resizeModule(module.id, nextColumn, nextRow, nextWidth, nextHeight)
  }

  const onUp = () => {
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
  }

  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}

function startMove(
  event: React.MouseEvent<HTMLElement>,
  module: { id: string; column: number; row: number; width: number; height: number },
  frame: HTMLElement | null,
  moveModule: (moduleId: string, column: number, row: number) => void
) {
  const target = event.target as HTMLElement
  if (target.closest('button')) return
  event.preventDefault()
  event.stopPropagation()
  if (!frame) return

  const gridShell = frame.parentElement
  if (!gridShell || gridShell.getAttribute('data-arcos-grid-shell') !== 'true') return

  const gridStyles = window.getComputedStyle(gridShell)
  const columnGap = parseFloat(gridStyles.columnGap || gridStyles.gap || '0')
  const rowGap = parseFloat(gridStyles.rowGap || gridStyles.gap || '0')
  const columns = gridStyles.gridTemplateColumns.split(' ').length
  const rows = gridStyles.gridTemplateRows.split(' ').length
  const rect = gridShell.getBoundingClientRect()
  const cellWidth = (rect.width - columnGap * Math.max(columns - 1, 0)) / columns
  const cellHeight = (rect.height - rowGap * Math.max(rows - 1, 0)) / rows
  const startX = event.clientX
  const startY = event.clientY

  const onMove = (moveEvent: MouseEvent) => {
    const deltaColumns = Math.round((moveEvent.clientX - startX) / Math.max(1, cellWidth + columnGap))
    const deltaRows = Math.round((moveEvent.clientY - startY) / Math.max(1, cellHeight + rowGap))
    const nextColumn = Math.max(1, Math.min(columns - module.width + 1, module.column + deltaColumns))
    const nextRow = Math.max(1, Math.min(rows - module.height + 1, module.row + deltaRows))
    moveModule(module.id, nextColumn, nextRow)
  }

  const onUp = () => {
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
  }

  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}
