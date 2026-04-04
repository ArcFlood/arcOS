import React from 'react'
import { WorkspacePanelId } from '../../workspace/types'

interface PanelErrorBoundaryProps {
  panelId: WorkspacePanelId
  onError: (panelId: WorkspacePanelId) => void
  onHide?: (panelId: WorkspacePanelId) => void
  onRecoverWorkspace?: () => void
  children: React.ReactNode
}

interface PanelErrorBoundaryState {
  hasError: boolean
}

export default class PanelErrorBoundary extends React.Component<PanelErrorBoundaryProps, PanelErrorBoundaryState> {
  state: PanelErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(): PanelErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(): void {
    this.props.onError(this.props.panelId)
  }

  private retry = () => {
    this.setState({ hasError: false })
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children
    }

    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="max-w-md">
          <p className="arcos-kicker mb-2">Panel Recovery</p>
          <p className="text-sm font-semibold text-text">This panel failed to initialize.</p>
          <p className="mt-2 text-xs leading-5 text-text-muted">
            ARCOS isolated the failure so the rest of the workspace can keep running.
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <button onClick={this.retry} className="arcos-action rounded px-3 py-2 text-xs">
            Retry Panel
          </button>
          {this.props.onHide && (
            <button
              onClick={() => this.props.onHide?.(this.props.panelId)}
              className="arcos-action rounded px-3 py-2 text-xs"
            >
              Hide Panel
            </button>
          )}
          {this.props.onRecoverWorkspace && (
            <button
              onClick={this.props.onRecoverWorkspace}
              className="arcos-action-primary rounded px-3 py-2 text-xs"
            >
              Reset Workspace
            </button>
          )}
        </div>
      </div>
    )
  }
}
