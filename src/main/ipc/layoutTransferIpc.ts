import { dialog, type IpcMain } from 'electron'
import fs from 'fs'

type LayoutTransferPayload = {
  label: string
  layout: unknown
  exportedAt: string
  product: string
  version: number
}

function toSafeFileBase(label: string, fallback: string): string {
  return label.replace(/[^a-z0-9\s-]/gi, '').trim().replace(/\s+/g, '-').toLowerCase() || fallback
}

export function registerLayoutTransferIpc(
  ipcMain: IpcMain,
  enforceWritePermission: (action: string, targetPath?: string) => unknown,
): void {
  ipcMain.handle('save-conversation-md', async (_event, params: {
    title: string
    content: string
  }) => {
    const defaultPath = `${toSafeFileBase(params.title, 'conversation')}.md`

    const result = await dialog.showSaveDialog({
      defaultPath,
      filters: [{ name: 'Markdown', extensions: ['md'] }],
      properties: ['createDirectory'],
    })

    if (result.canceled || !result.filePath) return { success: false }
    const denied = enforceWritePermission('saving conversation markdown', result.filePath)
    if (denied) return denied

    try {
      fs.writeFileSync(result.filePath, params.content, 'utf8')
      return { success: true, filePath: result.filePath }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  ipcMain.handle('layout:export', async (_event, params: LayoutTransferPayload) => {
    const defaultPath = `${toSafeFileBase(params.label, 'arcos-layout')}.arcos-layout.json`

    const result = await dialog.showSaveDialog({
      defaultPath,
      filters: [{ name: 'ARCOS Layout', extensions: ['json'] }],
      properties: ['createDirectory'],
    })

    if (result.canceled || !result.filePath) return { success: false }
    const denied = enforceWritePermission('exporting layout', result.filePath)
    if (denied) return denied

    try {
      fs.writeFileSync(result.filePath, JSON.stringify(params, null, 2), 'utf8')
      return { success: true, filePath: result.filePath }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  ipcMain.handle('layout:import', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Import ARCOS Layout',
      filters: [{ name: 'ARCOS Layout', extensions: ['json'] }],
      properties: ['openFile'],
    })

    if (result.canceled || result.filePaths.length === 0) {
      return { success: false }
    }

    try {
      const filePath = result.filePaths[0]
      const raw = fs.readFileSync(filePath, 'utf8')
      const parsed = JSON.parse(raw) as LayoutTransferPayload
      return {
        success: true,
        filePath,
        payload: parsed,
      }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })
}
