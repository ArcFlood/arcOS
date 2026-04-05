import { app, BrowserWindow, ipcMain, shell, dialog, Menu, Tray, nativeImage } from 'electron'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { execSync, spawn, ChildProcess } from 'child_process'
import {
  listConversations, upsertConversation, deleteConversation,
  listMessages, upsertMessage,
  listSpending, insertSpending, clearSpending,
  getSetting, setSetting,
  DbConversation, DbMessage, DbSpendingRecord,
} from './database/operations'
import { closeDb } from './database/db'
import { seedSamplePlugins, listPlugins, installPlugin, getPluginsDir } from './plugins/loader'
import { log, appendLog, getLogEntries, clearLog, getLogFilePath } from './logger'
import { appendRoutingEntry, getRoutingEntries, getRoutingLogDates, RoutingEntry } from './routingLog'
import {
  writeSessionSummary, listSessionFiles, readSessionFile,
  saveLearning, listLearningFiles, readLearningFile, exportSpendingCsv, shouldShowWeeklyDigest,
  SessionSummaryData, LearningEntry, SpendingCsvRow,
} from './sessionHistory'
import { writeChainArtifact, ChainArtifact } from './chainHistory'

// app.isPackaged is the reliable Electron way to detect production.
// process.env.NODE_ENV is NOT set by electron-builder at runtime, so
// checking it in the packaged app always returns "undefined" → isDev=true,
// causing the window to try loading localhost:5173 instead of dist/index.html.
const isDev = !app.isPackaged
const serviceProcesses: Record<string, ChildProcess> = {}
const activeStreams = new Map<string, AbortController>()
let mainWindow: BrowserWindow | null = null
const detachedPanelWindows = new Map<string, BrowserWindow>()
const suppressedDetachedPanelNotifications = new Set<string>()

// ── Fix PATH for macOS .app bundles ──────────────────────────────
// When launched via double-click, Electron doesn't inherit the user's shell PATH.
// Homebrew (Apple Silicon: /opt/homebrew/bin, Intel: /usr/local/bin) and other
// user-installed tools (ollama, fabric) would not be found by spawn() without this.
if (process.platform === 'darwin') {
  const extraPaths = [
    '/opt/homebrew/bin',    // Apple Silicon Homebrew
    '/opt/homebrew/sbin',
    '/usr/local/bin',       // Intel Homebrew / manual installs
    '/usr/local/sbin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
  ]
  const current = process.env.PATH ?? ''
  const existing = new Set(current.split(':').filter(Boolean))
  const prepend = extraPaths.filter((p) => !existing.has(p))
  process.env.PATH = [...prepend, current].join(':')
}

async function waitForVite(url: string, timeoutMs = 15000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1000) })
      if (res.ok || res.status === 304) return
    } catch { /* not ready yet */ }
    await new Promise((r) => setTimeout(r, 200))
  }
  // Give up waiting — load anyway and let Electron show the error
}

function loadRenderer(win: BrowserWindow, query?: Record<string, string>): void {
  if (isDev) {
    const search = query ? `?${new URLSearchParams(query).toString()}` : ''
    const DEV_URL = `http://localhost:5173${search}`
    waitForVite(DEV_URL).then(() => {
      win.loadURL(DEV_URL)
      if (!query) {
        win.webContents.openDevTools({ mode: 'detach' })
      }
    })
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'), { query })
  }
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#1a1a1a',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,   // Renderer JS cannot access Node APIs directly — preload bridge only
      // sandbox: false is required by better-sqlite3 (native .node module needs fs access in preload).
      // Mitigated by contextIsolation: true — renderer has no access to Node globals.
      sandbox: false,
      nodeIntegration: false,
      // webSecurity: false in dev only — allows loading localhost:5173 without CORS issues.
      // In production (isPackaged) web security is always enabled.
      webSecurity: !isDev,
    },
  })

  win.once('ready-to-show', () => win.show())
  loadRenderer(win)

  return win
}

function notifyDetachedPanelClosed(panelId: string): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('workspace:detached-panel-closed', panelId)
  }
}

function createDetachedPanelWindow(panelId: string): BrowserWindow {
  const existing = detachedPanelWindows.get(panelId)
  if (existing && !existing.isDestroyed()) {
    existing.show()
    existing.focus()
    return existing
  }

  const win = new BrowserWindow({
    width: 1080,
    height: 760,
    minWidth: 720,
    minHeight: 480,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#12161c',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
      webSecurity: !isDev,
    },
  })

  win.setTitle(`ARCOS · ${panelId}`)
  win.once('ready-to-show', () => win.show())
  loadRenderer(win, { detachedPanel: panelId })
  detachedPanelWindows.set(panelId, win)

  win.on('closed', () => {
    detachedPanelWindows.delete(panelId)
    if (suppressedDetachedPanelNotifications.has(panelId)) {
      suppressedDetachedPanelNotifications.delete(panelId)
      return
    }
    notifyDetachedPanelClosed(panelId)
  })

  return win
}

function closeDetachedPanelWindow(panelId: string, suppressNotification = true): void {
  const win = detachedPanelWindows.get(panelId)
  if (!win || win.isDestroyed()) return
  if (suppressNotification) {
    suppressedDetachedPanelNotifications.add(panelId)
  }
  win.close()
}

function parseFabricPatternList(output: string): string[] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .sort()
}

function listFabricPatternsCli(): string[] {
  const output = execSync('fabric --listpatterns --shell-complete-list', {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return parseFabricPatternList(output)
}

function buildFabricPatternUrlCandidates(pattern: string): Array<{ url: string; contentType: string; body: string }> {
  const encoded = encodeURIComponent(pattern)
  return [
    {
      url: `http://localhost:8080/api/pattern/${encoded}`,
      contentType: 'text/plain',
      body: '',
    },
    {
      url: `http://localhost:8080/pattern/${encoded}`,
      contentType: 'text/plain',
      body: '',
    },
    {
      url: 'http://localhost:8080/api/run',
      contentType: 'application/json',
      body: JSON.stringify({ pattern, input: '' }),
    },
  ]
}

interface LayoutTransferPayload {
  label: string
  layout: unknown
  exportedAt: string
  product: string
  version: number
}

type OpenClawServiceInfo = {
  configPath: string
  workspacePath: string
  logsPath: string
  gatewayPort: number
  browserPort: number
  bindHost: string
  gatewayMode: string
  gatewayCanvasUrl: string
  controlUrl: string
}

type OpenClawGatewaySettings = OpenClawServiceInfo & {
  token?: string
  password?: string
}

type OpenClawAnalysisRequest = {
  conversationId: string
  prompt: string
  conversationSection: string
  memorySection: string
  pluginSummary: string
}

type OpenClawAnalysisPayload = {
  summary?: string
  intent?: string
  workflow?: string
  recommended_tier?: string
  recommended_model?: string
  should_use_fabric?: boolean
  fabric_pattern?: string | null
  fabric_intent?: string | null
  confidence?: number | null
  reasoning?: string
  notes?: string[]
}

function listFabricPatternsForAnalysis(): string[] {
  try {
    return listFabricPatternsCli()
  } catch {
    return []
  }
}

type CodingRuntimeStatus = {
  linkedWorkspacePath: string
  activeRepositoryPath: string | null
  branch: string | null
  headShortSha: string | null
  upstream: string | null
  aheadCount: number
  behindCount: number
  worktreeCount: number
  stagedChanges: number
  unstagedChanges: number
  untrackedFiles: number
  conflictCount: number
  dirty: boolean
  staleBranch: boolean
  mergeReadiness: 'ready' | 'needs_sync' | 'pending_local_changes' | 'conflicted' | 'unknown'
  verificationCommands: string[]
  openClawControlUrl: string | null
  environment: 'development' | 'packaged'
}

function getOpenClawServiceInfo(): OpenClawServiceInfo {
  const configPath = path.join(os.homedir(), '.openclaw', 'openclaw.json')
  const workspacePath = path.join(os.homedir(), '.openclaw', 'workspace')
  const logsPath = path.join(os.homedir(), '.openclaw', 'logs')

  const defaults: OpenClawServiceInfo = {
    configPath,
    workspacePath,
    logsPath,
    gatewayPort: 18789,
    browserPort: 18791,
    bindHost: '127.0.0.1',
    gatewayMode: 'local',
    gatewayCanvasUrl: 'http://127.0.0.1:18789/__openclaw__/canvas/',
    controlUrl: 'http://127.0.0.1:18791/',
  }

  if (!fs.existsSync(configPath)) {
    return defaults
  }

  try {
    const raw = fs.readFileSync(configPath, 'utf8')
    const parsed = JSON.parse(raw) as {
      agents?: { defaults?: { workspace?: string } }
      gateway?: { port?: number; bind?: string; mode?: string }
    }

    const gatewayPort = parsed.gateway?.port ?? defaults.gatewayPort
    const bind = parsed.gateway?.bind ?? 'loopback'
    const bindHost = bind === 'loopback' ? '127.0.0.1' : bind
    const workspace = parsed.agents?.defaults?.workspace ?? workspacePath
    const browserPort = gatewayPort + 2

    return {
      configPath,
      workspacePath: workspace,
      logsPath,
      gatewayPort,
      browserPort,
      bindHost,
      gatewayMode: parsed.gateway?.mode ?? defaults.gatewayMode,
      gatewayCanvasUrl: `http://${bindHost}:${gatewayPort}/__openclaw__/canvas/`,
      controlUrl: `http://${bindHost}:${browserPort}/`,
    }
  } catch {
    return defaults
  }
}

function getOpenClawGatewaySettings(): OpenClawGatewaySettings {
  const info = getOpenClawServiceInfo()

  if (!fs.existsSync(info.configPath)) {
    return info
  }

  try {
    const raw = fs.readFileSync(info.configPath, 'utf8')
    const parsed = JSON.parse(raw) as {
      gateway?: {
        auth?: {
          token?: string
          password?: string
        }
      }
    }

    return {
      ...info,
      token: typeof parsed.gateway?.auth?.token === 'string' ? parsed.gateway.auth.token.trim() : undefined,
      password: typeof parsed.gateway?.auth?.password === 'string' ? parsed.gateway.auth.password.trim() : undefined,
    }
  } catch {
    return info
  }
}

function loadOpenClawContext(): {
  workspacePath: string
  files: Array<{ name: string; path: string; content: string }>
} {
  const info = getOpenClawServiceInfo()
  const workspacePath = info.workspacePath
  const contextFiles = ['AGENTS.md', 'SOUL.md', 'MEMORY.md', 'HEARTBEAT.md']
  const files = contextFiles.flatMap((fileName) => {
    const filePath = path.join(workspacePath, fileName)
    if (!fs.existsSync(filePath)) return []
    const content = fs.readFileSync(filePath, 'utf8').slice(0, 4000)
    return [{ name: fileName, path: filePath, content }]
  })
  return { workspacePath, files }
}

function extractOpenClawMessageText(message: unknown): string {
  if (!message || typeof message !== 'object') return ''
  const record = message as { content?: unknown }
  if (typeof record.content === 'string') return record.content
  if (!Array.isArray(record.content)) return ''

  return record.content
    .map((part) => {
      if (!part || typeof part !== 'object') return ''
      const block = part as { type?: string; text?: string }
      return block.type === 'text' && typeof block.text === 'string' ? block.text : ''
    })
    .filter(Boolean)
    .join('\n')
}

function extractJsonObject(text: string): string | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced?.[1]) return fenced[1].trim()

  const firstBrace = text.indexOf('{')
  const lastBrace = text.lastIndexOf('}')
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) return null
  return text.slice(firstBrace, lastBrace + 1).trim()
}

function compareOpenClawSemverDesc(a: string, b: string): number {
  const normalize = (value: string) => value.replace(/^v/, '').split('.').map((part) => Number(part) || 0)
  const aParts = normalize(a)
  const bParts = normalize(b)
  const max = Math.max(aParts.length, bParts.length)
  for (let index = 0; index < max; index += 1) {
    const delta = (bParts[index] ?? 0) - (aParts[index] ?? 0)
    if (delta !== 0) return delta
  }
  return 0
}

function findOpenClawRuntime(): { nodePath: string; openClawPath: string; version: string } {
  const nvmBase = path.join(os.homedir(), '.nvm', 'versions', 'node')
  if (!fs.existsSync(nvmBase)) {
    throw new Error(`OpenClaw runtime not found under ${nvmBase}`)
  }

  const versions = fs.readdirSync(nvmBase).sort(compareOpenClawSemverDesc)
  for (const version of versions) {
    const base = path.join(nvmBase, version)
    const nodePath = path.join(base, 'bin', 'node')
    const openClawPath = path.join(base, 'lib', 'node_modules', 'openclaw', 'openclaw.mjs')
    if (fs.existsSync(nodePath) && fs.existsSync(openClawPath)) {
      return { nodePath, openClawPath, version }
    }
  }

  throw new Error('Unable to locate an OpenClaw runtime under ~/.nvm/versions/node')
}

function runOpenClawGatewayCall(method: string, params: unknown, timeoutMs = 300000): Promise<unknown> {
  const runtime = findOpenClawRuntime()
  return new Promise((resolve, reject) => {
    const child = spawn(runtime.nodePath, [
      runtime.openClawPath,
      'gateway',
      'call',
      method,
      '--json',
      '--timeout',
      String(timeoutMs),
      '--params',
      JSON.stringify(params ?? {}),
    ], {
      env: {
        ...process.env,
        HOME: process.env.HOME ?? os.homedir(),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk)
    })

    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })

    child.on('error', (error) => {
      reject(error)
    })

    child.on('close', (code) => {
      if (code !== 0) {
        const detail = [stderr.trim(), stdout.trim()].filter(Boolean).join('\n')
        reject(new Error(detail || `openclaw gateway call ${method} exited with status ${code ?? 'unknown'}`))
        return
      }

      try {
        resolve(JSON.parse(stdout))
      } catch (error) {
        reject(error)
      }
    })
  })
}

async function analyzeWithOpenClaw(request: OpenClawAnalysisRequest): Promise<{
  sessionKey: string
  runId: string
  raw: string
  analysis: OpenClawAnalysisPayload
}> {
  const settings = getOpenClawGatewaySettings()
  if (!settings.token && !settings.password) {
    throw new Error('OpenClaw gateway auth is not configured')
  }

  const sessionKey = `arcos-gateway:${request.conversationId}`
  const installedFabricPatterns = listFabricPatternsForAnalysis()
  const message = [
    'You are the OpenClaw gateway stage for ARCOS.',
    'Analyze the request for orchestration only. Do not answer the user directly.',
    'Return strict JSON with these keys only:',
    '{',
    '  "summary": string,',
    '  "intent": string,',
    '  "workflow": string,',
    '  "recommended_tier": "ollama" | "haiku" | "arc-sonnet" | "arc-opus" | null,',
    '  "recommended_model": string | null,',
    '  "should_use_fabric": boolean,',
    '  "fabric_pattern": string | null,',
    '  "fabric_intent": string | null,',
    '  "confidence": number | null,',
    '  "reasoning": string,',
    '  "notes": string[]',
    '}',
    '',
    'Fabric selection rules:',
    '- Set "fabric_pattern" only to an exact value from the Installed Fabric Patterns list below.',
    '- If Fabric would help but no exact installed pattern fits, set "fabric_pattern" to null and set "fabric_intent" to a short conceptual skill name.',
    '- If Fabric should not be used, set both "fabric_pattern" and "fabric_intent" to null.',
    '',
    '## User Prompt',
    request.prompt,
    '',
    '## Recent Conversation Context',
    request.conversationSection,
    '',
    '## Memory Context',
    request.memorySection,
    '',
    '## Plugin Context',
    request.pluginSummary,
    '',
    '## Installed Fabric Patterns',
    installedFabricPatterns.length > 0 ? installedFabricPatterns.join('\n') : 'No installed Fabric patterns were detected.',
  ].join('\n')

  const send = await runOpenClawGatewayCall('chat.send', {
      sessionKey,
      message,
      deliver: false,
      idempotencyKey: crypto.randomUUID(),
      timeoutMs: 300000,
    }) as { runId?: string; status?: string }

  const runId = typeof send?.runId === 'string' ? send.runId : ''
  if (!runId) {
    throw new Error('OpenClaw did not return a runId for chat.send')
  }

  const wait = await runOpenClawGatewayCall('agent.wait', {
      runId,
      timeoutMs: 300000,
    }) as { status?: string; error?: string }

  if (wait?.status === 'error') {
    throw new Error(wait.error ?? 'OpenClaw run failed')
  }
  if (wait?.status === 'timeout') {
    throw new Error('OpenClaw run timed out')
  }

  const history = await runOpenClawGatewayCall('chat.history', {
      sessionKey,
      limit: 12,
      maxChars: 24000,
    }) as { messages?: unknown[] }

  const messages = Array.isArray(history?.messages) ? history.messages : []
  const lastAssistant = [...messages]
    .reverse()
    .find((entry) => (entry && typeof entry === 'object' && (entry as { role?: string }).role === 'assistant'))
  const raw = extractOpenClawMessageText(lastAssistant)
  const jsonText = extractJsonObject(raw)
  if (!jsonText) {
    throw new Error('OpenClaw returned no parseable JSON analysis')
  }

  return {
    sessionKey,
    runId,
    raw,
    analysis: JSON.parse(jsonText) as OpenClawAnalysisPayload,
  }
}

async function isHttpEndpointReachable(url: string, timeoutMs = 1200): Promise<boolean> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    return response.status > 0
  } catch {
    return false
  }
}

function runGit(repoPath: string, args: string[]): string {
  return execSync(`git -C ${JSON.stringify(repoPath)} ${args.map((arg) => JSON.stringify(arg)).join(' ')}`, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function tryGit(repoPath: string, args: string[]): string | null {
  try {
    return runGit(repoPath, args)
  } catch {
    return null
  }
}

function resolveGitRepo(candidatePath: string): string | null {
  const resolved = path.resolve(candidatePath)
  const repoRoot = tryGit(resolved, ['rev-parse', '--show-toplevel'])
  return repoRoot ? path.resolve(repoRoot) : null
}

function resolveActiveRepositoryPath(): string | null {
  const candidates = [
    app.getAppPath(),
    path.resolve(app.getAppPath(), '..'),
    path.resolve(__dirname, '..', '..'),
    process.cwd(),
  ]
  for (const candidate of candidates) {
    const repo = resolveGitRepo(candidate)
    if (repo) return repo
  }
  return null
}

function collectVerificationCommands(repoPath: string): string[] {
  const commands: string[] = []
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoPath, 'package.json'), 'utf8')) as { scripts?: Record<string, string> }
    if (pkg.scripts?.lint) commands.push('npm run lint')
    commands.push('npm exec tsc -- --noEmit')
    if (pkg.scripts?.['build:dir']) commands.push('npm run build:dir')
  } catch {
    // ignore
  }

  const memoryServiceTests = path.join(repoPath, 'memory-service', 'tests')
  if (fs.existsSync(memoryServiceTests)) {
    commands.push('uv run python -m unittest discover -s tests')
  }
  return [...new Set(commands)]
}

function getWorktreeCount(repoPath: string): number {
  const output = tryGit(repoPath, ['worktree', 'list', '--porcelain'])
  if (!output) return 0
  return output.split('\n').filter((line) => line.startsWith('worktree ')).length
}

function getCodingRuntimeStatus(): CodingRuntimeStatus {
  const openClawInfo = getOpenClawServiceInfo()
  const repoPath = resolveActiveRepositoryPath()

  if (!repoPath) {
    return {
      linkedWorkspacePath: openClawInfo.workspacePath,
      activeRepositoryPath: null,
      branch: null,
      headShortSha: null,
      upstream: null,
      aheadCount: 0,
      behindCount: 0,
      worktreeCount: 0,
      stagedChanges: 0,
      unstagedChanges: 0,
      untrackedFiles: 0,
      conflictCount: 0,
      dirty: false,
      staleBranch: false,
      mergeReadiness: 'unknown',
      verificationCommands: [],
      openClawControlUrl: openClawInfo.controlUrl,
      environment: isDev ? 'development' : 'packaged',
    }
  }

  const statusLines = (tryGit(repoPath, ['status', '--porcelain=v1']) ?? '')
    .split('\n')
    .filter(Boolean)
  const branch = tryGit(repoPath, ['branch', '--show-current']) || null
  const headShortSha = tryGit(repoPath, ['rev-parse', '--short', 'HEAD']) || null
  const upstream = tryGit(repoPath, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']) || null

  let aheadCount = 0
  let behindCount = 0
  if (upstream) {
    const counts = tryGit(repoPath, ['rev-list', '--left-right', '--count', '@{upstream}...HEAD'])
    if (counts) {
      const [behindRaw, aheadRaw] = counts.split('\t')
      behindCount = Number.parseInt(behindRaw ?? '0', 10) || 0
      aheadCount = Number.parseInt(aheadRaw ?? '0', 10) || 0
    }
  }

  const stagedChanges = statusLines.filter((line) => line[0] !== ' ' && line[0] !== '?').length
  const unstagedChanges = statusLines.filter((line) => line[1] !== ' ' && line[0] !== '?').length
  const untrackedFiles = statusLines.filter((line) => line.startsWith('??')).length
  const conflictStates = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'])
  const conflictCount = statusLines.filter((line) => conflictStates.has(line.slice(0, 2))).length
  const dirty = statusLines.length > 0
  const staleBranch = branch === null || behindCount > 0 || conflictCount > 0

  let mergeReadiness: CodingRuntimeStatus['mergeReadiness'] = 'ready'
  if (conflictCount > 0) mergeReadiness = 'conflicted'
  else if (behindCount > 0) mergeReadiness = 'needs_sync'
  else if (dirty) mergeReadiness = 'pending_local_changes'

  return {
    linkedWorkspacePath: openClawInfo.workspacePath,
    activeRepositoryPath: repoPath,
    branch,
    headShortSha,
    upstream,
    aheadCount,
    behindCount,
    worktreeCount: getWorktreeCount(repoPath),
    stagedChanges,
    unstagedChanges,
    untrackedFiles,
    conflictCount,
    dirty,
    staleBranch,
    mergeReadiness,
    verificationCommands: collectVerificationCommands(repoPath),
    openClawControlUrl: openClawInfo.controlUrl,
    environment: isDev ? 'development' : 'packaged',
  }
}

// ── App Menu ──────────────────────────────────────────────────────

let tray: Tray | null = null

function buildAppMenu(win: BrowserWindow): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'File',
      submenu: [
        {
          label: 'New Chat',
          accelerator: 'CmdOrCtrl+K',
          click: () => win.webContents.send('menu:new-chat'),
        },
        { type: 'separator' },
        {
          label: 'Export Conversation…',
          accelerator: 'CmdOrCtrl+Shift+E',
          click: () => win.webContents.send('menu:export-conversation'),
        },
        { type: 'separator' },
        { role: 'close' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Settings',
          accelerator: 'CmdOrCtrl+,',
          click: () => win.webContents.send('menu:open-settings'),
        },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(isDev
          ? [{ type: 'separator' as const }, { role: 'toggleDevTools' as const }]
          : []),
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Session History',
          accelerator: 'CmdOrCtrl+Shift+H',
          click: () => win.webContents.send('menu:open-history'),
        },
        { type: 'separator' },
        {
          label: 'Error Log',
          accelerator: 'CmdOrCtrl+Shift+L',
          click: () => win.webContents.send('menu:open-log'),
        },
        {
          label: 'Open Log File',
          click: () => shell.openPath(getLogFilePath()),
        },
        { type: 'separator' },
        {
          label: 'Open Plugins Folder',
          click: () => shell.openPath(path.join(os.homedir(), '.noah-ai-hub', 'plugins')),
        },
        {
          label: 'Open Data Folder',
          click: () => shell.openPath(path.join(os.homedir(), '.noah-ai-hub')),
        },
        { type: 'separator' },
        {
          label: 'Anthropic Console',
          click: () => shell.openExternal('https://console.anthropic.com'),
        },
        {
          label: 'Ollama Library',
          click: () => shell.openExternal('https://ollama.com/library'),
        },
      ],
    },
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

function buildTray(win: BrowserWindow): void {
  // Resolve icon from build resources (packaged) or project root (dev)
  const iconPath = isDev
    ? path.join(__dirname, '../../build/icon.png')
    : path.join(process.resourcesPath, 'icon.png')

  let icon: Electron.NativeImage
  try {
    icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
    if (icon.isEmpty()) throw new Error('empty')
  } catch {
    // Fallback: minimal valid 1x1 transparent PNG
    icon = nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==')
  }
  tray = new Tray(icon)
  tray.setToolTip('ARCOS')

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show ARCOS',
      click: () => { win.show(); win.focus() },
    },
    { type: 'separator' },
    {
      label: 'New Chat',
      click: () => { win.show(); win.webContents.send('menu:new-chat') },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => app.quit(),
    },
  ])

  tray.setContextMenu(contextMenu)
  tray.on('click', () => {
    if (win.isVisible()) {
      win.hide()
    } else {
      win.show()
      win.focus()
    }
  })
}

app.whenReady().then(() => {
  log.info(`ARCOS starting — version ${app.getVersion()}, packaged=${app.isPackaged}`)
  // Seed sample plugins on first run
  try {
    seedSamplePlugins()
  } catch (e) {
    log.error('Failed to seed sample plugins', String(e))
  }
  const win = createWindow()
  mainWindow = win
  win.on('closed', () => {
    if (mainWindow === win) {
      mainWindow = null
    }
  })
  buildAppMenu(win)
  buildTray(win)
  app.on('activate', () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      const w = createWindow()
      mainWindow = w
      buildAppMenu(w)
    } else {
      mainWindow.show()
      mainWindow.focus()
    }
  })
})

app.on('window-all-closed', () => {
  Object.values(serviceProcesses).forEach((p) => {
    try {
      p.kill()
    } catch {
      // Best-effort child cleanup during shutdown.
    }
  })
  closeDb()
  if (process.platform !== 'darwin') app.quit()
})

// ── IPC: System ───────────────────────────────────────────────────
ipcMain.handle('get-platform', () => process.platform)
ipcMain.handle('workspace:detach-panel', (_event, panelId: string) => {
  createDetachedPanelWindow(panelId)
  return { success: true }
})
ipcMain.handle('workspace:redock-panel', (_event, panelId: string) => {
  closeDetachedPanelWindow(panelId, true)
  return { success: true }
})
ipcMain.handle('workspace:sync-detached-panels', (_event, panelIds: string[]) => {
  const desired = new Set(panelIds)
  for (const panelId of desired) {
    createDetachedPanelWindow(panelId)
  }
  for (const [panelId] of detachedPanelWindows) {
    if (!desired.has(panelId)) {
      closeDetachedPanelWindow(panelId, true)
    }
  }
  return { success: true }
})

// ── IPC: A.R.C. Prompt Loading ────────────────────────────────────
ipcMain.handle('load-arc-prompts', async () => {
  const home = os.homedir()
  const candidates = [
    path.join(home, '.claude', 'Skills', 'CORE', 'SKILL.md'),
    path.join(home, 'PAI', '.claude', 'Skills', 'CORE', 'SKILL.md'),
    path.join(home, 'Documents', 'PAI', '.claude', 'Skills', 'CORE', 'SKILL.md'),
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      try { return { success: true, content: fs.readFileSync(p, 'utf8'), source: p } }
      catch (_) { continue }
    }
  }
  return { success: false, error: 'A.R.C. prompts not found' }
})

// ── IPC: Ollama model list ────────────────────────────────────────
ipcMain.handle('ollama-list-models', async () => {
  try {
    const res = await fetch('http://localhost:11434/api/tags', {
      signal: AbortSignal.timeout(3000),
    })
    if (!res.ok) return { success: false, models: [] }
    const data = await res.json() as { models?: Array<{ name: string }> }
    const models = (data.models ?? []).map((m) => m.name)
    return { success: true, models }
  } catch {
    return { success: false, models: [] }
  }
})

ipcMain.handle('ollama-list-model-details', async () => {
  try {
    const res = await fetch('http://localhost:11434/api/tags', {
      signal: AbortSignal.timeout(3000),
    })
    if (!res.ok) return { success: false, models: [] }
    const data = await res.json() as {
      models?: Array<{
        name: string
        modified_at?: string
        size?: number
        details?: {
          family?: string
          parameter_size?: string
          quantization_level?: string
        }
      }>
    }
    const models = (data.models ?? []).map((model) => ({
      name: model.name,
      sizeBytes: model.size ?? 0,
      modifiedAt: model.modified_at,
      family: model.details?.family,
      parameterSize: model.details?.parameter_size,
      quantizationLevel: model.details?.quantization_level,
    }))
    return { success: true, models }
  } catch {
    return { success: false, models: [] }
  }
})

// ── IPC: Ollama streaming (avoids renderer CORS) ──────────────────
ipcMain.handle('ollama-stream-start', async (event, params: {
  streamId: string
  model: string
  messages: Array<{ role: string; content: string }>
}) => {
  const { streamId, model, messages } = params
  const controller = new AbortController()
  activeStreams.set(streamId, controller)

  const emit = (data: object) => {
    if (!event.sender.isDestroyed()) {
      event.sender.send(`stream-${streamId}`, data)
    }
  }

  try {
    const res = await fetch('http://localhost:11434/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, stream: true }),
      signal: controller.signal,
    })

    if (!res.ok) {
      const txt = await res.text()
      const msg = `Ollama error ${res.status}: ${txt}`
      log.error('Ollama stream error', msg)
      emit({ type: 'error', error: msg })
      return
    }

    if (!res.body) {
      log.error('Ollama stream: response body is null')
      emit({ type: 'error', error: 'Ollama returned empty response body' })
      return
    }
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let fullText = ''

    let doneReading = false
    while (!doneReading) {
      const { done, value } = await reader.read()
      if (done) {
        doneReading = true
        break
      }
      const chunk = decoder.decode(value, { stream: true })
      for (const line of chunk.split('\n').filter(Boolean)) {
        try {
          const data = JSON.parse(line) as { message?: { content?: string }; done?: boolean; eval_count?: number }
          if (data.message?.content) {
            fullText += data.message.content
            emit({ type: 'token', token: data.message.content })
          }
          if (data.done) {
            emit({ type: 'done', fullText, evalTokens: data.eval_count })
            return
          }
        } catch {
          // Ignore malformed incremental stream lines.
        }
      }
    }
    emit({ type: 'done', fullText })
  } catch (e) {
    if ((e as Error).name !== 'AbortError') {
      emit({ type: 'error', error: String(e) })
    }
  } finally {
    activeStreams.delete(streamId)
  }
})

// ── IPC: Claude streaming (main process = no CORS) ────────────────
ipcMain.handle('claude-stream-start', async (event, params: {
  streamId: string
  model: string
  systemPrompt: string
  messages: Array<{ role: string; content: string }>
}) => {
  // API key is read here in main — it never transits back to the renderer
  const apiKey = getApiKeyFromDb()
  const { streamId, model, systemPrompt, messages } = params
  const controller = new AbortController()
  activeStreams.set(streamId, controller)

  const emit = (data: object) => {
    if (!event.sender.isDestroyed()) {
      event.sender.send(`stream-${streamId}`, data)
    }
  }

  if (!apiKey) {
    emit({ type: 'error', error: 'Claude API key not set. Go to Settings → API Keys to add it.' })
    activeStreams.delete(streamId)
    return
  }

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'anthropic-beta': 'prompt-caching-2024-07-31',
      },
      body: JSON.stringify({
        model,
        max_tokens: 8096,
        system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
        messages,
        stream: true,
      }),
      signal: controller.signal,
    })

    if (!res.ok) {
      let errMsg = `Claude API error ${res.status}`
      try {
        const e = await res.json() as { error?: { message?: string } }
        errMsg = e.error?.message ?? errMsg
      } catch {
        // Fallback to status-based error message.
      }
      log.error('Claude API error', `model=${model} status=${res.status} ${errMsg}`)
      emit({ type: 'error', error: errMsg })
      return
    }

    if (!res.body) {
      log.error('Claude stream: response body is null')
      emit({ type: 'error', error: 'Claude returned empty response body' })
      return
    }
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let fullText = ''
    const usage = { inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0 }

    let doneReading = false
    while (!doneReading) {
      const { done, value } = await reader.read()
      if (done) {
        doneReading = true
        break
      }
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const raw = line.slice(6).trim()
        if (raw === '[DONE]') continue
        try {
          const evt = JSON.parse(raw) as {
            type: string
            delta?: { type?: string; text?: string }
            message?: { usage?: { input_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } }
            usage?: { output_tokens?: number }
          }

          if (evt.type === 'message_start' && evt.message?.usage) {
            usage.inputTokens = evt.message.usage.input_tokens ?? 0
            usage.cacheRead = evt.message.usage.cache_read_input_tokens ?? 0
            usage.cacheWrite = evt.message.usage.cache_creation_input_tokens ?? 0
          }
          if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
            const token = evt.delta.text ?? ''
            fullText += token
            emit({ type: 'token', token })
          }
          if (evt.type === 'message_delta' && evt.usage) {
            usage.outputTokens = evt.usage.output_tokens ?? 0
          }
          if (evt.type === 'message_stop') {
            emit({ type: 'done', fullText, usage })
            return
          }
        } catch {
          // Ignore malformed SSE frames and continue streaming.
        }
      }
    }
    emit({ type: 'done', fullText, usage })
  } catch (e) {
    if ((e as Error).name !== 'AbortError') {
      emit({ type: 'error', error: String(e) })
    }
  } finally {
    activeStreams.delete(streamId)
  }
})

// ── IPC: Abort a stream ───────────────────────────────────────────
ipcMain.handle('stream-abort', (_event, streamId: string) => {
  activeStreams.get(streamId)?.abort()
  activeStreams.delete(streamId)
})

// ── IPC: Service Management ───────────────────────────────────────
ipcMain.handle('service-status', async (_event, name: string) => {
  try {
    if (name === 'ollama') {
      const r = execSync('pgrep -x ollama 2>/dev/null', { encoding: 'utf8' }).trim()
      return { running: r.length > 0, pid: parseInt(r) || undefined }
    }
    if (name === 'fabric') {
      try {
        const r = await fetch('http://localhost:8080/api/patterns', { signal: AbortSignal.timeout(1500) })
        return { running: r.ok || r.status < 500 }
      } catch { return { running: false } }
    }
    if (name === 'arc-memory') {
      try {
        const r = await fetch('http://localhost:8082/status', { signal: AbortSignal.timeout(1500) })
        return { running: r.ok }
      } catch { return { running: false } }
    }
    if (name === 'openclaw') {
      const info = getOpenClawServiceInfo()
      const [gatewayReachable, controlReachable] = await Promise.all([
        isHttpEndpointReachable(info.gatewayCanvasUrl),
        isHttpEndpointReachable(info.controlUrl),
      ])
      return {
        running: gatewayReachable || controlReachable,
        port: info.gatewayPort,
        displayName: 'OpenClaw',
        manageable: false,
        managementNote: 'Managed from the existing .openclaw runtime',
        detailLines: [
          `Gateway mode: ${info.gatewayMode}`,
          `Gateway: ws://${info.bindHost}:${info.gatewayPort}`,
          `Control UI: ${info.controlUrl}`,
        ],
        links: [
          { label: 'Open Control UI', target: info.controlUrl, kind: 'url' },
          { label: 'Open Workspace', target: info.workspacePath, kind: 'path' },
          { label: 'Open Logs', target: info.logsPath, kind: 'path' },
          { label: 'Open Config', target: info.configPath, kind: 'path' },
        ],
      }
    }
  } catch { return { running: false } }
  return { running: false }
})

ipcMain.handle('service-start', (_event, name: string) => {
  try {
    if (name === 'ollama') {
      const p = spawn('ollama', ['serve'], { detached: true, stdio: 'ignore' })
      p.unref(); serviceProcesses[name] = p
      return { success: true }
    }
    if (name === 'fabric') {
      const p = spawn('fabric', ['--serve'], { detached: true, stdio: 'ignore' })
      p.unref(); serviceProcesses[name] = p
      return { success: true }
    }
    if (name === 'arc-memory') {
      // Resolve memory-service dir relative to app resources
      const memDir = app.isPackaged
        ? path.join(process.resourcesPath, 'memory-service')
        : path.join(app.getAppPath(), 'memory-service')

      if (!fs.existsSync(memDir)) {
        const error = `ARC-Memory resources not found at ${memDir}`
        log.error('ARC-Memory start failed', error)
        return { success: false, error }
      }

      const p = spawn('uv', ['run', 'arc-serve'], {
        cwd: memDir,
        detached: true,
        stdio: 'ignore',
      })
      p.unref(); serviceProcesses[name] = p
      return { success: true }
    }
    if (name === 'openclaw') {
      return { success: false, error: 'OpenClaw is linked from ~/.openclaw and is not started by ARCOS yet.' }
    }
  } catch (e) { return { success: false, error: String(e) } }
  return { success: false, error: 'Unknown service' }
})

ipcMain.handle('service-stop', (_event, name: string) => {
  try {
    if (serviceProcesses[name]) { serviceProcesses[name].kill(); delete serviceProcesses[name] }
    if (name === 'ollama') {
      try { execSync('pkill -x ollama') } catch {
        // Best-effort process cleanup only.
      }
    }
    if (name === 'fabric') {
      try { execSync('pkill -f "fabric --serve"') } catch {
        // Best-effort process cleanup only.
      }
    }
    if (name === 'arc-memory') {
      try { execSync('pkill -f "mcp_server.server"') } catch {
        // Best-effort process cleanup only.
      }
    }
    if (name === 'openclaw') {
      return { success: false, error: 'OpenClaw is managed outside ARCOS right now.' }
    }
    return { success: true }
  } catch (e) { return { success: false, error: String(e) } }
})

ipcMain.handle('open-external', (_event, url: string) => { shell.openExternal(url) })
ipcMain.handle('openclaw-context', () => {
  try {
    return { success: true, ...loadOpenClawContext() }
  } catch (e) {
    return { success: false, error: String(e) }
  }
})
ipcMain.handle('openclaw:analyze', async (_event, request: OpenClawAnalysisRequest) => {
  try {
    const result = await analyzeWithOpenClaw(request)
    return { success: true, ...result }
  } catch (e) {
    return { success: false, error: String(e) }
  }
})
ipcMain.handle('chain:capture-save', (_event, artifact: ChainArtifact) => {
  try {
    const filePath = writeChainArtifact(artifact)
    return { success: true, filePath }
  } catch (e) {
    return { success: false, error: String(e) }
  }
})
ipcMain.handle('open-path', (_event, targetPath: string) => {
  try {
    const error = shell.openPath(targetPath)
    return Promise.resolve(error).then((result) => ({
      success: result.length === 0,
      error: result || undefined,
    }))
  } catch (e) {
    return { success: false, error: String(e) }
  }
})
ipcMain.handle('coding-runtime:status', () => {
  try {
    return { success: true, status: getCodingRuntimeStatus() }
  } catch (e) {
    return { success: false, error: String(e) }
  }
})

// ── IPC: SQLite Database ──────────────────────────────────────────

ipcMain.handle('db:conversations:list', () => {
  try { return { success: true, data: listConversations() } }
  catch (e) { return { success: false, error: String(e) } }
})
ipcMain.handle('db:conversations:save', (_event, conv: DbConversation) => {
  try { upsertConversation(conv); return { success: true } }
  catch (e) { return { success: false, error: String(e) } }
})
ipcMain.handle('db:conversations:delete', (_event, id: string) => {
  try { deleteConversation(id); return { success: true } }
  catch (e) { return { success: false, error: String(e) } }
})
ipcMain.handle('db:messages:list', (_event, conversationId: string) => {
  try { return { success: true, data: listMessages(conversationId) } }
  catch (e) { return { success: false, error: String(e) } }
})
ipcMain.handle('db:messages:save', (_event, msg: DbMessage) => {
  try { upsertMessage(msg); return { success: true } }
  catch (e) { return { success: false, error: String(e) } }
})
ipcMain.handle('db:spending:list', () => {
  try { return { success: true, data: listSpending() } }
  catch (e) { return { success: false, error: String(e) } }
})
ipcMain.handle('db:spending:add', (_event, record: DbSpendingRecord) => {
  try { insertSpending(record); return { success: true } }
  catch (e) { return { success: false, error: String(e) } }
})
ipcMain.handle('db:spending:clear', () => {
  try { clearSpending(); return { success: true } }
  catch (e) { return { success: false, error: String(e) } }
})
ipcMain.handle('db:settings:get', (_event, key: string) => {
  try { return { success: true, value: getSetting(key) } }
  catch (e) { return { success: false, error: String(e) } }
})
ipcMain.handle('db:settings:set', (_event, key: string, value: string) => {
  try { setSetting(key, value); return { success: true } }
  catch (e) { return { success: false, error: String(e) } }
})

// ── IPC: Save conversation as Markdown ───────────────────────────
ipcMain.handle('save-conversation-md', async (_event, params: {
  title: string
  content: string
}) => {
  const { title, content } = params
  const safeName = title.replace(/[^a-z0-9\s-]/gi, '').trim().replace(/\s+/g, '-').toLowerCase()
  const defaultPath = `${safeName || 'conversation'}.md`

  const result = await dialog.showSaveDialog({
    defaultPath,
    filters: [{ name: 'Markdown', extensions: ['md'] }],
    properties: ['createDirectory'],
  })

  if (result.canceled || !result.filePath) return { success: false }

  try {
    fs.writeFileSync(result.filePath, content, 'utf8')
    return { success: true, filePath: result.filePath }
  } catch (e) {
    return { success: false, error: String(e) }
  }
})

ipcMain.handle('layout:export', async (_event, params: LayoutTransferPayload) => {
  const safeName = params.label.replace(/[^a-z0-9\s-]/gi, '').trim().replace(/\s+/g, '-').toLowerCase()
  const defaultPath = `${safeName || 'arcos-layout'}.arcos-layout.json`

  const result = await dialog.showSaveDialog({
    defaultPath,
    filters: [{ name: 'ARCOS Layout', extensions: ['json'] }],
    properties: ['createDirectory'],
  })

  if (result.canceled || !result.filePath) return { success: false }

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

// ── IPC: Ollama model management ─────────────────────────────────

/** Pull (download) a model — streams progress events back to renderer */
ipcMain.handle('ollama-pull-model', async (event, params: {
  streamId: string
  modelName: string
}) => {
  const { streamId, modelName } = params
  const controller = new AbortController()
  activeStreams.set(streamId, controller)

  const emit = (data: object) => {
    if (!event.sender.isDestroyed()) event.sender.send(`stream-${streamId}`, data)
  }

  try {
    const res = await fetch('http://localhost:11434/api/pull', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: modelName, stream: true }),
      signal: controller.signal,
    })

    if (!res.ok) {
      const txt = await res.text()
      emit({ type: 'error', error: `Ollama pull error ${res.status}: ${txt}` })
      return
    }

    const reader = res.body!.getReader()
    const decoder = new TextDecoder()

    let doneReading = false
    while (!doneReading) {
      const { done, value } = await reader.read()
      if (done) {
        doneReading = true
        break
      }
      const chunk = decoder.decode(value, { stream: true })
      for (const line of chunk.split('\n').filter(Boolean)) {
        try {
          const data = JSON.parse(line) as {
            status?: string
            digest?: string
            total?: number
            completed?: number
          }
          if (data.status === 'success') {
            emit({ type: 'done' })
            return
          }
          emit({
            type: 'progress',
            status: data.status ?? '',
            total: data.total,
            completed: data.completed,
          })
        } catch {
          // Ignore malformed model-pull progress lines.
        }
      }
    }
    emit({ type: 'done' })
  } catch (e) {
    if ((e as Error).name !== 'AbortError') {
      emit({ type: 'error', error: String(e) })
    }
  } finally {
    activeStreams.delete(streamId)
  }
})

/** Delete an installed Ollama model */
ipcMain.handle('ollama-delete-model', async (_event, modelName: string) => {
  try {
    const res = await fetch('http://localhost:11434/api/delete', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: modelName }),
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) {
      const txt = await res.text()
      return { success: false, error: `${res.status}: ${txt}` }
    }
    return { success: true }
  } catch (e) {
    return { success: false, error: String(e) }
  }
})

// ── IPC: Fabric pattern list ──────────────────────────────────────
ipcMain.handle('fabric-list-patterns', async () => {
  try {
    const res = await fetch('http://localhost:8080/api/patterns', {
      signal: AbortSignal.timeout(4000),
    })
    if (res.ok) {
      const data = await res.json() as unknown
      let patterns: string[] = []
      if (Array.isArray(data)) {
        patterns = data as string[]
      } else if (data && typeof data === 'object') {
        const obj = data as Record<string, unknown>
        if (Array.isArray(obj.patterns)) patterns = obj.patterns as string[]
        else if (Array.isArray(obj.data)) patterns = obj.data as string[]
      }
      return { success: true, patterns: patterns.sort() }
    }
  } catch {
    // Fall through to CLI fallback.
  }

  try {
    return { success: true, patterns: listFabricPatternsCli() }
  } catch (error) {
    log.error('Fabric pattern list error', String(error))
    return { success: false, patterns: [] }
  }
})

// ── IPC: Fabric run pattern (streaming) ──────────────────────────
ipcMain.handle('fabric-run-pattern', async (event, params: {
  streamId: string
  pattern: string
  input: string
  model?: string
}) => {
  const { streamId, pattern, input, model } = params
  const controller = new AbortController()
  activeStreams.set(streamId, controller)

  const emit = (data: object) => {
    if (!event.sender.isDestroyed()) {
      event.sender.send(`stream-${streamId}`, data)
    }
  }

  const runViaCli = async () => {
    emit({ type: 'meta', mode: 'cli', stage: 'Fabric' })
    let fullText = ''
    let errText = ''
    const args = model
      ? ['-m', model, '--pattern', pattern, '--stream']
      : ['--pattern', pattern, '--stream']
    const child = spawn('fabric', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        OLLAMA_HTTP_TIMEOUT: process.env.OLLAMA_HTTP_TIMEOUT ?? '300s',
      },
    })

    controller.signal.addEventListener('abort', () => {
      try { child.kill() } catch {
        // Best-effort process cleanup only.
      }
    })

    child.stdin.write(input)
    child.stdin.end()

    child.stdout.on('data', (chunk: Buffer | string) => {
      const token = chunk.toString()
      if (!token) return
      fullText += token
      emit({ type: 'token', token })
    })

    child.stderr.on('data', (chunk: Buffer | string) => {
      errText += chunk.toString()
    })

    await new Promise<void>((resolve, reject) => {
      child.on('error', reject)
      child.on('close', (code) => {
        if (controller.signal.aborted) {
          resolve()
          return
        }
        if (code === 0) {
          emit({ type: 'done', fullText })
          resolve()
          return
        }
        reject(new Error(errText.trim() || `Fabric exited with code ${code ?? 'unknown'}`))
      })
    })
  }

  const runViaServer = async () => {
    const candidates = buildFabricPatternUrlCandidates(pattern).map((candidate) => ({
      ...candidate,
      body: candidate.contentType === 'application/json' ? JSON.stringify({ pattern, input }) : input,
    }))

    for (const candidate of candidates) {
      try {
        const res = await fetch(candidate.url, {
          method: 'POST',
          headers: { 'Content-Type': candidate.contentType },
          body: candidate.body,
          signal: controller.signal,
        })

        if (!res.ok) {
          if (res.status === 404) {
            continue
          }

          let errText = `Fabric error ${res.status}`
          try {
            errText = await res.text()
          } catch {
            // Keep status-derived error text.
          }
          throw new Error(errText)
        }

        emit({ type: 'meta', mode: 'server', stage: 'Fabric' })
        const contentType = res.headers.get('content-type') ?? ''

        if (contentType.includes('text/event-stream') || contentType.includes('stream')) {
          if (!res.body) {
            throw new Error('Fabric returned empty response body')
          }
          const reader = res.body.getReader()
          const decoder = new TextDecoder()
          let buffer = ''
          let fullText = ''

          let doneReading = false
          while (!doneReading) {
            const { done, value } = await reader.read()
            if (done) {
              doneReading = true
              break
            }
            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split('\n')
            buffer = lines.pop() ?? ''

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const raw = line.slice(6).trim()
                if (raw === '[DONE]') {
                  emit({ type: 'done', fullText })
                  return
                }
                try {
                  const parsed = JSON.parse(raw) as Record<string, unknown>
                  const choices = parsed.choices as Array<{ delta?: { content?: string } }> | undefined
                  const token = choices?.[0]?.delta?.content
                    ?? (parsed.text as string | undefined)
                    ?? ''
                  if (token) {
                    fullText += token
                    emit({ type: 'token', token })
                  }
                } catch {
                  if (raw) {
                    fullText += raw + '\n'
                    emit({ type: 'token', token: raw + '\n' })
                  }
                }
              } else if (line.trim()) {
                fullText += line + '\n'
                emit({ type: 'token', token: line + '\n' })
              }
            }
          }
          emit({ type: 'done', fullText })
          return
        }

        const text = await res.text()
        emit({ type: 'token', token: text })
        emit({ type: 'done', fullText: text })
        return
      } catch (error) {
        if ((error as Error).name === 'AbortError') {
          throw error
        }
        log.warn('Fabric server execution attempt failed', `${candidate.url} :: ${String(error)}`)
      }
    }

    throw new Error('Fabric server routes unavailable')
  }

  try {
    await runViaServer()
  } catch (e) {
    if ((e as Error).name === 'AbortError') {
      return
    }
    try {
      await runViaCli()
    } catch (cliError) {
      emit({ type: 'error', error: String(cliError) })
    }
  } finally {
    activeStreams.delete(streamId)
  }
})

// ── IPC: ARC-Memory (port 8082) ───────────────────────────────────

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

// ── IPC: ARC-Memory Vault Write-Back (17.0) ───────────────────────

/** Parse key=value pairs from memory-service/.env */
function parseMemoryEnv(): Record<string, string> {
  const envPath = isDev
    ? path.join(app.getAppPath(), 'memory-service', '.env')
    : path.join(process.resourcesPath, 'memory-service', '.env')
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
  } catch { return {} }
}

/** Convert a title to a URL-safe filename slug (max 60 chars). */
function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .slice(0, 60)
}

interface VaultWriteParams {
  conversationId: string
  title: string
  createdAt: number
  updatedAt?: number
  messages: Array<{ role: string; content: string; model?: string }>
  tags: string[]
  totalCost: number
}

ipcMain.handle('memory:vault-write', (_event, params: VaultWriteParams) => {
  try {
    const env = parseMemoryEnv()
    const vaultPath = env['VAULT_PATH'] ?? ''
    if (!vaultPath) return { success: false, error: 'VAULT_PATH not configured in memory-service/.env' }

    const date = new Date(params.createdAt)
    const dateStr = date.toISOString().slice(0, 10)
    const slug = slugify(params.title) || 'conversation'
    const conversationKey = slugify(params.conversationId).slice(0, 12) || 'session'
    const filename = `${dateStr}_${slug}_${conversationKey}.md`
    const dir = path.join(vaultPath, 'arcos')
    fs.mkdirSync(dir, { recursive: true })
    const filePath = path.join(dir, filename)

    // YAML frontmatter (Obsidian-compatible)
    const escapedTitle = params.title.replace(/"/g, '\\"')
    const tagsYaml = params.tags.length > 0
      ? `\ntags: [${params.tags.map((t) => `"${t}"`).join(', ')}]`
      : ''
    const costLine = params.totalCost > 0 ? `\ncost: ${params.totalCost.toFixed(5)}` : ''
    const updatedAtLine = params.updatedAt ? `\nupdated_at: ${new Date(params.updatedAt).toISOString()}` : ''
    const messageCountLine = `\nmessage_count: ${params.messages.filter((message) => message.role !== 'system').length}`
    const header = `---\nsource: arcos\nconversation_id: ${params.conversationId}\ntitle: "${escapedTitle}"\ndate: ${dateStr}${updatedAtLine}${tagsYaml}${costLine}${messageCountLine}\n---\n\n`

    // Body: format as **User:** / **Assistant:** blocks for the chunker's speaker detection
    const bodyParts: string[] = []
    for (const m of params.messages) {
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
  const env = parseMemoryEnv()
  return { success: true, vaultPath: env['VAULT_PATH'] ?? '' }
})

// ── IPC: Plugin management ────────────────────────────────────────

ipcMain.handle('plugins:list', () => {
  try {
    return { success: true, plugins: listPlugins() }
  } catch (e) {
    return { success: false, plugins: [], error: String(e) }
  }
})

ipcMain.handle('plugins:install-file', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Install Plugin',
    filters: [{ name: 'Plugin Manifest', extensions: ['json'] }],
    properties: ['openFile'],
  })
  if (result.canceled || result.filePaths.length === 0) return { success: false }
  return installPlugin(result.filePaths[0])
})

ipcMain.handle('plugins:open-dir', () => {
  shell.openPath(getPluginsDir())
  return { success: true }
})

// ── IPC: API Key (main-process-only storage) ──────────────────────
// The raw API key NEVER flows from main → renderer.
// Renderer can write via apiKey:set and check existence via apiKey:has.
// claude-stream-start reads it directly from the DB inside main.

const CLAUDE_API_KEY_DB = 'claude-api-key'

function getApiKeyFromDb(): string {
  try { return getSetting(CLAUDE_API_KEY_DB) ?? '' }
  catch { return '' }
}

ipcMain.handle('apiKey:set', (_event, key: string) => {
  try {
    const trimmed = (key ?? '').trim()
    setSetting(CLAUDE_API_KEY_DB, trimmed)
    return { success: true }
  } catch (e) { return { success: false, error: String(e) } }
})

ipcMain.handle('apiKey:has', () => {
  return { hasKey: getApiKeyFromDb().length > 0 }
})

// ── IPC: Error / Debug Log ────────────────────────────────────────

// Renderer can push its own log entries (JS errors, unhandled rejections)
ipcMain.handle('log:append', (_event, level: string, message: string, detail?: string) => {
  const safeLevel = ['info', 'warn', 'error'].includes(level) ? level as 'info' | 'warn' | 'error' : 'error'
  appendLog(safeLevel, 'renderer', message, detail)
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

// ── IPC: Routing Log (FR-11) ──────────────────────────────────────

ipcMain.handle('routing:append', (_event, entry: RoutingEntry) => {
  try { appendRoutingEntry(entry); return { success: true } }
  catch (e) { return { success: false, error: String(e) } }
})

ipcMain.handle('routing:get-entries', (_event, dateStr?: string) => {
  try { return { success: true, entries: getRoutingEntries(dateStr) } }
  catch (e) { return { success: false, entries: [], error: String(e) } }
})

ipcMain.handle('routing:get-dates', () => {
  try { return { success: true, dates: getRoutingLogDates() } }
  catch (e) { return { success: false, dates: [], error: String(e) } }
})

// ── IPC: Session History (FR-11) ─────────────────────────────────

ipcMain.handle('session:list', (_event, limit?: number) => {
  try { return { success: true, sessions: listSessionFiles(limit) } }
  catch (e) { return { success: false, sessions: [], error: String(e) } }
})

ipcMain.handle('session:read', (_event, filePath: string) => {
  try { return { success: true, content: readSessionFile(filePath) } }
  catch (e) { return { success: false, content: '', error: String(e) } }
})

ipcMain.handle('session:write-summary', async (_event, params: {
  data: SessionSummaryData
}) => {
  const { data } = params
  const apiKey = getApiKeyFromDb()
  let topics = ''

  // Attempt to call Haiku to extract topics if API key available
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
  return { show: shouldShowWeeklyDigest(lastDigestDate) }
})

// ── IPC: Learnings / Bookmarks (FR-11) ───────────────────────────

ipcMain.handle('learnings:save', (_event, entry: LearningEntry) => {
  try { return { success: true, filePath: saveLearning(entry) } }
  catch (e) { return { success: false, error: String(e) } }
})

ipcMain.handle('learnings:list', (_event, limit?: number) => {
  try { return { success: true, files: listLearningFiles(limit ?? 50) } }
  catch (e) { return { success: false, files: [], error: String(e) } }
})

ipcMain.handle('learnings:read', (_event, filePath: string) => {
  try { return { success: true, content: readLearningFile(filePath) } }
  catch (e) { return { success: false, content: '', error: String(e) } }
})

ipcMain.handle('learnings:open-dir', () => {
  const dir = path.join(os.homedir(), '.noah-ai-hub', 'history', 'learnings')
  shell.openPath(dir)
  return { success: true }
})

// ── IPC: Spending CSV Export (FR-11) ─────────────────────────────

ipcMain.handle('spending:export-csv', (_event, params: { records: SpendingCsvRow[]; month?: string }) => {
  try {
    const filePath = exportSpendingCsv(params.records, params.month)
    shell.openPath(path.dirname(filePath))
    return { success: true, filePath }
  } catch (e) {
    return { success: false, error: String(e) }
  }
})
