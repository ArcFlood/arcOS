import { ReactNode, useMemo, useState } from 'react'
import { WORKSPACE_PANELS } from '../../workspace/presets'
import { useWorkspaceStore } from '../../stores/workspaceStore'

interface WorkspaceTopBarProps {
  onOpenSettings: () => void
}

export default function WorkspaceTopBar({ onOpenSettings }: WorkspaceTopBarProps) {
  const [openMenu, setOpenMenu] = useState<'panels' | 'layouts' | 'workspace' | null>(null)
  const layout = useWorkspaceStore((s) => s.layout)
  const savedLayouts = useWorkspaceStore((s) => s.savedLayouts)
  const activeLayoutId = useWorkspaceStore((s) => s.activeLayoutId)
  const showPanel = useWorkspaceStore((s) => s.showPanel)
  const redockPanel = useWorkspaceStore((s) => s.redockPanel)
  const saveCurrentLayout = useWorkspaceStore((s) => s.saveCurrentLayout)
  const activateSavedLayout = useWorkspaceStore((s) => s.activateSavedLayout)
  const renameSavedLayout = useWorkspaceStore((s) => s.renameSavedLayout)
  const duplicateSavedLayout = useWorkspaceStore((s) => s.duplicateSavedLayout)
  const deleteSavedLayout = useWorkspaceStore((s) => s.deleteSavedLayout)
  const setGridSize = useWorkspaceStore((s) => s.setGridSize)
  const resetWorkspace = useWorkspaceStore((s) => s.resetWorkspace)
  const redockAllPanels = useWorkspaceStore((s) => s.redockAllPanels)

  const mountedPanels = useMemo(() => new Set(layout.modules.map((module) => module.panelId)), [layout.modules])
  const detachedPanels = useMemo(() => new Set(layout.detachedPanels), [layout.detachedPanels])
  const availablePanels = useMemo(
    () => WORKSPACE_PANELS.filter((panel) => !mountedPanels.has(panel.id) && !detachedPanels.has(panel.id)),
    [detachedPanels, mountedPanels]
  )
  const detachedPanelDefs = useMemo(
    () => layout.detachedPanels.map((panelId) => WORKSPACE_PANELS.find((panel) => panel.id === panelId)).filter(Boolean),
    [layout.detachedPanels]
  )

  const toggleMenu = (menu: 'panels' | 'layouts' | 'workspace') => {
    setOpenMenu((current) => current === menu ? null : menu)
  }

  return (
    <header className="titlebar-drag arcos-toolbar flex h-14 min-h-14 items-center justify-between border-b px-4">
      <div className="min-w-0">
        <p className="arcos-kicker">Personal AI Infrastructure</p>
        <p className="mt-0.5 text-sm font-semibold text-text">ARCOS</p>
      </div>

      <div className="titlebar-no-drag flex items-center gap-2">
        <MenuButton label="Panels" open={openMenu === 'panels'} onClick={() => toggleMenu('panels')}>
          {availablePanels.length === 0 ? (
            <MenuHint label="All registered modules are already placed" />
          ) : (
            availablePanels.map((panel) => (
              <MenuItem
                key={panel.id}
                label={`${panel.icon} ${panel.title}`}
                description={panel.description}
                onClick={() => {
                  showPanel(panel.id)
                  setOpenMenu(null)
                }}
              />
            ))
          )}
          {detachedPanelDefs.length > 0 && (
            <>
              <MenuDivider />
              {detachedPanelDefs.map((panel) => (
                <MenuItem
                  key={`detached-${panel!.id}`}
                  label={`Re-dock ${panel!.title}`}
                  description="Return detached panel to the grid"
                  onClick={() => {
                    redockPanel(panel!.id)
                    setOpenMenu(null)
                  }}
                />
              ))}
            </>
          )}
        </MenuButton>

        <MenuButton label="Layouts" open={openMenu === 'layouts'} onClick={() => toggleMenu('layouts')}>
          <MenuItem
            label="Save Current Layout"
            description="Store the current pocket-grid operating surface"
            onClick={() => {
              const label = window.prompt('Layout name:')
              if (label) saveCurrentLayout(label)
              setOpenMenu(null)
            }}
          />
          <MenuItem
            label="Reset To Empty"
            description="Return to a blank PAI workspace palette"
            onClick={() => {
              resetWorkspace()
              setOpenMenu(null)
            }}
          />
          <MenuDivider />
          {savedLayouts.length === 0 ? (
            <MenuHint label="No saved layouts yet" />
          ) : (
            savedLayouts.map((savedLayout) => (
              <div key={savedLayout.id} className="rounded-lg border border-border bg-[#12161b] p-2">
                <button
                  onClick={() => {
                    activateSavedLayout(savedLayout.id)
                    setOpenMenu(null)
                  }}
                  className={`w-full rounded-md px-2 py-2 text-left text-xs transition-colors ${
                    activeLayoutId === savedLayout.id ? 'bg-[#1b2027] text-text' : 'hover:bg-[#171c22] text-text-muted'
                  }`}
                >
                  {savedLayout.label}
                </button>
                <div className="mt-2 flex gap-2">
                  <MiniAction
                    label="Rename"
                    onClick={() => {
                      const label = window.prompt('Rename layout:', savedLayout.label)
                      if (label) renameSavedLayout(savedLayout.id, label)
                    }}
                  />
                  <MiniAction label="Copy" onClick={() => duplicateSavedLayout(savedLayout.id)} />
                  <MiniAction label="Delete" onClick={() => deleteSavedLayout(savedLayout.id)} />
                </div>
              </div>
            ))
          )}
        </MenuButton>

        <MenuButton label="Workspace" open={openMenu === 'workspace'} onClick={() => toggleMenu('workspace')}>
          <MenuItem
            label={`Rows: ${layout.rows}`}
            description="Increase or decrease pocket rows"
            onClick={() => {}}
            disabled
          />
          <GridStepper
            onDecrease={() => setGridSize(layout.rows - 1, layout.columns)}
            onIncrease={() => setGridSize(layout.rows + 1, layout.columns)}
          />
          <MenuItem
            label={`Columns: ${layout.columns}`}
            description="Increase or decrease pocket columns"
            onClick={() => {}}
            disabled
          />
          <GridStepper
            onDecrease={() => setGridSize(layout.rows, layout.columns - 1)}
            onIncrease={() => setGridSize(layout.rows, layout.columns + 1)}
          />
          <MenuDivider />
          <MenuItem
            label="Re-dock All Windows"
            description="Return detached panels to the grid"
            onClick={() => {
              redockAllPanels()
              setOpenMenu(null)
            }}
          />
          <MenuItem
            label="Settings"
            description="Open ARCOS appearance and runtime settings"
            onClick={() => {
              onOpenSettings()
              setOpenMenu(null)
            }}
          />
        </MenuButton>
      </div>
    </header>
  )
}

function MenuButton({
  label,
  open,
  onClick,
  children,
}: {
  label: string
  open: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <div className="relative">
      <button onClick={onClick} className="arcos-action rounded-md px-3 py-1.5 text-[11px] transition-colors">
        {label}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-[280px] rounded-xl border border-border bg-[#0f1318] p-2 shadow-xl">
          {children}
        </div>
      )}
    </div>
  )
}

function MenuItem({
  label,
  description,
  onClick,
  disabled,
}: {
  label: string
  description: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="w-full rounded-lg px-3 py-2 text-left transition-colors hover:bg-[#171c22] disabled:cursor-default disabled:hover:bg-transparent"
    >
      <p className={`text-xs font-medium ${disabled ? 'text-text-muted' : 'text-text'}`}>{label}</p>
      <p className="mt-1 text-[11px] leading-5 text-text-muted">{description}</p>
    </button>
  )
}

function MenuHint({ label }: { label: string }) {
  return <div className="px-3 py-2 text-xs text-text-muted">{label}</div>
}

function MenuDivider() {
  return <div className="my-2 border-t border-border" />
}

function MiniAction({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="arcos-action rounded px-2 py-1 text-[10px] uppercase tracking-wider">
      {label}
    </button>
  )
}

function GridStepper({
  onDecrease,
  onIncrease,
}: {
  onDecrease: () => void
  onIncrease: () => void
}) {
  return (
    <div className="mb-2 flex items-center gap-2 px-3">
      <button onClick={onDecrease} className="arcos-action rounded px-2 py-1 text-[10px] uppercase tracking-wider">
        -
      </button>
      <button onClick={onIncrease} className="arcos-action rounded px-2 py-1 text-[10px] uppercase tracking-wider">
        +
      </button>
    </div>
  )
}
