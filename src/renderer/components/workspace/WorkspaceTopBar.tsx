import { ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { WORKSPACE_PANELS } from '../../workspace/presets'
import { useWorkspaceStore } from '../../stores/workspaceStore'

interface WorkspaceTopBarProps {
  onOpenSettings: () => void
}

export default function WorkspaceTopBar({ onOpenSettings }: WorkspaceTopBarProps) {
  const [openMenu, setOpenMenu] = useState<'pages' | 'layouts' | 'workspace' | null>(null)
  const menuRootRef = useRef<HTMLDivElement | null>(null)
  const layout = useWorkspaceStore((s) => s.layout)
  const pages = useWorkspaceStore((s) => s.pages)
  const activePageId = useWorkspaceStore((s) => s.activePageId)
  const savedLayouts = useWorkspaceStore((s) => s.savedLayouts)
  const activeLayoutId = useWorkspaceStore((s) => s.activeLayoutId)
  const createPage = useWorkspaceStore((s) => s.createPage)
  const activatePage = useWorkspaceStore((s) => s.activatePage)
  const renamePage = useWorkspaceStore((s) => s.renamePage)
  const deletePage = useWorkspaceStore((s) => s.deletePage)
  const redockPanel = useWorkspaceStore((s) => s.redockPanel)
  const saveCurrentLayout = useWorkspaceStore((s) => s.saveCurrentLayout)
  const exportCurrentLayout = useWorkspaceStore((s) => s.exportCurrentLayout)
  const importLayout = useWorkspaceStore((s) => s.importLayout)
  const activateSavedLayout = useWorkspaceStore((s) => s.activateSavedLayout)
  const renameSavedLayout = useWorkspaceStore((s) => s.renameSavedLayout)
  const duplicateSavedLayout = useWorkspaceStore((s) => s.duplicateSavedLayout)
  const deleteSavedLayout = useWorkspaceStore((s) => s.deleteSavedLayout)
  const setGridSize = useWorkspaceStore((s) => s.setGridSize)
  const resetWorkspace = useWorkspaceStore((s) => s.resetWorkspace)
  const redockAllPanels = useWorkspaceStore((s) => s.redockAllPanels)

  const detachedModules = useMemo(() => layout.modules.filter((module) => module.detached), [layout.modules])
  const detachedPanelDefs = useMemo(() => detachedModules.map((module) => ({
    moduleId: module.id,
    panel: WORKSPACE_PANELS.find((entry) => entry.id === module.panelId),
    title: module.title,
  })).filter((entry) => entry.panel), [detachedModules])

  const activePage = pages.find((page) => page.id === activePageId)

  const toggleMenu = (menu: 'pages' | 'layouts' | 'workspace') => {
    setOpenMenu((current) => current === menu ? null : menu)
  }

  useEffect(() => {
    if (!openMenu) return
    const handlePointerDown = (event: MouseEvent) => {
      if (!menuRootRef.current?.contains(event.target as Node)) {
        setOpenMenu(null)
      }
    }
    window.addEventListener('mousedown', handlePointerDown)
    return () => window.removeEventListener('mousedown', handlePointerDown)
  }, [openMenu])

  return (
    <header className="titlebar-drag arcos-toolbar flex h-14 min-h-14 items-center justify-between border-b px-4">
      <div className="min-w-0">
        <p className="arcos-kicker">Personal AI Infrastructure</p>
        <p className="mt-0.5 text-sm font-semibold text-text">ARCOS</p>
      </div>

      <div ref={menuRootRef} className="titlebar-no-drag flex items-center gap-2">
        <MenuButton label={`Pages: ${activePage?.label ?? 'Page 1'}`} open={openMenu === 'pages'} onClick={() => toggleMenu('pages')}>
          <MenuItem
            label="New Page"
            description="Create another grid layer for separate ARCOS work."
            onClick={() => {
              createPage()
              setOpenMenu(null)
            }}
          />
          <MenuDivider />
          {pages.map((page) => (
            <div key={page.id} className="rounded-lg border border-border bg-[#12161b] p-2">
              <button
                onClick={() => {
                  activatePage(page.id)
                  setOpenMenu(null)
                }}
                className={`w-full rounded-md px-2 py-2 text-left text-xs transition-colors ${
                  activePageId === page.id ? 'bg-[#1b2027] text-text' : 'text-text-muted hover:bg-[#171c22]'
                }`}
              >
                {page.label}
              </button>
              <div className="mt-2 flex gap-2">
                <MiniAction
                  label="Rename"
                  onClick={() => {
                    const label = window.prompt('Rename page:', page.label)
                    if (label) renamePage(page.id, label)
                  }}
                />
                <MiniAction
                  label="Delete"
                  onClick={() => {
                    if (window.confirm(`Delete "${page.label}"?`)) deletePage(page.id)
                  }}
                />
              </div>
            </div>
          ))}
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
          <MenuItem
            label="Export Current Layout"
            description="Save the current grid layout as a portable ARCOS file"
            onClick={() => {
              void exportCurrentLayout()
              setOpenMenu(null)
            }}
          />
          <MenuItem
            label="Import Layout"
            description="Load a portable ARCOS layout file into saved layouts"
            onClick={() => {
              void importLayout()
              setOpenMenu(null)
            }}
          />
          {detachedPanelDefs.length > 0 && (
            <>
              <MenuDivider />
              {detachedPanelDefs.map((panel) => (
                <MenuItem
                  key={`detached-${panel.moduleId}`}
                  label={`Re-dock ${panel.title ?? panel.panel!.title}`}
                  description="Return detached panel to the grid"
                  onClick={() => {
                    redockPanel(panel.moduleId)
                    setOpenMenu(null)
                  }}
                />
              ))}
            </>
          )}
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
