import { shell, type IpcMain } from 'electron'
import { getBugReportsDirPath, submitBugReport } from '../bugReport'
import { requireObject, requireString } from './validation'

export function registerBugReportIpc(ipcMain: IpcMain): void {
  ipcMain.handle('bug-report:submit', async (_event, params: { title: string; description: string }) => {
    try {
      const payload = requireObject(params, 'bug report payload')
      const result = await submitBugReport(
        requireString(payload.title, 'bug report title', 300),
        requireString(payload.description, 'bug report description', 20_000),
      )
      return result
    } catch (e) {
      return { success: false, method: 'file' as const, error: String(e) }
    }
  })

  ipcMain.handle('bug-report:open-dir', () => {
    const dir = getBugReportsDirPath()
    shell.openPath(dir)
    return { success: true }
  })
}
