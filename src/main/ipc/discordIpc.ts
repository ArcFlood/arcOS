import { BrowserWindow, type IpcMain } from 'electron'
import {
  connectDiscord,
  disconnectDiscord,
  fetchChannelHistory,
  getDiscordStatus,
  sendMessage as discordSendMessage,
  setAutoRespond,
  setMonitoredChannels,
  setProjectMapping,
  subscribeDiscordWindow,
  unsubscribeDiscordWindow,
} from '../discord/discordGateway'
import { optionalInteger, requireBoolean, requireString, requireStringArray, requireStringRecord } from './validation'

export function registerDiscordIpc(ipcMain: IpcMain): void {
  ipcMain.handle('discord:connect', async (_event, token: string) => {
    try {
      return await connectDiscord(requireString(token, 'Discord token', 10_000))
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  ipcMain.handle('discord:disconnect', () => {
    disconnectDiscord()
    return { success: true }
  })

  ipcMain.handle('discord:status', () => {
    return { success: true, status: getDiscordStatus() }
  })

  ipcMain.handle('discord:channel-history', async (_event, channelId: string, limit?: number) => {
    try {
      const messages = await fetchChannelHistory(
        requireString(channelId, 'Discord channel id', 200),
        optionalInteger(limit, 'Discord history limit', 50, 1, 200),
      )
      return { success: true, messages }
    } catch (e) {
      return { success: false, messages: [], error: String(e) }
    }
  })

  ipcMain.handle('discord:send', async (_event, channelId: string, content: string) => {
    try {
      const ok = await discordSendMessage(
        requireString(channelId, 'Discord channel id', 200),
        requireString(content, 'Discord message content', 4000),
      )
      return { success: ok }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  ipcMain.handle('discord:set-mapping', (_event, mapping: Record<string, string>) => {
    try {
      setProjectMapping(requireStringRecord(mapping, 'Discord project mapping', 200, 200))
      return { success: true }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  ipcMain.handle('discord:set-monitored', (_event, channelIds: string[]) => {
    try {
      setMonitoredChannels(requireStringArray(channelIds, 'Discord monitored channel ids', 200, 200))
      return { success: true }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  ipcMain.handle('discord:set-auto-respond', (_event, enabled: boolean) => {
    try {
      setAutoRespond(requireBoolean(enabled, 'Discord auto-respond flag'))
      return { success: true }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  ipcMain.handle('discord:subscribe', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) subscribeDiscordWindow(win)
    return { success: true }
  })

  ipcMain.handle('discord:unsubscribe', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) unsubscribeDiscordWindow(win)
    return { success: true }
  })
}
