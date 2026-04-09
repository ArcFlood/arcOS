import { BrowserWindow, type IpcMain } from 'electron'
import type { HookEvent, HookEventType } from '../../renderer/stores/hookTypes'
import {
  getHookEventsByType,
  getHookStats,
  getRecentHookEvents,
  getRegisteredHooks,
  ingestHookEvent,
  listHookLogDates,
  subscribeWindow,
  unsubscribeWindow,
} from '../hooks/hookRegistry'

export function registerHookIpc(ipcMain: IpcMain): void {
  ipcMain.handle('hook:emit', (_event, hookEvent: HookEvent) => {
    try {
      ingestHookEvent(hookEvent)
      return { success: true }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  ipcMain.handle('hook:get-recent', (_event, limit?: number) => {
    try {
      return { success: true, events: getRecentHookEvents(limit ?? 100) }
    } catch (e) {
      return { success: false, events: [], error: String(e) }
    }
  })

  ipcMain.handle('hook:get-by-type', (_event, eventType: HookEventType, limit?: number) => {
    try {
      return { success: true, events: getHookEventsByType(eventType, limit ?? 50) }
    } catch (e) {
      return { success: false, events: [], error: String(e) }
    }
  })

  ipcMain.handle('hook:get-registry', () => {
    try {
      return { success: true, hooks: getRegisteredHooks() }
    } catch (e) {
      return { success: false, hooks: [], error: String(e) }
    }
  })

  ipcMain.handle('hook:get-stats', () => {
    try {
      return { success: true, stats: getHookStats() }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  ipcMain.handle('hook:list-log-dates', () => {
    try {
      return { success: true, dates: listHookLogDates() }
    } catch (e) {
      return { success: false, dates: [], error: String(e) }
    }
  })

  ipcMain.handle('hook:subscribe', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) subscribeWindow(win)
    return { success: true }
  })

  ipcMain.handle('hook:unsubscribe', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) unsubscribeWindow(win)
    return { success: true }
  })
}
