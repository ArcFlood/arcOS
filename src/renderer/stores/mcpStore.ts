/**
 * mcpStore.ts — MCP (Model Context Protocol) general client framework (Item 20).
 *
 * Maintains a registry of MCP server configs, tracks live health per server,
 * and lists tools available from each server. arc-memory is the first built-in server.
 *
 * Health is checked via main process IPC (avoids CORS in renderer).
 * Tools are listed via MCP JSON-RPC `tools/list` routed through main.
 */

import { create } from 'zustand'

// ── Types ────────────────────────────────────────────────────────

export type McpTransport = 'http' | 'stdio'
export type McpServerStatus = 'unknown' | 'healthy' | 'degraded' | 'failed'

export interface McpServerConfig {
  id: string
  name: string
  url: string               // for http transport: base URL; for stdio: ignored
  transport: McpTransport
  description?: string
  enabled: boolean
  trust: 'trusted-local' | 'review-required'
  builtin?: boolean         // built-in servers cannot be removed
}

export interface McpTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  serverId: string
}

export interface McpServerState {
  config: McpServerConfig
  status: McpServerStatus
  tools: McpTool[]
  lastChecked: number | null
  error?: string
}

// ── Built-in servers ─────────────────────────────────────────────

const BUILTIN_SERVERS: McpServerConfig[] = [
  {
    id: 'arc-memory',
    name: 'ARC-Memory',
    url: 'http://localhost:8082',
    transport: 'http',
    description: 'Local semantic memory MCP server — hybrid search + HyDE re-ranking',
    enabled: true,
    trust: 'trusted-local',
    builtin: true,
  },
  {
    id: 'filesystem',
    name: 'Filesystem MCP',
    url: '',
    transport: 'stdio',
    description: 'Allowlisted local filesystem MCP candidate. Disabled until reviewed and configured.',
    enabled: false,
    trust: 'review-required',
    builtin: true,
  },
  {
    id: 'github',
    name: 'GitHub MCP',
    url: '',
    transport: 'stdio',
    description: 'Allowlisted GitHub MCP candidate. Disabled until reviewed and configured.',
    enabled: false,
    trust: 'review-required',
    builtin: true,
  },
]

// ── Store interface ───────────────────────────────────────────────

interface McpStore {
  servers: McpServerState[]
  lastPollAt: number | null

  // Actions
  initialize: () => void
  registerServer: (config: McpServerConfig) => void
  removeServer: (id: string) => void
  checkHealth: (id?: string) => Promise<void>   // undefined = all servers
  refreshTools: (id?: string) => Promise<void>  // undefined = all servers

  // Selectors
  getServer: (id: string) => McpServerState | undefined
  getTools: () => McpTool[]
  getToolsForServer: (id: string) => McpTool[]
  healthySeverCount: () => number
}

// ── Store implementation ─────────────────────────────────────────

export const useMcpStore = create<McpStore>((set, get) => ({
  servers: [],
  lastPollAt: null,

  initialize: () => {
    // Seed with built-in servers if not already present
    const existing = get().servers.map((s) => s.config.id)
    const toAdd = BUILTIN_SERVERS.filter((b) => !existing.includes(b.id))
    if (toAdd.length === 0) return
    set((s) => ({
      servers: [
        ...s.servers,
        ...toAdd.map((config) => ({
          config,
          status: 'unknown' as McpServerStatus,
          tools: [],
          lastChecked: null,
        })),
      ],
    }))
  },

  registerServer: (config) => {
    set((s) => {
      const exists = s.servers.some((srv) => srv.config.id === config.id)
      if (exists) return s
      return {
        servers: [
          ...s.servers,
          { config, status: 'unknown', tools: [], lastChecked: null },
        ],
      }
    })
  },

  removeServer: (id) => {
    const server = get().servers.find((s) => s.config.id === id)
    if (server?.config.builtin) {
      console.warn(`[McpStore] Cannot remove built-in server: ${id}`)
      return
    }
    set((s) => ({ servers: s.servers.filter((srv) => srv.config.id !== id) }))
  },

  checkHealth: async (targetId?) => {
    const targets = targetId
      ? get().servers.filter((s) => s.config.id === targetId && s.config.enabled)
      : get().servers.filter((s) => s.config.enabled)

    await Promise.allSettled(
      targets.map(async (srv) => {
        try {
          const result = await window.electron.mcpCheckHealth({
            id: srv.config.id,
            url: srv.config.url,
            transport: srv.config.transport,
          })
          set((s) => ({
            servers: s.servers.map((entry) =>
              entry.config.id === srv.config.id
                ? {
                    ...entry,
                    status: result.healthy ? 'healthy' : 'failed',
                    lastChecked: Date.now(),
                    error: result.error,
                  }
                : entry
            ),
          }))
        } catch (e) {
          set((s) => ({
            servers: s.servers.map((entry) =>
              entry.config.id === srv.config.id
                ? { ...entry, status: 'failed', lastChecked: Date.now(), error: String(e) }
                : entry
            ),
          }))
        }
      })
    )
    set({ lastPollAt: Date.now() })
  },

  refreshTools: async (targetId?) => {
    const targets = targetId
      ? get().servers.filter((s) => s.config.id === targetId && s.config.enabled && s.status === 'healthy')
      : get().servers.filter((s) => s.config.enabled && s.status === 'healthy')

    await Promise.allSettled(
      targets.map(async (srv) => {
        try {
          const result = await window.electron.mcpListTools({
            id: srv.config.id,
            url: srv.config.url,
            transport: srv.config.transport,
          })
          const tools: McpTool[] = (result.tools ?? []).map((t: { name: string; description?: string; inputSchema?: Record<string, unknown> }) => ({
            name: t.name,
            description: t.description ?? '',
            inputSchema: t.inputSchema ?? {},
            serverId: srv.config.id,
          }))
          set((s) => ({
            servers: s.servers.map((entry) =>
              entry.config.id === srv.config.id ? { ...entry, tools } : entry
            ),
          }))
        } catch {
          // Keep existing tools on error; don't wipe them
        }
      })
    )
  },

  getServer: (id) => get().servers.find((s) => s.config.id === id),

  getTools: () => get().servers.flatMap((s) => s.tools),

  getToolsForServer: (id) =>
    get().servers.find((s) => s.config.id === id)?.tools ?? [],

  healthySeverCount: () =>
    get().servers.filter((s) => s.status === 'healthy').length,
}))
