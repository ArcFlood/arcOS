import { shell, type IpcMain } from 'electron'
import { getAuditDir, listAuditReports, readAuditReport, runAudit } from '../audit/auditEngine'
import { optionalInteger, requireString } from './validation'

export function registerAuditIpc(ipcMain: IpcMain): void {
  ipcMain.handle('audit:run', async () => {
    try {
      const report = await runAudit()
      return { success: true, report }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  ipcMain.handle('audit:list', (_event, limit?: number) => {
    try {
      return { success: true, reports: listAuditReports(optionalInteger(limit, 'audit list limit', 30, 1, 200)) }
    } catch (e) {
      return { success: false, reports: [], error: String(e) }
    }
  })

  ipcMain.handle('audit:read', (_event, filePath: string) => {
    try {
      const report = readAuditReport(requireString(filePath, 'audit report path', 4096))
      return { success: !!report, report }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  ipcMain.handle('audit:open-dir', () => {
    shell.openPath(getAuditDir())
    return { success: true }
  })
}
