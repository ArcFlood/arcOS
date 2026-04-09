import { shell, type IpcMain } from 'electron'
import { appendLog, clearLog, getLogEntries, getLogFilePath, type LogCategory } from '../logger'
import { appendRoutingEntry, getRoutingEntries, getRoutingLogDates, type RoutingEntry } from '../routingLog'
import { optionalString, requireObject, requireString } from './validation'

export function registerLogRoutingIpc(ipcMain: IpcMain): void {
  ipcMain.handle('log:append', (_event, level: string, message: string, detail?: string, category?: string) => {
    const safeLevel = ['info', 'warn', 'error'].includes(level) ? level as 'info' | 'warn' | 'error' : 'error'
    const validCategories: LogCategory[] = ['prompt_delivery', 'trust_gate', 'compile', 'plugin_startup', 'mcp_startup', 'mcp_handshake', 'tool_runtime', 'infra']
    const safeCat = validCategories.includes(category as LogCategory) ? category as LogCategory : undefined
    appendLog(
      safeLevel,
      'renderer',
      requireString(message, 'log message', 20_000),
      optionalString(detail, 'log detail', 100_000),
      safeCat,
    )
    return { success: true }
  })

  ipcMain.handle('log:get-entries', () => {
    return { success: true, entries: getLogEntries() }
  })

  ipcMain.handle('log:clear', () => {
    clearLog()
    return { success: true }
  })

  ipcMain.handle('log:open-file', () => {
    shell.openPath(getLogFilePath())
    return { success: true }
  })

  ipcMain.handle('routing:append', (_event, entry: RoutingEntry) => {
    try { appendRoutingEntry(requireObject(entry, 'routing entry') as unknown as RoutingEntry); return { success: true } }
    catch (e) { return { success: false, error: String(e) } }
  })

  ipcMain.handle('routing:get-entries', (_event, dateStr?: string) => {
    try { return { success: true, entries: getRoutingEntries(optionalString(dateStr, 'routing date', 20)) } }
    catch (e) { return { success: false, entries: [], error: String(e) } }
  })

  ipcMain.handle('routing:get-dates', () => {
    try { return { success: true, dates: getRoutingLogDates() } }
    catch (e) { return { success: false, dates: [], error: String(e) } }
  })
}
