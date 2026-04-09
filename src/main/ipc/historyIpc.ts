import { shell, type IpcMain } from 'electron'
import os from 'os'
import path from 'path'
import { log } from '../logger'
import {
  exportSpendingCsv,
  listLearningFiles,
  listSessionFiles,
  readLearningFile,
  readSessionFile,
  saveLearning,
  shouldShowWeeklyDigest,
  writeSessionSummary,
  type LearningEntry,
  type SessionSummaryData,
  type SpendingCsvRow,
} from '../sessionHistory'
import { optionalInteger, optionalString, requireObject, requireString } from './validation'

export function registerHistoryIpc(
  ipcMain: IpcMain,
  getApiKeyFromDb: () => string,
  enforceWritePermission: (action: string, targetPath?: string) => unknown,
): void {
  ipcMain.handle('session:list', (_event, limit?: number) => {
    try { return { success: true, sessions: listSessionFiles(optionalInteger(limit, 'session list limit', 50, 1, 500)) } }
    catch (e) { return { success: false, sessions: [], error: String(e) } }
  })

  ipcMain.handle('session:read', (_event, filePath: string) => {
    try { return { success: true, content: readSessionFile(requireString(filePath, 'session file path', 4096)) } }
    catch (e) { return { success: false, content: '', error: String(e) } }
  })

  ipcMain.handle('session:write-summary', async (_event, params: {
    data: SessionSummaryData
  }) => {
    const denied = enforceWritePermission('writing session summary')
    if (denied) return denied
    const { data } = requireObject(params, 'session summary payload') as unknown as { data: SessionSummaryData }
    const apiKey = getApiKeyFromDb()
    let topics = ''

    if (apiKey) {
      try {
        const sampleMessages = data.messages
          .filter((m) => m.role !== 'system')
          .slice(-20)
          .map((m) => `${m.role}: ${m.content.slice(0, 200)}`)
          .join('\n')

        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 256,
            messages: [{
              role: 'user',
              content: `Summarize the key topics of this conversation in 1-2 sentences:\n\n${sampleMessages}`,
            }],
          }),
          signal: AbortSignal.timeout(15000),
        })
        if (res.ok) {
          const json = await res.json() as { content?: Array<{ type: string; text: string }> }
          topics = json.content?.[0]?.text ?? ''
        }
      } catch (e) {
        log.warn('Session summary topic extraction failed', String(e))
      }
    }

    try {
      const filePath = writeSessionSummary(data, topics)
      return { success: true, filePath }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  ipcMain.handle('session:should-show-digest', (_event, lastDigestDate: string | null) => {
    return { show: shouldShowWeeklyDigest(optionalString(lastDigestDate, 'last digest date', 50) ?? null) }
  })

  ipcMain.handle('learnings:save', (_event, entry: LearningEntry) => {
    const denied = enforceWritePermission('saving learning entry')
    if (denied) return denied
    try { return { success: true, filePath: saveLearning(entry) } }
    catch (e) { return { success: false, error: String(e) } }
  })

  ipcMain.handle('learnings:list', (_event, limit?: number) => {
    try { return { success: true, files: listLearningFiles(optionalInteger(limit, 'learnings list limit', 50, 1, 500)) } }
    catch (e) { return { success: false, files: [], error: String(e) } }
  })

  ipcMain.handle('learnings:read', (_event, filePath: string) => {
    try { return { success: true, content: readLearningFile(requireString(filePath, 'learning file path', 4096)) } }
    catch (e) { return { success: false, content: '', error: String(e) } }
  })

  ipcMain.handle('learnings:open-dir', () => {
    const dir = path.join(os.homedir(), '.noah-ai-hub', 'history', 'learnings')
    shell.openPath(dir)
    return { success: true }
  })

  ipcMain.handle('spending:export-csv', (_event, params: { records: SpendingCsvRow[]; month?: string }) => {
    const denied = enforceWritePermission('exporting spending CSV')
    if (denied) return denied
    try {
      const filePath = exportSpendingCsv(params.records, params.month)
      shell.openPath(path.dirname(filePath))
      return { success: true, filePath }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })
}
