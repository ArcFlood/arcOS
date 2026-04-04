import { WorkspaceLayout, WorkspacePanelDefinition } from './types'

export const WORKSPACE_PANELS: WorkspacePanelDefinition[] = [
  {
    id: 'navigator',
    title: 'Navigator',
    description: 'Thread index, service cues, and quick access into active PAI work.',
    icon: '🗂',
  },
  {
    id: 'chat',
    title: 'Chat',
    description: 'Active task-thread exchange inside the broader PAI workspace.',
    icon: '💬',
  },
  {
    id: 'services',
    title: 'Services',
    description: 'Runtime controls and health for PAI services.',
    icon: '🧩',
  },
  {
    id: 'routing',
    title: 'Routing',
    description: 'Model selection, rationale, and override controls.',
    icon: '🧠',
  },
  {
    id: 'runtime',
    title: 'Runtime',
    description: 'Structured coding-runtime status for repo, worktree, and verification scope.',
    icon: '⑂',
  },
  {
    id: 'tools',
    title: 'Tools',
    description: 'Fabric patterns, plugins, and future PAI-native modules.',
    icon: '🛠',
  },
  {
    id: 'prompt_inspector',
    title: 'Prompt Inspector',
    description: 'Prompt layers, provenance, and token visibility.',
    icon: '📐',
  },
  {
    id: 'memory',
    title: 'Memory',
    description: 'Semantic search, citations, and memory workflows.',
    icon: '🧠',
  },
  {
    id: 'history',
    title: 'History',
    description: 'Sessions, learnings, and routing history.',
    icon: '🕘',
  },
  {
    id: 'models',
    title: 'Models',
    description: 'Local runtime inventory, pulls, and model management.',
    icon: '📦',
  },
  {
    id: 'cost',
    title: 'Cost',
    description: 'Usage, token, and budget visibility.',
    icon: '₿',
  },
  {
    id: 'transparency',
    title: 'Transparency',
    description: 'Live orchestration feed across routing, memory, and tools.',
    icon: '◫',
  },
  {
    id: 'execution',
    title: 'Execution',
    description: 'Ordered execution timeline across requests and tools.',
    icon: '⋮',
  },
  {
    id: 'utilities',
    title: 'Utilities',
    description: 'Compatibility launchers and transitional ARCOS actions.',
    icon: '⌘',
  },
]

export const DEFAULT_WORKSPACE_LAYOUT: WorkspaceLayout = {
  rows: 3,
  columns: 4,
  modules: [],
  detachedPanels: [],
}
