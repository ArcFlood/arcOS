import type { IpcMain } from 'electron'
import { log } from '../logger'
import { requireHttpUrl, requireObject, requireString } from './validation'

export function registerMcpIpc(ipcMain: IpcMain): void {
  ipcMain.handle('mcp:check-health', async (_event, params: unknown) => {
    try {
      const payload = requireObject(params, 'MCP health payload')
      const url = requireHttpUrl(payload.url, 'MCP server URL')
      const transport = requireString(payload.transport, 'MCP transport', 20)
      if (transport !== 'http') {
        return { healthy: false, error: 'Only http transport is supported in this version' }
      }
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 5000)
      const response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
      }).finally(() => clearTimeout(timeout))
      return { healthy: response.ok || response.status < 500, error: undefined }
    } catch (e) {
      return { healthy: false, error: String(e) }
    }
  })

  ipcMain.handle('mcp:list-tools', async (_event, params: unknown) => {
    try {
      const payload = requireObject(params, 'MCP tools payload')
      const url = requireHttpUrl(payload.url, 'MCP server URL')
      const transport = requireString(payload.transport, 'MCP transport', 20)
      if (transport !== 'http') {
        return { tools: [], error: 'Only http transport is supported in this version' }
      }
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 8000)
      const response = await fetch(`${url}/tools`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
      }).finally(() => clearTimeout(timeout))
      if (!response.ok) {
        const rpcResp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', params: {}, id: 1 }),
        })
        if (rpcResp.ok) {
          const rpcData = await rpcResp.json() as { result?: { tools?: unknown[] } }
          return { tools: rpcData.result?.tools ?? [] }
        }
        return { tools: [], error: `HTTP ${response.status}` }
      }
      const data = await response.json() as { tools?: unknown[] }
      return { tools: data.tools ?? [] }
    } catch (e) {
      return { tools: [], error: String(e) }
    }
  })

  ipcMain.handle('mcp:register-server', (_event, config: {
    id: string; name: string; url: string; transport: 'http' | 'stdio'; description?: string
  }) => {
    log.info(`MCP server registered: ${config.name} (${config.id}) @ ${config.url}`)
    return { success: true }
  })
}
