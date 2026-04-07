import { create } from 'zustand'
import { useConversationStore } from './conversationStore'
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
  createTerminalInFirstAvailableSlot: () => { success: boolean; moduleId?: string; conversationId?: string }
  renameModule: (moduleId: string, title: string) => void
  setModuleConversation: (moduleId: string, conversationId: string | null) => void
  showPanel: (panelId: WorkspacePanelId) => void
  hidePanel: (panelId: WorkspacePanelId) => void
  removeModule: (moduleId: string) => void
  moveModule: (moduleId: string, column: number, row: number) => void
  resizeModule: (moduleId: string, column: number, row: number, width: number, height: number) => void
  detachPanel: (moduleId: string) => void
  redockPanel: (moduleId: string) => void
  handleDetachedWindowClosed: (moduleId: string) => void
  redockAllPanels: () => void
  setGridSize: (rows: number, columns: number) => void
  saveCurrentLayout: (label: string) => string | null
  exportCurrentLayout: (label?: string) => Promise<boolean>
  importLayout: () => Promise<boolean>
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
    if (module.panelId !== 'chat' && modulesByPanel.has(module.panelId)) {
      diagnostics.push(`${scopeLabel} removed a duplicate ${module.panelId} module placement.`)
      continue
    }
    if (module.panelId !== 'chat') {
      modulesByPanel.add(module.panelId)
    }
    const cells = module.detached ? [] : moduleCells(module)
    if (!module.detached && cells.some((cell) => occupied.has(cell))) {
      diagnostics.push(`${scopeLabel} removed an overlapping ${module.panelId} module placement.`)
      continue
    }
    cells.forEach((cell) => occupied.add(cell))
    acceptedModules.push(module)
  }

  return {
    layout: {
      rows,
      columns,
      modules: acceptedModules,
    },
    diagnostics: uniqueStrings(diagnostics),
  }
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

function nextTerminalTitle(layout: WorkspaceLayout): string {
  const takenNumbers = layout.modules
    .filter((module) => module.panelId === 'chat')
    .map((module) => {
      const match = module.title?.match(/^Terminal\s+(\d+)$/i) ?? module.title?.match(/^Terminal:\s*(\d+)$/i)
      return match ? Number.parseInt(match[1], 10) : null
    })
    .filter((value): value is number => Number.isFinite(value))

  let next = 1
  while (takenNumbers.includes(next)) next += 1
  return `Terminal ${next}`
}

function canPlaceModule(layout: WorkspaceLayout, candidate: WorkspaceGridModule, ignoreModuleId?: string): boolean {
  if (candidate.column < 1 || candidate.row < 1 || candidate.width < 1 || candidate.height < 1) return false
  if (candidate.column + candidate.width - 1 > layout.columns) return false
  if (candidate.row + candidate.height - 1 > layout.rows) return false

  const candidateCells = new Set(moduleCells(candidate))
  return !layout.modules.some((module) => {
    if (module.detached) return false
    if (module.id === ignoreModuleId) return false
    return moduleCells(module).some((cell) => candidateCells.has(cell))
  })
}

function collidingModules(
  layout: WorkspaceLayout,
  candidate: WorkspaceGridModule,
  ignoreModuleId?: string
): WorkspaceGridModule[] {
  const candidateCells = new Set(moduleCells(candidate))
  return layout.modules.filter((module) => {
    if (module.detached) return false
    if (module.id === ignoreModuleId) return false
    return moduleCells(module).some((cell) => candidateCells.has(cell))
  })
}

function moduleContainsCell(module: WorkspaceGridModule, column: number, row: number): boolean {
  return (
    column >= module.column &&
    column < module.column + module.width &&
    row >= module.row &&
    row < module.row + module.height
  )
}

function canPlaceModuleAgainstModules(
  modules: WorkspaceGridModule[],
  layout: WorkspaceLayout,
  candidate: WorkspaceGridModule,
  ignoreModuleIds: string[] = []
): boolean {
  if (candidate.column < 1 || candidate.row < 1 || candidate.width < 1 || candidate.height < 1) return false
  if (candidate.column + candidate.width - 1 > layout.columns) return false
  if (candidate.row + candidate.height - 1 > layout.rows) return false

  const ignored = new Set(ignoreModuleIds)
  const candidateCells = new Set(moduleCells(candidate))
  return !modules.some((module) => {
    if (module.detached) return false
    if (ignored.has(module.id)) return false
    return moduleCells(module).some((cell) => candidateCells.has(cell))
  })
}

function modulesDoNotOverlap(modules: WorkspaceGridModule[]): boolean {
  const occupied = new Set<string>()
  for (const module of modules) {
    for (const cell of moduleCells(module)) {
      if (occupied.has(cell)) return false
      occupied.add(cell)
    }
  }
  return true
}

function firstFitForSize(layout: WorkspaceLayout, width: number, height: number): WorkspacePlacementTarget | null {
  for (let row = 1; row <= layout.rows - height + 1; row += 1) {
    for (let column = 1; column <= layout.columns - width + 1; column += 1) {
      const candidate: WorkspaceGridModule = {
        id: 'candidate',
        panelId: 'chat',
        column,
        row,
        width,
        height,
      }
      if (canPlaceModule(layout, candidate)) {
        return { column, row }
      }
    }
  }
  return null
}

function addModule(layout: WorkspaceLayout, panelId: WorkspacePanelId, column: number, row: number): WorkspaceLayout {
  const base = cloneLayout(layout)
  const existing = base.modules.find((module) => module.panelId === panelId)
  if (existing && panelId !== 'chat') return base
  const panelDef = WORKSPACE_PANELS.find((panel) => panel.id === panelId)
  const width = panelDef?.defaultSize?.width ?? 1
  const height = panelDef?.defaultSize?.height ?? 1
  const nextModule: WorkspaceGridModule = {
    id: crypto.randomUUID(),
    panelId,
    title: panelId === 'chat' ? nextTerminalTitle(base) : undefined,
    conversationId: panelId === 'chat' ? useConversationStore.getState().createConversation() : undefined,
    detached: false,
    column,
    row,
    width,
    height,
  }
  if (panelId === 'chat' && nextModule.conversationId) {
    useConversationStore.getState().setActiveConversation(nextModule.conversationId)
  }
  if (!canPlaceModule(base, nextModule)) return base
  base.modules.push({
    ...nextModule,
  })
  return base
}

function getDetachedModules(layout: WorkspaceLayout): WorkspaceGridModule[] {
  return layout.modules.filter((module) => module.detached)
}

function buildDetachedModulePayloads(layout: WorkspaceLayout): Array<{ moduleId: string; panelId: WorkspacePanelId; title?: string }> {
  return getDetachedModules(layout).map((module) => ({
    moduleId: module.id,
    panelId: module.panelId,
    title: module.title,
  }))
}

function removePanel(layout: WorkspaceLayout, panelId: WorkspacePanelId): WorkspaceLayout {
  const next = cloneLayout(layout)
  next.modules = next.modules.filter((module) => module.panelId !== panelId)
  return next
}

function collectInvalidPanels(layout: Partial<WorkspaceLayout>): string[] {
  const validPanels = new Set(WORKSPACE_PANELS.map((panel) => panel.id))
  const invalid = new Set<string>()

  for (const module of layout.modules ?? []) {
    if (!validPanels.has(module.panelId)) invalid.add(module.panelId)
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
      void window.electron.workspaceSyncDetachedPanels?.(buildDetachedModulePayloads(currentResult.layout))
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
    void window.electron.workspaceSyncDetachedPanels?.(buildDetachedModulePayloads(layout))
  },

  createTerminalInFirstAvailableSlot: () => {
    const layout = get().layout
    const panelDef = WORKSPACE_PANELS.find((panel) => panel.id === 'chat')
    const width = panelDef?.defaultSize?.width ?? 1
    const height = panelDef?.defaultSize?.height ?? 2
    const target = firstFitForSize(layout, width, height)
    if (!target) {
      return { success: false }
    }
    const nextLayout = addModule(layout, 'chat', target.column, target.row)
    persist(get().activeLayoutId, nextLayout, get().savedLayouts)
    set({ layout: nextLayout, pendingPlacement: null })
    void window.electron.workspaceSyncDetachedPanels?.(buildDetachedModulePayloads(nextLayout))
    const created = nextLayout.modules.find((module) => !layout.modules.some((existing) => existing.id === module.id))
    return { success: true, moduleId: created?.id, conversationId: created?.conversationId ?? undefined }
  },

  renameModule: (moduleId, title) => {
    const trimmed = title.trim()
    const layout = cloneLayout(get().layout)
    const module = layout.modules.find((entry) => entry.id === moduleId)
    if (!module) return
    module.title = trimmed.length > 0 ? trimmed : (module.panelId === 'chat' ? nextTerminalTitle(layout) : undefined)
    persist(get().activeLayoutId, layout, get().savedLayouts)
    set({ layout })
  },

  setModuleConversation: (moduleId, conversationId) => {
    const layout = cloneLayout(get().layout)
    const module = layout.modules.find((entry) => entry.id === moduleId)
    if (!module) return
    module.conversationId = conversationId
    persist(get().activeLayoutId, layout, get().savedLayouts)
    set({ layout })
  },

  showPanel: (panelId) => {
    const panelDef = WORKSPACE_PANELS.find((panel) => panel.id === panelId)
    const width = panelDef?.defaultSize?.width ?? 1
    const height = panelDef?.defaultSize?.height ?? 1
    const target = firstFitForSize(get().layout, width, height)
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
    void window.electron.workspaceSyncDetachedPanels?.(buildDetachedModulePayloads(layout))
  },

  moveModule: (moduleId, column, row) => {
    const layout = cloneLayout(get().layout)
    const module = layout.modules.find((entry) => entry.id === moduleId)
    if (!module) return

    const originalColumn = module.column
    const originalRow = module.row
    const nextModule: WorkspaceGridModule = {
      ...module,
      column: Math.max(1, Math.round(column)),
      row: Math.max(1, Math.round(row)),
    }

    if (!canPlaceModule(layout, nextModule, moduleId)) {
      const collisions = collidingModules(layout, nextModule, moduleId)
      const displacedModule =
        collisions.find((entry) => moduleContainsCell(entry, nextModule.column, nextModule.row)) ??
        (collisions.length === 1 ? collisions[0] : null)

      if (!displacedModule) {
        return
      }
      const swappedIncomingModule: WorkspaceGridModule = {
        ...module,
        column: displacedModule.column,
        row: displacedModule.row,
      }
      const swappedModule: WorkspaceGridModule = {
        ...displacedModule,
        column: originalColumn,
        row: originalRow,
      }

      if (!canPlaceModuleAgainstModules(layout.modules, layout, swappedIncomingModule, [moduleId, displacedModule.id])) {
        return
      }
      if (!canPlaceModuleAgainstModules(layout.modules, layout, swappedModule, [moduleId, displacedModule.id])) {
        return
      }
      if (!modulesDoNotOverlap([swappedIncomingModule, swappedModule])) {
        return
      }

      layout.modules = layout.modules.map((entry) => {
        if (entry.id === moduleId) return swappedIncomingModule
        if (entry.id === displacedModule.id) return swappedModule
        return entry
      })
      persist(get().activeLayoutId, layout, get().savedLayouts)
      set({ layout })
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

  detachPanel: (moduleId) => {
    const layout = cloneLayout(get().layout)
    const module = layout.modules.find((entry) => entry.id === moduleId)
    if (!module) return
    module.detached = true
    persist(get().activeLayoutId, layout, get().savedLayouts)
    set({ layout })
    void window.electron.workspaceDetachPanel?.({
      moduleId: module.id,
      panelId: module.panelId,
      title: module.title,
    })
  },

  redockPanel: (moduleId) => {
    void window.electron.workspaceRedockPanel?.(moduleId)
    const layout = cloneLayout(get().layout)
    const module = layout.modules.find((entry) => entry.id === moduleId)
    if (!module) return
    const candidate = { ...module, detached: false }
    if (canPlaceModule(layout, candidate, module.id)) {
      module.detached = false
    } else {
      const target = firstFitForSize(layout, module.width, module.height)
      if (!target) {
        set((state) => ({
          diagnostics: uniqueStrings([
            ...state.diagnostics,
            `Re-dock stopped because no ${module.width}x${module.height} space is available for ${module.title ?? module.panelId}.`,
          ]),
        }))
        return
      }
      module.column = target.column
      module.row = target.row
      module.detached = false
    }
    persist(get().activeLayoutId, layout, get().savedLayouts)
    set({ layout })
    void window.electron.workspaceSyncDetachedPanels?.(buildDetachedModulePayloads(layout))
  },

  handleDetachedWindowClosed: (moduleId) => {
    const layout = cloneLayout(get().layout)
    const module = layout.modules.find((entry) => entry.id === moduleId && entry.detached)
    if (!module) return
    const candidate = { ...module, detached: false }
    if (canPlaceModule(layout, candidate, module.id)) {
      module.detached = false
    } else {
      const target = firstFitForSize(layout, module.width, module.height)
      if (!target) {
        set((state) => ({
          diagnostics: uniqueStrings([
            ...state.diagnostics,
            `Window closed, but no ${module.width}x${module.height} space is available to re-dock ${module.title ?? module.panelId}.`,
          ]),
        }))
        return
      }
      module.column = target.column
      module.row = target.row
      module.detached = false
    }
    persist(get().activeLayoutId, layout, get().savedLayouts)
    set({
      layout,
      diagnostics: [
        ...get().diagnostics,
        `${module.title ?? WORKSPACE_PANELS.find((panel) => panel.id === module.panelId)?.title ?? module.panelId} window closed and returned to the grid.`,
      ],
    })
    void window.electron.workspaceSyncDetachedPanels?.(buildDetachedModulePayloads(layout))
  },

  redockAllPanels: () => {
    const layout = cloneLayout(get().layout)
    const stranded: WorkspaceGridModule[] = []
    for (const module of getDetachedModules(layout)) {
      const target = firstFitForSize(layout, module.width, module.height)
      if (!target) {
        stranded.push(module)
        continue
      }
      const targetModule = layout.modules.find((entry) => entry.id === module.id)
      if (!targetModule) continue
      targetModule.column = target.column
      targetModule.row = target.row
      targetModule.detached = false
      void window.electron.workspaceRedockPanel?.(module.id)
    }
    persist(get().activeLayoutId, layout, get().savedLayouts)
    set((state) => ({
      layout,
      diagnostics: stranded.length === 0
        ? state.diagnostics
        : uniqueStrings([
            ...state.diagnostics,
            `Re-dock stopped because the grid is full. ${stranded.length} detached module${stranded.length === 1 ? '' : 's'} remain outside the grid.`,
          ]),
    }))
    void window.electron.workspaceSyncDetachedPanels?.(buildDetachedModulePayloads(layout))
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

  exportCurrentLayout: async (label) => {
    const fallbackLabel = get().activeLayoutId
      ? get().savedLayouts.find((savedLayout) => savedLayout.id === get().activeLayoutId)?.label
      : null
    const exportLabel = (label?.trim() || fallbackLabel || 'ARCOS Layout').trim()
    const result = await window.electron.layoutExport({
      label: exportLabel,
      layout: get().layout,
      exportedAt: new Date().toISOString(),
      product: 'ARCOS',
      version: 1,
    })
    if (!result.success) {
      set((state) => ({
        diagnostics: uniqueStrings([
          ...state.diagnostics,
          result.error ?? 'Layout export failed.',
        ]),
      }))
      return false
    }
    return true
  },

  importLayout: async () => {
    const result = await window.electron.layoutImport()
    if (!result.success || !result.payload) {
      const error = result.error
      if (error) {
        set((state) => ({
          diagnostics: uniqueStrings([...state.diagnostics, error]),
        }))
      }
      return false
    }

    const payload = result.payload
    const imported = payload.layout as Partial<WorkspaceLayout>
    const sanitized = sanitizeLayout({
      rows: imported.rows ?? DEFAULT_WORKSPACE_LAYOUT.rows,
      columns: imported.columns ?? DEFAULT_WORKSPACE_LAYOUT.columns,
      modules: imported.modules ?? [],
    }, `Imported layout "${payload.label}"`)

    const savedLayout: WorkspaceSavedLayout = {
      id: `layout-${crypto.randomUUID()}`,
      label: payload.label?.trim() || 'Imported Layout',
      layout: cloneLayout(sanitized.layout),
      createdAt: Date.now(),
    }
    const savedLayouts = [...get().savedLayouts, savedLayout]
    persist(savedLayout.id, sanitized.layout, savedLayouts)
    set((state) => ({
      activeLayoutId: savedLayout.id,
      layout: sanitized.layout,
      savedLayouts,
      diagnostics: uniqueStrings([...state.diagnostics, ...sanitized.diagnostics]),
    }))
    void window.electron.workspaceSyncDetachedPanels?.(buildDetachedModulePayloads(sanitized.layout))
    return true
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
    void window.electron.workspaceSyncDetachedPanels?.(buildDetachedModulePayloads(layout))
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
