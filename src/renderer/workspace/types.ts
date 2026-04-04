export type WorkspacePanelId =
  | 'navigator'
  | 'chat'
  | 'services'
  | 'routing'
  | 'runtime'
  | 'tools'
  | 'prompt_inspector'
  | 'memory'
  | 'history'
  | 'models'
  | 'cost'
  | 'transparency'
  | 'execution'
  | 'utilities'

export interface WorkspaceGridModule {
  id: string
  panelId: WorkspacePanelId
  column: number
  row: number
  width: number
  height: number
}

export interface WorkspaceLayout {
  rows: number
  columns: number
  modules: WorkspaceGridModule[]
  detachedPanels: WorkspacePanelId[]
}

export interface WorkspaceSavedLayout {
  id: string
  label: string
  layout: WorkspaceLayout
  createdAt: number
}

export interface WorkspacePanelDefinition {
  id: WorkspacePanelId
  title: string
  description: string
  icon: string
  defaultSize?: {
    width: number
    height: number
  }
}

export interface WorkspacePlacementTarget {
  column: number
  row: number
}
