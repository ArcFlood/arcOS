import { ReactNode } from 'react'
import Sidebar from '../Sidebar'
import ChatArea from '../ChatArea'
import ModelManager from '../models/ModelManager'
import AnalyticsPanel from '../cost/AnalyticsPanel'
import ServicePanel from './ServicePanel'
import RoutingPanel from './RoutingPanel'
import CodingRuntimePanel from './CodingRuntimePanel'
import TracePanel from './TracePanel'
import ExecutionTracePanel from './ExecutionTracePanel'
import PromptInspectorPanel from './PromptInspectorPanel'
import MemoryWorkspacePanel from './MemoryWorkspacePanel'
import HistoryPanel from './HistoryPanel'
import ToolsPanel from './ToolsPanel'
import HooksPanel from './HooksPanel'
import AuditPanel from './AuditPanel'
import DiscordPanel from './DiscordPanel'
import { WorkspacePanelId } from '../../workspace/types'
import { useWorkspaceStore } from '../../stores/workspaceStore'

export interface WorkspacePanelContentProps {
  panelId: WorkspacePanelId
  onOpenHistory: () => void
  onOpenMemory: () => void
  onOpenLog: () => void
  onOpenSettings: () => void
}

export default function WorkspacePanelContent(props: WorkspacePanelContentProps): ReactNode {
  switch (props.panelId) {
    case 'navigator':
      return <Sidebar onOpenHistory={props.onOpenHistory} onOpenMemory={props.onOpenMemory} />
    case 'chat':
      return <ChatArea />
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
    case 'models':
      return <div className="p-4"><ModelManager /></div>
    case 'cost':
      return <div className="p-4"><AnalyticsPanel /></div>
    case 'transparency':
      return <TracePanel />
    case 'execution':
      return <ExecutionTracePanel />
    case 'utilities':
      return <UtilitiesPanel {...props} />
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

function UtilitiesPanel({ onOpenSettings }: Pick<WorkspacePanelContentProps, 'onOpenSettings'>) {
  const showPanel = useWorkspaceStore((s) => s.showPanel)

  return (
    <div className="space-y-3 p-4">
      <UtilityButton label="Open Memory" description="Dock the native memory module into the current workspace." onClick={() => showPanel('memory')} />
      <UtilityButton label="Open History" description="Dock sessions, learnings, and routing logs into the workspace." onClick={() => showPanel('history')} />
      <UtilityButton label="Open Prompt Inspector" description="Inspect ARC prompt layers, provenance, and context inputs." onClick={() => showPanel('prompt_inspector')} />
      <UtilityButton label="Open Services" description="Check runtime health and control PAI services." onClick={() => showPanel('services')} />
      <UtilityButton label="Open Routing" description="Inspect model-path decisions, confidence, and overrides." onClick={() => showPanel('routing')} />
      <UtilityButton label="Open Transparency" description="Bring the latest chain outputs and observability feed forward." onClick={() => showPanel('transparency')} />
      <UtilityButton label="Open Settings" description="Adjust routing, appearance, budgets, and local runtime settings." onClick={onOpenSettings} />
    </div>
  )
}

function UtilityButton({
  label,
  description,
  onClick,
}: {
  label: string
  description: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="arcos-subpanel w-full rounded-xl px-3 py-3 text-left transition-colors hover:border-[#8fa1b3]/40 hover:bg-[#1b2027]"
    >
      <p className="arcos-kicker mb-1">Utility</p>
      <p className="text-sm font-medium text-text">{label}</p>
      <p className="mt-1 text-xs leading-5 text-text-muted">{description}</p>
    </button>
  )
}
