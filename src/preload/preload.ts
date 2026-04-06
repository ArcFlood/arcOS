import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electron', {
  platform: process.platform,
  getPlatform: () => ipcRenderer.invoke('get-platform'),

  // A.R.C.
  loadArcPrompts: () => ipcRenderer.invoke('load-arc-prompts'),
  openClawContext: () => ipcRenderer.invoke('openclaw-context'),
  openClawAnalyze: (params: object) => ipcRenderer.invoke('openclaw:analyze', params),
  chainCaptureSave: (params: object) => ipcRenderer.invoke('chain:capture-save', params),

  // Ollama
  ollamaListModels: () => ipcRenderer.invoke('ollama-list-models'),
  ollamaListModelDetails: () => ipcRenderer.invoke('ollama-list-model-details'),
  ollamaStreamStart: (params: object) => ipcRenderer.invoke('ollama-stream-start', params),

  // Claude (runs in main process — no CORS)
  claudeStreamStart: (params: object) => ipcRenderer.invoke('claude-stream-start', params),

  // API key — write-only from renderer. Raw key stored in main process only.
  apiKeySet: (key: string) => ipcRenderer.invoke('apiKey:set', key),
  apiKeyHas: () => ipcRenderer.invoke('apiKey:has'),

  // Shared stream abort
  streamAbort: (streamId: string) => ipcRenderer.invoke('stream-abort', streamId),

  // Stream event listener
  onStreamEvent: (streamId: string, callback: (data: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data)
    ipcRenderer.on(`stream-${streamId}`, handler)
    return () => ipcRenderer.off(`stream-${streamId}`, handler)
  },

  // Services
  serviceStatus: (name: string) => ipcRenderer.invoke('service-status', name),
  serviceStart: (name: string) => ipcRenderer.invoke('service-start', name),
  serviceStop: (name: string) => ipcRenderer.invoke('service-stop', name),
  workspaceDetachPanel: (payload: { moduleId: string; panelId: string; title?: string }) => ipcRenderer.invoke('workspace:detach-panel', payload),
  workspaceRedockPanel: (moduleId: string) => ipcRenderer.invoke('workspace:redock-panel', moduleId),
  workspaceSyncDetachedPanels: (modules: Array<{ moduleId: string; panelId: string; title?: string }>) => ipcRenderer.invoke('workspace:sync-detached-panels', modules),
  codingRuntimeStatus: () => ipcRenderer.invoke('coding-runtime:status'),
  onWorkspaceEvent: (channel: string, callback: (payload: unknown) => void) => {
    const allowed = ['workspace:detached-panel-closed']
    if (!allowed.includes(channel)) return () => {}
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.off(channel, handler)
  },

  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
  openPath: (targetPath: string) => ipcRenderer.invoke('open-path', targetPath),

  // Fabric
  fabricListPatterns: () => ipcRenderer.invoke('fabric-list-patterns'),
  fabricRunPattern: (params: object) => ipcRenderer.invoke('fabric-run-pattern', params),

  // Export
  saveConversationMd: (params: object) => ipcRenderer.invoke('save-conversation-md', params),
  layoutExport: (params: object) => ipcRenderer.invoke('layout:export', params),
  layoutImport: () => ipcRenderer.invoke('layout:import'),

  // Ollama model management
  ollamaPullModel: (params: object) => ipcRenderer.invoke('ollama-pull-model', params),
  ollamaDeleteModel: (modelName: string) => ipcRenderer.invoke('ollama-delete-model', modelName),

  // Menu events (main → renderer)
  onMenuEvent: (channel: string, callback: () => void) => {
    const allowed = ['menu:new-chat', 'menu:open-settings', 'menu:export-conversation', 'menu:open-log', 'menu:open-history', 'menu:open-bug-report']
    if (!allowed.includes(channel)) return () => {}
    const handler = () => callback()
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.off(channel, handler)
  },

  // Bug reports (Item 11)
  bugReportSubmit: (params: { title: string; description: string }) =>
    ipcRenderer.invoke('bug-report:submit', params),
  bugReportOpenDir: () => ipcRenderer.invoke('bug-report:open-dir'),

  // Discord integration (Item 6)
  discordConnect: (token: string) => ipcRenderer.invoke('discord:connect', token),
  discordDisconnect: () => ipcRenderer.invoke('discord:disconnect'),
  discordStatus: () => ipcRenderer.invoke('discord:status'),
  discordChannelHistory: (channelId: string, limit?: number) => ipcRenderer.invoke('discord:channel-history', channelId, limit),
  discordSend: (channelId: string, content: string) => ipcRenderer.invoke('discord:send', channelId, content),
  discordSetMapping: (mapping: object) => ipcRenderer.invoke('discord:set-mapping', mapping),
  discordSetMonitored: (channelIds: string[]) => ipcRenderer.invoke('discord:set-monitored', channelIds),
  discordSetAutoRespond: (enabled: boolean) => ipcRenderer.invoke('discord:set-auto-respond', enabled),
  discordSubscribe: () => ipcRenderer.invoke('discord:subscribe'),
  discordUnsubscribe: () => ipcRenderer.invoke('discord:unsubscribe'),
  discordOnStatus: (callback: (status: object) => void) => {
    const handler = (_ipcEvent: Electron.IpcRendererEvent, status: object) => callback(status)
    ipcRenderer.on('discord:status', handler)
    return () => ipcRenderer.off('discord:status', handler)
  },
  discordOnMessage: (callback: (data: object) => void) => {
    const handler = (_ipcEvent: Electron.IpcRendererEvent, data: object) => callback(data)
    ipcRenderer.on('discord:message', handler)
    return () => ipcRenderer.off('discord:message', handler)
  },

  // Audit engine (Item 9)
  auditRun: () => ipcRenderer.invoke('audit:run'),
  auditList: (limit?: number) => ipcRenderer.invoke('audit:list', limit),
  auditRead: (filePath: string) => ipcRenderer.invoke('audit:read', filePath),
  auditOpenDir: () => ipcRenderer.invoke('audit:open-dir'),

  // Service watchdog (Item 7)
  watchdogStatus: () => ipcRenderer.invoke('watchdog:status'),
  watchdogSweep: () => ipcRenderer.invoke('watchdog:sweep'),
  watchdogSubscribe: () => ipcRenderer.invoke('watchdog:subscribe'),
  watchdogUnsubscribe: () => ipcRenderer.invoke('watchdog:unsubscribe'),
  watchdogOnStatus: (callback: (status: object) => void) => {
    const handler = (_ipcEvent: Electron.IpcRendererEvent, status: object) => callback(status)
    ipcRenderer.on('watchdog:status', handler)
    return () => ipcRenderer.off('watchdog:status', handler)
  },

  // Hook events (Item 5)
  hookEmit: (event: object) => ipcRenderer.invoke('hook:emit', event),
  hookGetRecent: (limit?: number) => ipcRenderer.invoke('hook:get-recent', limit),
  hookGetByType: (eventType: string, limit?: number) => ipcRenderer.invoke('hook:get-by-type', eventType, limit),
  hookGetRegistry: () => ipcRenderer.invoke('hook:get-registry'),
  hookGetStats: () => ipcRenderer.invoke('hook:get-stats'),
  hookListLogDates: () => ipcRenderer.invoke('hook:list-log-dates'),
  hookSubscribe: () => ipcRenderer.invoke('hook:subscribe'),
  hookUnsubscribe: () => ipcRenderer.invoke('hook:unsubscribe'),
  hookOnEvent: (callback: (event: object) => void) => {
    const handler = (_ipcEvent: Electron.IpcRendererEvent, event: object) => callback(event)
    ipcRenderer.on('hook:event', handler)
    return () => ipcRenderer.off('hook:event', handler)
  },

  // Plugins
  pluginsList: () => ipcRenderer.invoke('plugins:list'),
  pluginsInstallFile: () => ipcRenderer.invoke('plugins:install-file'),
  pluginsOpenDir: () => ipcRenderer.invoke('plugins:open-dir'),
  pluginRunHook: (params: object) => ipcRenderer.invoke('plugin:run-hook', params),

  // Error / Debug log
  logAppend: (level: string, message: string, detail?: string, category?: string) =>
    ipcRenderer.invoke('log:append', level, message, detail, category),
  logGetEntries: () => ipcRenderer.invoke('log:get-entries'),
  logClear: () => ipcRenderer.invoke('log:clear'),
  logOpenFile: () => ipcRenderer.invoke('log:open-file'),

  // Routing log (FR-11)
  routingAppend: (entry: object) => ipcRenderer.invoke('routing:append', entry),
  routingGetEntries: (dateStr?: string) => ipcRenderer.invoke('routing:get-entries', dateStr),
  routingGetDates: () => ipcRenderer.invoke('routing:get-dates'),

  // Session history (FR-11)
  sessionList: (limit?: number) => ipcRenderer.invoke('session:list', limit),
  sessionRead: (filePath: string) => ipcRenderer.invoke('session:read', filePath),
  sessionWriteSummary: (params: object) => ipcRenderer.invoke('session:write-summary', params),
  sessionShouldShowDigest: (lastDate: string | null) => ipcRenderer.invoke('session:should-show-digest', lastDate),

  // Learnings / bookmarks (FR-11)
  learningsSave: (entry: object) => ipcRenderer.invoke('learnings:save', entry),
  learningsList: (limit?: number) => ipcRenderer.invoke('learnings:list', limit),
  learningsRead: (filePath: string) => ipcRenderer.invoke('learnings:read', filePath),
  learningsOpenDir: () => ipcRenderer.invoke('learnings:open-dir'),

  // Spending CSV export (FR-11)
  spendingExportCsv: (params: object) => ipcRenderer.invoke('spending:export-csv', params),

  // ARC-Memory (port 8082)
  memoryQuery: (params: object) => ipcRenderer.invoke('memory-query', params),
  memoryIngest: (force?: boolean) => ipcRenderer.invoke('memory-ingest', force ?? false),
  memoryStatus: () => ipcRenderer.invoke('memory-status'),
  memoryVaultWrite: (params: object) => ipcRenderer.invoke('memory:vault-write', params),
  memoryVaultPath: () => ipcRenderer.invoke('memory:vault-path'),

  // SQLite database
  db: {
    conversations: {
      list: () => ipcRenderer.invoke('db:conversations:list'),
      save: (conv: object) => ipcRenderer.invoke('db:conversations:save', conv),
      delete: (id: string) => ipcRenderer.invoke('db:conversations:delete', id),
    },
    messages: {
      list: (conversationId: string) => ipcRenderer.invoke('db:messages:list', conversationId),
      save: (msg: object) => ipcRenderer.invoke('db:messages:save', msg),
    },
    spending: {
      list: () => ipcRenderer.invoke('db:spending:list'),
      add: (record: object) => ipcRenderer.invoke('db:spending:add', record),
      clear: () => ipcRenderer.invoke('db:spending:clear'),
    },
    settings: {
      get: (key: string) => ipcRenderer.invoke('db:settings:get', key),
      set: (key: string, value: string) => ipcRenderer.invoke('db:settings:set', key, value),
    },
  },

  // MCP general client framework (Item 20)
  mcpCheckHealth: (params: object) => ipcRenderer.invoke('mcp:check-health', params),
  mcpListTools: (params: object) => ipcRenderer.invoke('mcp:list-tools', params),
  mcpRegisterServer: (config: object) => ipcRenderer.invoke('mcp:register-server', config),

  // Tool surface registry (Item 21)
  toolsList: () => ipcRenderer.invoke('tools:list'),
})
