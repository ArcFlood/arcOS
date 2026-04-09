import { app, dialog, type BrowserWindow, type IpcMain } from 'electron'

type DetachedPanelPayload = {
  moduleId: string
  panelId: string
  title?: string
}

type WindowIpcDeps = {
  getMainWindow: () => BrowserWindow | null
  continueClose: () => void
  cancelClose: () => void
  detachPanel: (moduleId: string, panelId: string, title?: string) => void
  redockPanel: (moduleId: string) => void
  syncDetachedPanels: (modules: DetachedPanelPayload[]) => void
}

export function registerWindowIpc(ipcMain: IpcMain, deps: WindowIpcDeps): void {
  ipcMain.handle('get-platform', () => process.platform)

  ipcMain.handle('app-close:choose-terminal-action', async (_event, params: { terminalCount: number }) => {
    const mainWindow = deps.getMainWindow()
    if (!mainWindow || mainWindow.isDestroyed()) return { action: 'cancel' }
    const choice = await dialog.showMessageBox(mainWindow, {
      type: 'question',
      buttons: ['Save All', 'Archive All', "Don't Save", 'Cancel'],
      defaultId: 0,
      cancelId: 3,
      title: 'Close ARCOS',
      message: `${params.terminalCount} active terminal thread${params.terminalCount === 1 ? '' : 's'} found.`,
      detail: 'Save keeps threads available locally. Archive writes them to ARC-Memory and Sessions before closing. Don’t Save deletes them.',
    })
    const actions = ['save', 'archive', 'discard', 'cancel'] as const
    return { action: actions[choice.response] ?? 'cancel' }
  })

  ipcMain.handle('app-close:continue', () => {
    deps.continueClose()
    return { success: true }
  })

  ipcMain.handle('app-close:cancel', () => {
    deps.cancelClose()
    return { success: true }
  })

  ipcMain.handle('workspace:detach-panel', (_event, payload: DetachedPanelPayload) => {
    deps.detachPanel(payload.moduleId, payload.panelId, payload.title)
    return { success: true }
  })

  ipcMain.handle('workspace:redock-panel', (_event, moduleId: string) => {
    deps.redockPanel(moduleId)
    return { success: true }
  })

  ipcMain.handle('workspace:sync-detached-panels', (_event, modules: DetachedPanelPayload[]) => {
    deps.syncDetachedPanels(modules)
    return { success: true }
  })

  ipcMain.handle('app:quit', () => {
    app.quit()
    return { success: true }
  })
}
