import { ReactNode } from 'react'
import ChatArea from '../ChatArea'
import AnalyticsPanel from '../cost/AnalyticsPanel'
import ServicePanel from './ServicePanel'
import RoutingPanel from './RoutingPanel'
import CodingRuntimePanel from './CodingRuntimePanel'
import TracePanel from './TracePanel'
import PromptInspectorPanel from './PromptInspectorPanel'
import MemoryWorkspacePanel from './MemoryWorkspacePanel'
import HistoryPanel from './HistoryPanel'
import ToolsPanel from './ToolsPanel'
import HooksPanel from './HooksPanel'
import AuditPanel from './AuditPanel'
import DiscordPanel from './DiscordPanel'
import { WorkspacePanelId } from '../../workspace/types'

export interface WorkspacePanelContentProps {
  moduleId?: string
  panelId: WorkspacePanelId
  onOpenHistory: () => void
  onOpenMemory: () => void
  onOpenLog: () => void
  onOpenSettings: () => void
}

export default function WorkspacePanelContent(props: WorkspacePanelContentProps): ReactNode {
  switch (props.panelId) {
    case 'chat':
      return <ChatArea moduleId={props.moduleId ?? null} />
    case 'services':
      return <ServicePanel />
    case 'routing':
      return <RoutingPanel />
    case 'runtime':
      return <CodingRuntimePanel />
    case 'tools':
      return <ToolsPanel />
    case 'prompt_inspector':
      return <PromptInspectorPanel />
    case 'memory':
      return <MemoryWorkspacePanel />
    case 'history':
      return <HistoryPanel />
    case 'cost':
      return <div className="p-4"><AnalyticsPanel /></div>
    case 'transparency':
      return <TracePanel />
    case 'hooks':
      return <HooksPanel />
    case 'audit':
      return <AuditPanel />
    case 'discord':
      return <DiscordPanel />
    default:
      return null
  }
}
