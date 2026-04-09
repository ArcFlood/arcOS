import fs from 'fs'
import path from 'path'
import { shell, type IpcMain } from 'electron'
import { memoryHygieneRoots, scanMemoryHygieneCandidates } from '../services/memoryHygiene'
import { canonicalPathAllowMissing, isPathInside } from '../permissions/policy'
import { requireObject, requireString, requireStringArray } from './validation'

type VaultWriteParams = {
  conversationId: string
  title: string
  createdAt: number
  updatedAt?: number
  messages: Array<{ role: string; content: string; model?: string }>
  tags: string[]
  totalCost: number
}

export function parseMemoryEnv(envPath: string): Record<string, string> {
  try {
    const content = fs.readFileSync(envPath, 'utf8')
    const result: Record<string, string> = {}
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq === -1) continue
      result[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim()
    }
    return result
  } catch {
    return {}
  }
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .slice(0, 60)
}

export function registerMemoryIpc(
  ipcMain: IpcMain,
  getMemoryEnv: () => Record<string, string>,
  enforceExecutePermission: (action: string) => unknown,
  enforceWritePermission: (action: string, targetPath?: string) => unknown,
): void {
  ipcMain.handle('memory-query', async (_event, params: {
    query: string
    limit?: number
    dateAfter?: string
  }) => {
    const { query, limit = 20, dateAfter } = params
    try {
      const res = await fetch('http://localhost:8082/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, limit, date_after: dateAfter ?? null }),
        signal: AbortSignal.timeout(8000),
      })
      if (!res.ok) {
        const errText = await res.text().catch(() => `HTTP ${res.status}`)
        return { success: false, error: errText, chunks: [], citations: [], query_time_ms: 0, total_results: 0 }
      }
      const data = await res.json()
      return { success: true, ...data }
    } catch (e) {
      return { success: false, error: String(e), chunks: [], citations: [], query_time_ms: 0, total_results: 0 }
    }
  })

  ipcMain.handle('memory-ingest', async (_event, force: boolean = false) => {
    try {
      const denied = enforceExecutePermission('running ARC-Memory ingest')
      if (denied) return denied
      const res = await fetch('http://localhost:8082/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force }),
        signal: AbortSignal.timeout(5000),
      })
      if (!res.ok) return { success: false, error: `HTTP ${res.status}` }
      const data = await res.json()
      return { success: true, ...data }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  ipcMain.handle('memory-status', async () => {
    try {
      const res = await fetch('http://localhost:8082/status', { signal: AbortSignal.timeout(3000) })
      if (!res.ok) return { success: false }
      const data = await res.json()
      return { success: true, ...data }
    } catch { return { success: false } }
  })

  ipcMain.handle('memory:hygiene-scan', () => {
    try {
      const env = getMemoryEnv()
      const candidates = scanMemoryHygieneCandidates(env['VAULT_PATH'])
      return { success: true, candidates }
    } catch (e) {
      return { success: false, candidates: [], error: String(e) }
    }
  })

  ipcMain.handle('memory:hygiene-delete', async (_event, requestedFilePaths: unknown) => {
    try {
      const filePaths = requireStringArray(requestedFilePaths, 'memory hygiene file paths', 400, 4096)
      const env = getMemoryEnv()
      const allowedRoots = memoryHygieneRoots(env['VAULT_PATH']).map(({ root }) => canonicalPathAllowMissing(root))
      const deleted: string[] = []
      const failed: string[] = []
      for (const filePath of filePaths) {
        const resolved = canonicalPathAllowMissing(filePath)
        const allowed = allowedRoots.some((root) => isPathInside(root, resolved))
        if (!allowed || !resolved.endsWith('.md')) {
          return { success: false, deleted, error: `Rejected unsafe memory path: ${filePath}` }
        }
        const denied = enforceWritePermission('deleting low-value memory file', resolved)
        if (denied) return { ...denied, deleted }
        if (fs.existsSync(resolved)) {
          try {
            await shell.trashItem(resolved)
          } catch {
            failed.push(resolved)
            continue
          }
          if (fs.existsSync(resolved)) {
            failed.push(resolved)
          } else {
            deleted.push(resolved)
          }
        }
      }
      if (failed.length > 0) {
        return { success: false, deleted, error: `Failed to delete ${failed.length} memory file${failed.length === 1 ? '' : 's'}.` }
      }
      return { success: true, deleted }
    } catch (e) {
      return { success: false, deleted: [], error: String(e) }
    }
  })

  ipcMain.handle('memory:vault-write', (_event, params: unknown) => {
    try {
      const payload = requireObject(params, 'vault write payload') as unknown as VaultWriteParams
      requireString(payload.conversationId, 'conversation id', 200)
      requireString(payload.title, 'conversation title', 500)
      if (typeof payload.createdAt !== 'number' || !Number.isFinite(payload.createdAt)) throw new Error('createdAt must be a finite number')
      if (payload.updatedAt !== undefined && (typeof payload.updatedAt !== 'number' || !Number.isFinite(payload.updatedAt))) throw new Error('updatedAt must be a finite number')
      if (!Array.isArray(payload.messages)) throw new Error('messages must be an array')
      if (!Array.isArray(payload.tags)) throw new Error('tags must be an array')
      if (typeof payload.totalCost !== 'number' || !Number.isFinite(payload.totalCost)) throw new Error('totalCost must be a finite number')
      const env = getMemoryEnv()
      const vaultPath = env['VAULT_PATH'] ?? ''
      if (!vaultPath) return { success: false, error: 'VAULT_PATH not configured in memory-service/.env' }
      const denied = enforceWritePermission('writing conversation to ArcVault', vaultPath)
      if (denied) return denied

      const date = new Date(payload.createdAt)
      const dateStr = date.toISOString().slice(0, 10)
      const slug = slugify(payload.title) || 'conversation'
      const conversationKey = slugify(payload.conversationId).slice(0, 12) || 'session'
      const filename = `${dateStr}_${slug}_${conversationKey}.md`
      const dir = path.join(vaultPath, 'arcos')
      fs.mkdirSync(dir, { recursive: true })
      const filePath = path.join(dir, filename)

      const escapedTitle = payload.title.replace(/"/g, '\\"')
      const tagsYaml = payload.tags.length > 0
        ? `\ntags: [${payload.tags.map((t) => `"${t}"`).join(', ')}]`
        : ''
      const costLine = payload.totalCost > 0 ? `\ncost: ${payload.totalCost.toFixed(5)}` : ''
      const updatedAtLine = payload.updatedAt ? `\nupdated_at: ${new Date(payload.updatedAt).toISOString()}` : ''
      const messageCountLine = `\nmessage_count: ${payload.messages.filter((message) => message.role !== 'system').length}`
      const header = `---\nsource: arcos\nconversation_id: ${payload.conversationId}\ntitle: "${escapedTitle}"\ndate: ${dateStr}${updatedAtLine}${tagsYaml}${costLine}${messageCountLine}\n---\n\n`

      const bodyParts: string[] = []
      for (const m of payload.messages) {
        if (m.role === 'system') continue
        const label = m.role === 'user' ? '**User:**' : '**Assistant:**'
        bodyParts.push(`${label}\n\n${m.content}`)
      }
      const body = bodyParts.join('\n\n---\n\n')

      fs.writeFileSync(filePath, header + body, 'utf8')
      return { success: true, filePath }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  ipcMain.handle('memory:vault-path', () => {
    const env = getMemoryEnv()
    return { success: true, vaultPath: env['VAULT_PATH'] ?? '' }
  })
}
