import { ReactNode } from 'react'
import Sidebar from '../Sidebar'
import ChatArea from '../ChatArea'
import ModelManager from '../models/ModelManager'
import AnalyticsPanel from '../cost/AnalyticsPanel'
import ServicePanel from './ServicePanel'
import RoutingPanel from './RoutingPanel'
import TracePanel from './TracePanel'
import ExecutionTracePanel from './ExecutionTracePanel'
import PromptInspectorPanel from './PromptInspectorPanel'
import MemoryWorkspacePanel from './MemoryWorkspacePanel'
import HistoryPanel from './HistoryPanel'
import ToolsPanel from './ToolsPanel'
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
    default:
      return null
  }
}

function UtilitiesPanel({ onOpenHistory, onOpenMemory, onOpenLog, onOpenSettings }: Omit<WorkspacePanelContentProps, 'panelId'>) {
  const showPanel = useWorkspaceStore((s) => s.showPanel)

  return (
    <div className="space-y-3 p-4">
      <UtilityButton label="Open Memory Panel" description="Dock the native memory workspace surface." onClick={() => showPanel('memory')} />
      <UtilityButton label="Open History Panel" description="Dock sessions and routing logs into the workspace." onClick={() => showPanel('history')} />
      <UtilityButton label="Open Prompt Inspector" description="Inspect A.R.C. prompt layers and context inputs." onClick={() => showPanel('prompt_inspector')} />
      <UtilityButton label="Open Legacy Memory" description="Launch the older memory drawer while the panel transition settles." onClick={onOpenMemory} />
      <UtilityButton label="Open Legacy History" description="Open the older session-history modal for comparison." onClick={onOpenHistory} />
      <UtilityButton label="Open Error Log" description="Inspect renderer and main-process logs." onClick={onOpenLog} />
      <UtilityButton label="Open Settings" description="Adjust budgets, routing, and API configuration." onClick={onOpenSettings} />
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
