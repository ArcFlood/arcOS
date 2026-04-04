import { create } from 'zustand'
import { DEFAULT_WORKSPACE_LAYOUT, WORKSPACE_PANELS } from '../workspace/presets'
import {
  WorkspaceGridModule,
  WorkspaceLayout,
  WorkspacePanelId,
  WorkspacePlacementTarget,
  WorkspaceSavedLayout,
} from '../workspace/types'

const STORAGE_KEY = 'arcos-workspace-v2'
const MIN_GRID_SIZE = 1
const MAX_GRID_SIZE = 8

interface PersistedWorkspaceState {
  activeLayoutId: string | null
  layout: WorkspaceLayout
  savedLayouts: WorkspaceSavedLayout[]
}

interface WorkspaceStore {
  activeLayoutId: string | null
  layout: WorkspaceLayout
  savedLayouts: WorkspaceSavedLayout[]
  pendingPlacement: WorkspacePlacementTarget | null
  diagnostics: string[]
  panelFailureCounts: Partial<Record<WorkspacePanelId, number>>
  hydrate: () => void
  beginPlacement: (column: number, row: number) => void
  cancelPlacement: () => void
  addPanelAtPending: (panelId: WorkspacePanelId) => void
  addPanelAtCell: (panelId: WorkspacePanelId, column: number, row: number) => void
  showPanel: (panelId: WorkspacePanelId) => void
  hidePanel: (panelId: WorkspacePanelId) => void
  removeModule: (moduleId: string) => void
  moveModule: (moduleId: string, column: number, row: number) => void
  resizeModule: (moduleId: string, column: number, row: number, width: number, height: number) => void
  detachPanel: (panelId: WorkspacePanelId) => void
  redockPanel: (panelId: WorkspacePanelId) => void
  handleDetachedWindowClosed: (panelId: WorkspacePanelId) => void
  redockAllPanels: () => void
  setGridSize: (rows: number, columns: number) => void
  saveCurrentLayout: (label: string) => string | null
  activateSavedLayout: (layoutId: string) => void
  renameSavedLayout: (layoutId: string, label: string) => void
  duplicateSavedLayout: (layoutId: string) => string | null
  deleteSavedLayout: (layoutId: string) => void
  resetWorkspace: () => void
  clearDiagnostics: () => void
  recordPanelFailure: (panelId: WorkspacePanelId) => void
}

function cloneLayout(layout: WorkspaceLayout): WorkspaceLayout {
  return JSON.parse(JSON.stringify(layout)) as WorkspaceLayout
}

function persist(activeLayoutId: string | null, layout: WorkspaceLayout, savedLayouts: WorkspaceSavedLayout[]): void {
  const payload: PersistedWorkspaceState = { activeLayoutId, layout, savedLayouts }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)]
}

interface SanitizedLayoutResult {
  layout: WorkspaceLayout
  diagnostics: string[]
}

function sanitizeLayout(layout: WorkspaceLayout, scopeLabel = 'Workspace'): SanitizedLayoutResult {
  const validPanels = new Set(WORKSPACE_PANELS.map((panel) => panel.id))
  const diagnostics: string[] = []
  const rows = clampGridSize(layout.rows ?? DEFAULT_WORKSPACE_LAYOUT.rows)
  const columns = clampGridSize(layout.columns ?? DEFAULT_WORKSPACE_LAYOUT.columns)
  if ((layout.rows ?? DEFAULT_WORKSPACE_LAYOUT.rows) !== rows) {
    diagnostics.push(`${scopeLabel} rows were out of bounds and were clamped to ${rows}.`)
  }
  if ((layout.columns ?? DEFAULT_WORKSPACE_LAYOUT.columns) !== columns) {
    diagnostics.push(`${scopeLabel} columns were out of bounds and were clamped to ${columns}.`)
  }

  const modulesByPanel = new Set<WorkspacePanelId>()
  const acceptedModules: WorkspaceGridModule[] = []
  const occupied = new Set<string>()

  for (const module of layout.modules ?? []) {
    if (!validPanels.has(module.panelId)) continue
    if (
      module.column < 1 ||
      module.row < 1 ||
      module.width < 1 ||
      module.height < 1 ||
      module.column + module.width - 1 > columns ||
      module.row + module.height - 1 > rows
    ) {
      diagnostics.push(`${scopeLabel} dropped out-of-bounds ${module.panelId} module placement.`)
      continue
    }
    if (modulesByPanel.has(module.panelId)) {
      diagnostics.push(`${scopeLabel} removed a duplicate ${module.panelId} module placement.`)
      continue
    }
    const cells = moduleCells(module)
    if (cells.some((cell) => occupied.has(cell))) {
      diagnostics.push(`${scopeLabel} removed an overlapping ${module.panelId} module placement.`)
      continue
    }
    modulesByPanel.add(module.panelId)
    cells.forEach((cell) => occupied.add(cell))
    acceptedModules.push(module)
  }

  const detachedPanels: WorkspacePanelId[] = []
  for (const panelId of layout.detachedPanels ?? []) {
    if (!validPanels.has(panelId)) continue
    if (modulesByPanel.has(panelId)) {
      diagnostics.push(`${scopeLabel} removed duplicate detached state for ${panelId} because the panel is already docked.`)
      continue
    }
    if (detachedPanels.includes(panelId)) {
      diagnostics.push(`${scopeLabel} removed duplicate detached state for ${panelId}.`)
      continue
    }
    detachedPanels.push(panelId)
  }

  return {
    layout: {
      rows,
      columns,
      modules: acceptedModules,
      detachedPanels,
    },
    diagnostics: uniqueStrings(diagnostics),
  }
}

function uniquePanelIds(panelIds: WorkspacePanelId[]): WorkspacePanelId[] {
  return [...new Set(panelIds)]
}

function clampGridSize(value: number): number {
  return Math.max(MIN_GRID_SIZE, Math.min(MAX_GRID_SIZE, Math.round(value)))
}

function moduleCells(module: WorkspaceGridModule): string[] {
  const cells: string[] = []
  for (let row = module.row; row < module.row + module.height; row += 1) {
    for (let column = module.column; column < module.column + module.width; column += 1) {
      cells.push(`${column}:${row}`)
    }
  }
  return cells
}

function isCellOccupied(layout: WorkspaceLayout, column: number, row: number): boolean {
  return layout.modules.some((module) => (
    column >= module.column &&
    column < module.column + module.width &&
    row >= module.row &&
    row < module.row + module.height
  ))
}

function firstEmptyCell(layout: WorkspaceLayout): WorkspacePlacementTarget | null {
  for (let row = 1; row <= layout.rows; row += 1) {
    for (let column = 1; column <= layout.columns; column += 1) {
      if (!isCellOccupied(layout, column, row)) {
        return { column, row }
      }
    }
  }
  return null
}

function findModuleByPanelId(layout: WorkspaceLayout, panelId: WorkspacePanelId): WorkspaceGridModule | undefined {
  return layout.modules.find((module) => module.panelId === panelId)
}

function canPlaceModule(layout: WorkspaceLayout, candidate: WorkspaceGridModule, ignoreModuleId?: string): boolean {
  if (candidate.column < 1 || candidate.row < 1 || candidate.width < 1 || candidate.height < 1) return false
  if (candidate.column + candidate.width - 1 > layout.columns) return false
  if (candidate.row + candidate.height - 1 > layout.rows) return false

  const candidateCells = new Set(moduleCells(candidate))
  return !layout.modules.some((module) => {
    if (module.id === ignoreModuleId) return false
    return moduleCells(module).some((cell) => candidateCells.has(cell))
  })
}

function addModule(layout: WorkspaceLayout, panelId: WorkspacePanelId, column: number, row: number): WorkspaceLayout {
  const existing = findModuleByPanelId(layout, panelId)
  const base = cloneLayout(layout)
  base.detachedPanels = base.detachedPanels.filter((id) => id !== panelId)
  if (existing) return base
  if (isCellOccupied(base, column, row)) return base
  base.modules.push({
    id: crypto.randomUUID(),
    panelId,
    column,
    row,
    width: 1,
    height: 1,
  })
  return base
}

function removePanel(layout: WorkspaceLayout, panelId: WorkspacePanelId): WorkspaceLayout {
  const next = cloneLayout(layout)
  next.modules = next.modules.filter((module) => module.panelId !== panelId)
  next.detachedPanels = next.detachedPanels.filter((id) => id !== panelId)
  return next
}

function collectInvalidPanels(layout: Partial<WorkspaceLayout>): string[] {
  const validPanels = new Set(WORKSPACE_PANELS.map((panel) => panel.id))
  const invalid = new Set<string>()

  for (const module of layout.modules ?? []) {
    if (!validPanels.has(module.panelId)) invalid.add(module.panelId)
  }
  for (const panelId of layout.detachedPanels ?? []) {
    if (!validPanels.has(panelId)) invalid.add(panelId)
  }

  return [...invalid]
}

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => ({
  activeLayoutId: null,
  layout: cloneLayout(DEFAULT_WORKSPACE_LAYOUT),
  savedLayouts: [],
  pendingPlacement: null,
  diagnostics: [],
  panelFailureCounts: {},

  hydrate: () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw) as PersistedWorkspaceState
      const currentResult = sanitizeLayout(parsed.layout, 'Workspace')
      const savedLayoutResults = (parsed.savedLayouts ?? []).map((savedLayout) => ({
        savedLayout,
        result: sanitizeLayout(savedLayout.layout, `Saved layout "${savedLayout.label}"`),
      }))
      const savedLayouts = savedLayoutResults.map(({ savedLayout, result }) => ({
        ...savedLayout,
        layout: result.layout,
      }))
      const diagnostics = [
        ...collectInvalidPanels(parsed.layout).map((panelId) => `Dropped unregistered panel "${panelId}" from persisted workspace state.`),
        ...(parsed.savedLayouts ?? []).flatMap((savedLayout) => collectInvalidPanels(savedLayout.layout)).map(
          (panelId) => `Dropped unregistered panel "${panelId}" from persisted saved layout state.`
        ),
        ...currentResult.diagnostics,
        ...savedLayoutResults.flatMap(({ result }) => result.diagnostics),
      ]

      set({
        activeLayoutId: savedLayouts.some((savedLayout) => savedLayout.id === parsed.activeLayoutId)
          ? parsed.activeLayoutId
          : null,
        layout: currentResult.layout,
        savedLayouts,
        diagnostics: uniqueStrings(diagnostics),
      })
      persist(
        savedLayouts.some((savedLayout) => savedLayout.id === parsed.activeLayoutId) ? parsed.activeLayoutId : null,
        currentResult.layout,
        savedLayouts
      )
      void window.electron.workspaceSyncDetachedPanels?.(currentResult.layout.detachedPanels)
    } catch {
      set({
        activeLayoutId: null,
        layout: cloneLayout(DEFAULT_WORKSPACE_LAYOUT),
        savedLayouts: [],
        diagnostics: ['Workspace state was unreadable and has been reset to an empty grid.'],
      })
    }
  },

  beginPlacement: (column, row) => {
    set({ pendingPlacement: { column, row } })
  },

  cancelPlacement: () => {
    set({ pendingPlacement: null })
  },

  addPanelAtPending: (panelId) => {
    const target = get().pendingPlacement
    if (!target) return
    get().addPanelAtCell(panelId, target.column, target.row)
    set({ pendingPlacement: null })
  },

  addPanelAtCell: (panelId, column, row) => {
    const layout = addModule(get().layout, panelId, column, row)
    persist(get().activeLayoutId, layout, get().savedLayouts)
    set({ layout, pendingPlacement: null })
    void window.electron.workspaceRedockPanel?.(panelId)
  },

  showPanel: (panelId) => {
    const target = firstEmptyCell(get().layout)
    if (!target) {
      set((state) => ({
        diagnostics: [...state.diagnostics, `No empty pocket available for ${WORKSPACE_PANELS.find((panel) => panel.id === panelId)?.title ?? panelId}.`],
      }))
      return
    }
    get().addPanelAtCell(panelId, target.column, target.row)
  },

  hidePanel: (panelId) => {
    const layout = removePanel(get().layout, panelId)
    persist(get().activeLayoutId, layout, get().savedLayouts)
    set({ layout })
  },

  removeModule: (moduleId) => {
    const layout = cloneLayout(get().layout)
    layout.modules = layout.modules.filter((module) => module.id !== moduleId)
    persist(get().activeLayoutId, layout, get().savedLayouts)
    set({ layout })
  },

  moveModule: (moduleId, column, row) => {
    const layout = cloneLayout(get().layout)
    const module = layout.modules.find((entry) => entry.id === moduleId)
    if (!module) return

    const nextModule: WorkspaceGridModule = {
      ...module,
      column: Math.max(1, Math.round(column)),
      row: Math.max(1, Math.round(row)),
    }

    if (!canPlaceModule(layout, nextModule, moduleId)) {
      return
    }

    layout.modules = layout.modules.map((entry) => entry.id === moduleId ? nextModule : entry)
    persist(get().activeLayoutId, layout, get().savedLayouts)
    set({ layout })
  },

  resizeModule: (moduleId, column, row, width, height) => {
    const layout = cloneLayout(get().layout)
    const module = layout.modules.find((entry) => entry.id === moduleId)
    if (!module) return

    const nextModule: WorkspaceGridModule = {
      ...module,
      column: Math.max(1, Math.round(column)),
      row: Math.max(1, Math.round(row)),
      width: Math.max(1, Math.round(width)),
      height: Math.max(1, Math.round(height)),
    }

    if (!canPlaceModule(layout, nextModule, moduleId)) {
      return
    }

    layout.modules = layout.modules.map((entry) => entry.id === moduleId ? nextModule : entry)
    persist(get().activeLayoutId, layout, get().savedLayouts)
    set({ layout })
  },

  detachPanel: (panelId) => {
    const layout = removePanel(get().layout, panelId)
    layout.detachedPanels = uniquePanelIds([...layout.detachedPanels, panelId])
    persist(get().activeLayoutId, layout, get().savedLayouts)
    set({ layout })
    void window.electron.workspaceDetachPanel?.(panelId)
  },

  redockPanel: (panelId) => {
    void window.electron.workspaceRedockPanel?.(panelId)
    get().showPanel(panelId)
  },

  handleDetachedWindowClosed: (panelId) => {
    const layout = cloneLayout(get().layout)
    if (!layout.detachedPanels.includes(panelId)) return
    layout.detachedPanels = layout.detachedPanels.filter((id) => id !== panelId)
    const target = firstEmptyCell(layout)
    const nextLayout = target ? addModule(layout, panelId, target.column, target.row) : layout
    persist(get().activeLayoutId, nextLayout, get().savedLayouts)
    set({
      layout: nextLayout,
      diagnostics: [
        ...get().diagnostics,
        `${WORKSPACE_PANELS.find((panel) => panel.id === panelId)?.title ?? panelId} window closed and returned to the grid.`,
      ],
    })
  },

  redockAllPanels: () => {
    let layout = cloneLayout(get().layout)
    const stranded: WorkspacePanelId[] = []
    for (const panelId of [...layout.detachedPanels]) {
      const target = firstEmptyCell(layout)
      if (!target) {
        stranded.push(panelId)
        continue
      }
      layout = addModule(layout, panelId, target.column, target.row)
      void window.electron.workspaceRedockPanel?.(panelId)
    }
    persist(get().activeLayoutId, layout, get().savedLayouts)
    set((state) => ({
      layout,
      diagnostics: stranded.length === 0
        ? state.diagnostics
        : uniqueStrings([
            ...state.diagnostics,
            `Re-dock stopped because the grid is full. ${stranded.length} detached panel${stranded.length === 1 ? '' : 's'} remain outside the grid.`,
          ]),
    }))
  },

  setGridSize: (rows, columns) => {
    const layout = cloneLayout(get().layout)
    const nextRows = clampGridSize(rows)
    const nextColumns = clampGridSize(columns)
    const invalidModules = layout.modules.filter((module) => (
      module.column + module.width - 1 > nextColumns ||
      module.row + module.height - 1 > nextRows
    ))

    if (invalidModules.length > 0) {
      set((state) => ({
        diagnostics: [
          ...state.diagnostics,
          `Grid resize blocked because ${invalidModules.length} module${invalidModules.length === 1 ? '' : 's'} would no longer fit.`,
        ],
      }))
      return
    }

    layout.rows = nextRows
    layout.columns = nextColumns
    persist(get().activeLayoutId, layout, get().savedLayouts)
    set({ layout })
  },

  saveCurrentLayout: (label) => {
    const trimmed = label.trim()
    if (!trimmed) return null
    const savedLayout: WorkspaceSavedLayout = {
      id: `layout-${crypto.randomUUID()}`,
      label: trimmed,
      layout: cloneLayout(get().layout),
      createdAt: Date.now(),
    }
    const savedLayouts = [...get().savedLayouts, savedLayout]
    persist(savedLayout.id, get().layout, savedLayouts)
    set({ savedLayouts, activeLayoutId: savedLayout.id })
    return savedLayout.id
  },

  activateSavedLayout: (layoutId) => {
    const savedLayout = get().savedLayouts.find((entry) => entry.id === layoutId)
    if (!savedLayout) return
    const result = sanitizeLayout(savedLayout.layout, `Saved layout "${savedLayout.label}"`)
    const layout = cloneLayout(result.layout)
    persist(savedLayout.id, layout, get().savedLayouts)
    set((state) => ({
      activeLayoutId: savedLayout.id,
      layout,
      diagnostics: uniqueStrings([...state.diagnostics, ...result.diagnostics]),
    }))
    void window.electron.workspaceSyncDetachedPanels?.(layout.detachedPanels)
  },

  renameSavedLayout: (layoutId, label) => {
    const trimmed = label.trim()
    if (!trimmed) return
    const savedLayouts = get().savedLayouts.map((savedLayout) => (
      savedLayout.id === layoutId ? { ...savedLayout, label: trimmed } : savedLayout
    ))
    persist(get().activeLayoutId, get().layout, savedLayouts)
    set({ savedLayouts })
  },

  duplicateSavedLayout: (layoutId) => {
    const savedLayout = get().savedLayouts.find((entry) => entry.id === layoutId)
    if (!savedLayout) return null
    const duplicate: WorkspaceSavedLayout = {
      ...savedLayout,
      id: `layout-${crypto.randomUUID()}`,
      label: `${savedLayout.label} Copy`,
      layout: cloneLayout(savedLayout.layout),
      createdAt: Date.now(),
    }
    const savedLayouts = [...get().savedLayouts, duplicate]
    persist(get().activeLayoutId, get().layout, savedLayouts)
    set({ savedLayouts })
    return duplicate.id
  },

  deleteSavedLayout: (layoutId) => {
    const savedLayouts = get().savedLayouts.filter((savedLayout) => savedLayout.id !== layoutId)
    const activeLayoutId = get().activeLayoutId === layoutId ? null : get().activeLayoutId
    persist(activeLayoutId, get().layout, savedLayouts)
    set({ savedLayouts, activeLayoutId })
  },

  resetWorkspace: () => {
    const layout = cloneLayout(DEFAULT_WORKSPACE_LAYOUT)
    persist(null, layout, get().savedLayouts)
    set({
      activeLayoutId: null,
      layout,
      pendingPlacement: null,
      diagnostics: ['Workspace reset to an empty ARCOS grid.'],
      panelFailureCounts: {},
    })
    void window.electron.workspaceSyncDetachedPanels?.([])
  },

  clearDiagnostics: () => set({ diagnostics: [] }),

  recordPanelFailure: (panelId) => {
    set((state) => ({
      panelFailureCounts: {
        ...state.panelFailureCounts,
        [panelId]: (state.panelFailureCounts[panelId] ?? 0) + 1,
      },
      diagnostics: [
        ...state.diagnostics,
        `${WORKSPACE_PANELS.find((panel) => panel.id === panelId)?.title ?? panelId} failed to initialize and was isolated.`,
      ],
    }))
  },
}))
