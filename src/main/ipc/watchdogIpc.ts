import { BrowserWindow, type IpcMain } from 'electron'
import {
  getWatchdogStatus,
  subscribeWatchdogWindow,
  triggerSweep,
  unsubscribeWatchdogWindow,
} from '../watchdog/serviceWatchdog'

export function registerWatchdogIpc(ipcMain: IpcMain): void {
  ipcMain.handle('watchdog:status', () => {
    try {
      return { success: true, status: getWatchdogStatus() }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  ipcMain.handle('watchdog:sweep', () => {
    try {
      triggerSweep()
      return { success: true }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  ipcMain.handle('watchdog:subscribe', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) subscribeWatchdogWindow(win)
    return { success: true }
  })

  ipcMain.handle('watchdog:unsubscribe', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) unsubscribeWatchdogWindow(win)
    return { success: true }
  })
}
