import { dialog, shell, type IpcMain } from 'electron'
import { ingestHookEvent } from '../hooks/hookRegistry'
import { getPluginsDir, installPlugin, listPlugins } from '../plugins/loader'
import { optionalString, requireObject, requireString } from './validation'

export function registerPluginIpc(
  ipcMain: IpcMain,
  enforceWritePermission: (action: string, targetPath?: string) => unknown,
): void {
  ipcMain.handle('plugins:list', () => {
    try {
      return { success: true, plugins: listPlugins() }
    } catch (e) {
      return { success: false, plugins: [], error: String(e) }
    }
  })

  ipcMain.handle('plugins:install-file', async () => {
    const denied = enforceWritePermission('installing a plugin')
    if (denied) return denied
    const result = await dialog.showOpenDialog({
      title: 'Install Plugin',
      filters: [{ name: 'Plugin Manifest', extensions: ['json'] }],
      properties: ['openFile'],
    })
    if (result.canceled || result.filePaths.length === 0) return { success: false }
    return installPlugin(result.filePaths[0])
  })

  ipcMain.handle('plugins:open-dir', () => {
    shell.openPath(getPluginsDir())
    return { success: true }
  })

  ipcMain.handle('plugin:run-hook', (_event, params: {
    pluginId: string
    pluginName: string
    hookType: 'onActivate' | 'onDeactivate' | 'beforeMessage'
    hookValue?: string
  }) => {
    const payload = requireObject(params, 'plugin hook payload')
    const pluginId = requireString(payload.pluginId, 'plugin id', 200)
    const pluginName = requireString(payload.pluginName, 'plugin name', 200)
    const hookType = requireString(payload.hookType, 'plugin hook type', 50) as 'onActivate' | 'onDeactivate' | 'beforeMessage'
    const hookValue = optionalString(payload.hookValue, 'plugin hook value', 20_000)
    if (!['onActivate', 'onDeactivate', 'beforeMessage'].includes(hookType)) {
      return { success: false, error: `Unsupported plugin hook type: ${hookType}` }
    }
    ingestHookEvent({
      eventType: hookType === 'onActivate' ? 'request.accepted'
                : hookType === 'onDeactivate' ? 'request.accepted'
                : 'prompt.rebuilt',
      stage: 'intake',
      status: 'completed',
      requestId: `plugin-hook-${Date.now()}`,
      summary: `Plugin ${hookType}: ${pluginName}`,
      details: hookValue ?? `${pluginId} lifecycle event`,
    })
    return { success: true }
  })
}
