import { BrowserWindow } from 'electron'
import path from 'path'
import { loadRenderer } from './rendererLoader'

type WindowManagerOptions = {
  isDev: boolean
  dirname: string
}

type DetachedPanelPayload = {
  moduleId: string
  panelId: string
  title?: string
}

export class WindowManager {
  private readonly isDev: boolean
  private readonly dirname: string
  private mainWindow: BrowserWindow | null = null
  private readonly detachedPanelWindows = new Map<string, BrowserWindow>()
  private readonly suppressedDetachedPanelNotifications = new Set<string>()
  private appCloseResolutionInProgress = false
  private appCloseResolved = false

  constructor(options: WindowManagerOptions) {
    this.isDev = options.isDev
    this.dirname = options.dirname
  }

  getMainWindow(): BrowserWindow | null {
    return this.mainWindow
  }

  createMainWindow(): BrowserWindow {
    this.appCloseResolved = false
    this.appCloseResolutionInProgress = false
    const win = new BrowserWindow({
      width: 1280,
      height: 820,
      minWidth: 900,
      minHeight: 600,
      titleBarStyle: 'hiddenInset',
      backgroundColor: '#1a1a1a',
      show: false,
      webPreferences: {
        preload: path.join(this.dirname, 'preload.js'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
      },
    })

    win.once('ready-to-show', () => win.show())
    loadRenderer(win, {
      isDev: this.isDev,
      distIndexPath: path.join(this.dirname, '../dist/index.html'),
      openDevTools: true,
    })
    win.on('close', (event) => {
      if (this.appCloseResolved) return
      event.preventDefault()
      if (this.appCloseResolutionInProgress) return
      this.appCloseResolutionInProgress = true
      win.webContents.send('app-close:request')
    })
    win.on('closed', () => {
      if (this.mainWindow === win) {
        this.mainWindow = null
      }
    })

    this.mainWindow = win
    return win
  }

  showOrCreateMainWindow(): BrowserWindow {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      return this.createMainWindow()
    }
    this.mainWindow.show()
    this.mainWindow.focus()
    return this.mainWindow
  }

  continueClose(): void {
    this.appCloseResolutionInProgress = false
    this.appCloseResolved = true
    this.mainWindow?.close()
  }

  cancelClose(): void {
    this.appCloseResolutionInProgress = false
  }

  createDetachedPanelWindow(moduleId: string, panelId: string, title?: string): BrowserWindow {
    const existing = this.detachedPanelWindows.get(moduleId)
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
        preload: path.join(this.dirname, 'preload.js'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
      },
    })

    win.setTitle(`ARCOS · ${title ?? panelId}`)
    win.once('ready-to-show', () => win.show())
    loadRenderer(win, {
      isDev: this.isDev,
      distIndexPath: path.join(this.dirname, '../dist/index.html'),
      query: { detachedPanel: panelId, detachedModule: moduleId },
    })
    this.detachedPanelWindows.set(moduleId, win)

    win.on('closed', () => {
      this.detachedPanelWindows.delete(moduleId)
      if (this.suppressedDetachedPanelNotifications.has(moduleId)) {
        this.suppressedDetachedPanelNotifications.delete(moduleId)
        return
      }
      this.notifyDetachedPanelClosed(moduleId)
    })

    return win
  }

  closeDetachedPanelWindow(moduleId: string, suppressNotification = true): void {
    const win = this.detachedPanelWindows.get(moduleId)
    if (!win || win.isDestroyed()) return
    if (suppressNotification) {
      this.suppressedDetachedPanelNotifications.add(moduleId)
    }
    win.close()
  }

  syncDetachedPanels(modules: DetachedPanelPayload[]): void {
    const desired = new Set(modules.map((module) => module.moduleId))
    for (const module of modules) {
      this.createDetachedPanelWindow(module.moduleId, module.panelId, module.title)
    }
    for (const [moduleId] of this.detachedPanelWindows) {
      if (!desired.has(moduleId)) {
        this.closeDetachedPanelWindow(moduleId, true)
      }
    }
  }

  private notifyDetachedPanelClosed(moduleId: string): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('workspace:detached-panel-closed', moduleId)
    }
  }
}
