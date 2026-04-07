export type WorkspacePanelId =
  | 'chat'
  | 'services'
  | 'routing'
  | 'runtime'
  | 'tools'
  | 'prompt_inspector'
  | 'memory'
  | 'history'
  | 'cost'
  | 'transparency'
  | 'hooks'
  | 'discord'

export interface WorkspaceGridModule {
  id: string
  panelId: WorkspacePanelId
  title?: string
  conversationId?: string | null
  detached?: boolean
  column: number
  row: number
  width: number
  height: number
}

export interface WorkspaceLayout {
  rows: number
  columns: number
  modules: WorkspaceGridModule[]
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
