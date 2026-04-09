import type { IpcMain } from 'electron'
import { hasApiKeyInDb, setApiKeyInDb } from '../services/apiKeyStore'

export function registerApiKeyIpc(ipcMain: IpcMain): void {
  ipcMain.handle('apiKey:set', (_event, key: string) => {
    try {
      setApiKeyInDb(key ?? '')
      return { success: true }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  ipcMain.handle('apiKey:has', () => {
    return { hasKey: hasApiKeyInDb() }
  })
}
