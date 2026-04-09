import { app, ipcMain } from 'electron'
import path from 'path'
import { closeDb } from './database/db'
import { seedSamplePlugins } from './plugins/loader'
import { log } from './logger'
import {
  subscribeWindow,
} from './hooks/hookRegistry'
import {
  startWatchdog,
  stopWatchdog,
  subscribeWatchdogWindow,
} from './watchdog/serviceWatchdog'
import {
  startAuditScheduler,
  stopAuditScheduler,
} from './audit/auditEngine'
import {
  subscribeDiscordWindow,
} from './discord/discordGateway'
import { configureDiscordAutoRespond } from './integrations/discord/autoRespond'
import { stopManagedServiceProcesses } from './services/serviceControl'
import { configureBundledAppPath } from './services/processEnvironment'
import {
  findOpenClawRuntime,
} from './integrations/openclaw/runtime'
import {
  configurePermissionPolicy,
  enforceExecutePermission,
  enforceWritePermission,
} from './permissions/policy'
import { registerApiKeyIpc } from './ipc/apiKeyIpc'
import { registerAuditIpc } from './ipc/auditIpc'
import { registerBugReportIpc } from './ipc/bugReportIpc'
import { registerDatabaseIpc } from './ipc/databaseIpc'
import { registerDiscordIpc } from './ipc/discordIpc'
import { registerFabricIpc } from './ipc/fabricIpc'
import { registerHistoryIpc } from './ipc/historyIpc'
import { registerHookIpc } from './ipc/hookIpc'
import { registerLogRoutingIpc } from './ipc/logRoutingIpc'
import { registerMcpIpc } from './ipc/mcpIpc'
import { parseMemoryEnv, registerMemoryIpc } from './ipc/memoryIpc'
import { registerModelStreamingIpc } from './ipc/modelStreamingIpc'
import { registerLayoutTransferIpc } from './ipc/layoutTransferIpc'
import { registerPluginIpc } from './ipc/pluginIpc'
import { registerRuntimeStatusIpc } from './ipc/runtimeStatusIpc'
import { registerWatchdogIpc } from './ipc/watchdogIpc'
import { registerWindowIpc } from './ipc/windowIpc'
import { getApiKeyFromDb } from './services/apiKeyStore'
import { buildAppMenu, buildTray } from './windows/appMenu'
import { WindowManager } from './windows/windowManager'

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

// app.isPackaged is the reliable Electron way to detect production.
// process.env.NODE_ENV is NOT set by electron-builder at runtime, so
// checking it in the packaged app always returns "undefined" → isDev=true,
// causing the window to try loading localhost:5173 instead of dist/index.html.
const isDev = !app.isPackaged
const activeStreams = new Map<string, AbortController>()
const windowManager = new WindowManager({ isDev, dirname: __dirname })

function getCodingRuntimePaths() {
  return {
    appPath: app.getAppPath(),
    dirname: __dirname,
    cwd: process.cwd(),
    environment: isDev ? 'development' as const : 'packaged' as const,
  }
}

function getMemoryEnvPath(): string {
  return isDev
    ? path.join(app.getAppPath(), 'memory-service', '.env')
    : path.join(process.resourcesPath, 'memory-service', '.env')
}

function getMemoryEnv(): Record<string, string> {
  return parseMemoryEnv(getMemoryEnvPath())
}

configurePermissionPolicy({
  getMainWindow: () => windowManager.getMainWindow(),
  getExtraRoots: () => {
    const env = getMemoryEnv()
    return [env['VAULT_PATH'] ?? ''].filter(Boolean)
  },
})

configureBundledAppPath()

app.whenReady().then(() => {
  log.info(`ARCOS starting — version ${app.getVersion()}, packaged=${app.isPackaged}`)
  // Seed sample plugins on first run
  try {
    seedSamplePlugins()
  } catch (e) {
    log.error('Failed to seed sample plugins', String(e))
  }
  const win = windowManager.createMainWindow()
  buildAppMenu(win, isDev)
  buildTray(win, isDev, __dirname)
  // Subscribe main window to hook event pushes
  subscribeWindow(win)
  // Subscribe main window to Discord events
  subscribeDiscordWindow(win)
  // Subscribe main window to watchdog status broadcasts
  subscribeWatchdogWindow(win)
  // Start the service watchdog
  startWatchdog()
  // Start daily audit scheduler
  startAuditScheduler()

  configureDiscordAutoRespond()
  app.on('activate', () => {
    const alreadyHadWindow = Boolean(windowManager.getMainWindow() && !windowManager.getMainWindow()?.isDestroyed())
    const w = windowManager.showOrCreateMainWindow()
    if (!alreadyHadWindow) {
      buildAppMenu(w, isDev)
    }
  })
})

app.on('window-all-closed', () => {
  stopWatchdog()
  stopAuditScheduler()
  stopManagedServiceProcesses()
  closeDb()
  if (process.platform !== 'darwin') app.quit()
})

registerWindowIpc(ipcMain, {
  getMainWindow: () => windowManager.getMainWindow(),
  continueClose: () => {
    windowManager.continueClose()
  },
  cancelClose: () => {
    windowManager.cancelClose()
  },
  detachPanel: (moduleId, panelId, title) => {
    windowManager.createDetachedPanelWindow(moduleId, panelId, title)
  },
  redockPanel: (moduleId) => {
    windowManager.closeDetachedPanelWindow(moduleId, true)
  },
  syncDetachedPanels: (modules) => {
    windowManager.syncDetachedPanels(modules)
  },
})

registerRuntimeStatusIpc(ipcMain, {
  appPath: app.getAppPath(),
  getCodingRuntimePaths,
  findOpenClawRuntime,
  enforceExecutePermission,
})

registerDatabaseIpc(ipcMain)
registerAuditIpc(ipcMain)
registerBugReportIpc(ipcMain)
registerDiscordIpc(ipcMain)
registerHistoryIpc(ipcMain, getApiKeyFromDb, enforceWritePermission)
registerHookIpc(ipcMain)
registerLogRoutingIpc(ipcMain)
registerMcpIpc(ipcMain)
registerMemoryIpc(ipcMain, getMemoryEnv, enforceExecutePermission, enforceWritePermission)
registerModelStreamingIpc(ipcMain, activeStreams, getApiKeyFromDb, enforceExecutePermission)
registerPluginIpc(ipcMain, enforceWritePermission)
registerWatchdogIpc(ipcMain)
registerLayoutTransferIpc(ipcMain, enforceWritePermission)
registerFabricIpc(ipcMain, activeStreams)

registerApiKeyIpc(ipcMain)
