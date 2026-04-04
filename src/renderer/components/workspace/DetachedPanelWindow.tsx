import { WORKSPACE_PANELS } from '../../workspace/presets'
import { WorkspacePanelId } from '../../workspace/types'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import WorkspacePanelContent from './WorkspacePanelContent'
import PanelErrorBoundary from './PanelErrorBoundary'
import useAppBootstrap from '../../hooks/useAppBootstrap'

interface DetachedPanelWindowProps {
  panelId: WorkspacePanelId
}

export default function DetachedPanelWindow({ panelId }: DetachedPanelWindowProps) {
  const panel = WORKSPACE_PANELS.find((entry) => entry.id === panelId)
  const redockPanel = useWorkspaceStore((s) => s.redockPanel)
  const recordPanelFailure = useWorkspaceStore((s) => s.recordPanelFailure)
  const resetWorkspace = useWorkspaceStore((s) => s.resetWorkspace)
  useAppBootstrap()

  if (!panel) {
    return (
      <div className="flex h-screen items-center justify-center bg-background px-6 text-center text-text">
        <div className="arcos-panel max-w-lg rounded-2xl border p-6">
          <p className="arcos-kicker mb-2">Detached Panel</p>
          <p className="text-sm font-semibold">This panel is no longer registered in ARCOS.</p>
          <p className="mt-2 text-xs leading-5 text-text-muted">
            Close this window and use the recovery controls in the main workspace if needed.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-text">
      <header className="titlebar-drag arcos-toolbar flex h-14 min-h-14 items-center justify-between border-b px-4">
        <div className="min-w-0">
          <p className="arcos-kicker">Detached Panel</p>
          <p className="truncate text-sm font-semibold text-text">{panel.title}</p>
        </div>
        <div className="titlebar-no-drag ml-3 flex items-center gap-2">
          <button
            onClick={() => redockPanel(panelId)}
            className="arcos-action-primary rounded-md px-2.5 py-1.5 text-[11px]"
          >
            Re-dock
          </button>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-auto">
        <PanelErrorBoundary
          panelId={panelId}
          onError={recordPanelFailure}
          onRecoverWorkspace={resetWorkspace}
        >
          <WorkspacePanelContent
            panelId={panelId}
            onOpenHistory={() => redockPanel('history')}
            onOpenMemory={() => redockPanel('memory')}
            onOpenLog={() => redockPanel('transparency')}
            onOpenSettings={() => redockPanel('utilities')}
          />
        </PanelErrorBoundary>
      </div>
    </div>
  )
}
