import { WorkspaceLayout, WorkspacePanelDefinition } from './types'

export const WORKSPACE_PANELS: WorkspacePanelDefinition[] = [
  {
    id: 'chat',
    title: 'Terminal',
    description: 'Terminal sessions for active tasks inside the broader PAI workspace.',
    icon: '',
    defaultSize: {
      width: 1,
      height: 2,
    },
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
    title: 'Memory Search',
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
    id: 'cost',
    title: 'Analytics',
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
    id: 'hestia',
    title: 'Hestia',
    description: 'Real-time visual dashboard for ARCOS process and service state.',
    icon: '',
    defaultSize: {
      width: 2,
      height: 2,
    },
  },
  {
    id: 'hooks',
    title: 'Automation',
    description: 'Hook management and automation event logs.',
    icon: '',
  },
  {
    id: 'discord',
    title: 'Discord',
    description: 'Discord server integration — channel-based project comms.',
    icon: '💬',
  },
  {
    id: 'runtime',
    title: 'Dev Tools',
    description: 'Developer-facing runtime status, verification scope, and audit review.',
    icon: '',
  },
]

export const DEFAULT_WORKSPACE_LAYOUT: WorkspaceLayout = {
  rows: 3,
  columns: 4,
  modules: [],
}
