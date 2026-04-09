import { app, Menu, nativeImage, shell, Tray, type BrowserWindow } from 'electron'
import os from 'os'
import path from 'path'
import { getLogFilePath } from '../logger'

let tray: Tray | null = null

export function buildAppMenu(win: BrowserWindow, isDev: boolean): void {
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
          label: 'Export Conversation...',
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
          label: 'Report a Bug...',
          accelerator: 'CmdOrCtrl+Shift+B',
          click: () => win.webContents.send('menu:open-bug-report'),
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

export function buildTray(win: BrowserWindow, isDev: boolean, dirname: string): void {
  const iconPath = isDev
    ? path.join(dirname, '../../build/icon.png')
    : path.join(process.resourcesPath, 'icon.png')

  let icon: Electron.NativeImage
  try {
    icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
    if (icon.isEmpty()) throw new Error('empty')
  } catch {
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
