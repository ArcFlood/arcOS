/**
 * discordGateway.ts — Discord REST API client for ARCOS.
 *
 * Uses the Discord REST API (not discord.js) to:
 *   - List guilds and channels
 *   - Fetch channel message history
 *   - Poll for new messages every POLL_INTERVAL_MS
 *   - Send replies back to channels
 *
 * Live message polling uses the `after` snowflake pattern so only
 * new messages since the last known ID are fetched.
 *
 * When a message is received, it is dispatched through a lightweight
 * chain: OpenClaw routing → local Ollama model → Discord reply.
 * Memory and Fabric are intentionally skipped for performance.
 */

import os from 'os'
import path from 'path'
import fs from 'fs'
import type { BrowserWindow } from 'electron'
import { log } from '../logger'

// ── Constants ─────────────────────────────────────────────────────

const DISCORD_API = 'https://discord.com/api/v10'
const POLL_INTERVAL_MS = 10_000
const HISTORY_LIMIT    = 50  // messages per channel on initial fetch
const POLL_LIMIT       = 5   // messages per poll tick

// ── Types ─────────────────────────────────────────────────────────

export interface DiscordMessage {
  id: string
  channelId: string
  authorId: string
  authorName: string
  content: string
  timestamp: string
  isBot: boolean
}

export interface DiscordChannel {
  id: string
  name: string
  type: number // 0 = text, 2 = voice, etc.
  guildId: string
}

export interface DiscordGuild {
  id: string
  name: string
}

export type DiscordConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error'

export interface DiscordGatewayStatus {
  state: DiscordConnectionState
  botUserId: string | null
  guilds: DiscordGuild[]
  channels: DiscordChannel[]
  projectMapping: Record<string, string>  // channelId → projectName
  monitoredChannels: string[]
  autoRespond: boolean
  error: string | null
}

export interface DiscordChannelMappingConfig {
  channelId: string
  projectName: string
}

// ── State ─────────────────────────────────────────────────────────

let botToken: string | null = null
let botUserId: string | null = null
let guilds: DiscordGuild[] = []
let channels: DiscordChannel[] = []
let projectMapping: Record<string, string> = {}
let monitoredChannels: string[] = []
let autoRespond = false
let connectionState: DiscordConnectionState = 'disconnected'
let connectionError: string | null = null
let pollTimer: ReturnType<typeof setInterval> | null = null
const lastMessageId: Record<string, string> = {}
const subscribers = new Set<BrowserWindow>()

// ── Persistence ───────────────────────────────────────────────────

const CONFIG_PATH = path.join(os.homedir(), '.noah-ai-hub', 'discord-config.json')

interface PersistedDiscordConfig {
  projectMapping: Record<string, string>
  monitoredChannels: string[]
  autoRespond: boolean
}

function loadConfig(): void {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = fs.readFileSync(CONFIG_PATH, 'utf8')
      const config = JSON.parse(raw) as PersistedDiscordConfig
      projectMapping = config.projectMapping ?? {}
      monitoredChannels = config.monitoredChannels ?? []
      autoRespond = config.autoRespond ?? false
    }
  } catch {
    // Use defaults
  }
}

function saveConfig(): void {
  try {
    const dir = path.dirname(CONFIG_PATH)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    const config: PersistedDiscordConfig = { projectMapping, monitoredChannels, autoRespond }
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8')
  } catch {
    // Best-effort save
  }
}

// ── Discord REST helpers ──────────────────────────────────────────

async function discordFetch<T>(
  endpoint: string,
  options: RequestInit = {},
): Promise<T | null> {
  if (!botToken) return null
  try {
    const res = await fetch(`${DISCORD_API}${endpoint}`, {
      ...options,
      headers: {
        Authorization: `Bot ${botToken}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
      signal: AbortSignal.timeout(8000),
    })
    if (res.status === 429) {
      const retry = await res.json() as { retry_after?: number }
      await new Promise((r) => setTimeout(r, (retry.retry_after ?? 1) * 1000))
      return discordFetch<T>(endpoint, options)
    }
    if (!res.ok) {
      const text = await res.text()
      log.warn(`[discord] API error ${res.status} on ${endpoint}: ${text.slice(0, 200)}`)
      return null
    }
    return await res.json() as T
  } catch (e) {
    log.warn(`[discord] Fetch error on ${endpoint}: ${String(e)}`)
    return null
  }
}

// ── Connection ────────────────────────────────────────────────────

export async function connectDiscord(token: string): Promise<{ success: boolean; error?: string }> {
  botToken = token
  connectionState = 'connecting'
  connectionError = null
  broadcast()

  // Verify token by fetching current user
  const me = await discordFetch<{ id: string; username: string }>('/users/@me')
  if (!me) {
    botToken = null
    connectionState = 'error'
    connectionError = 'Invalid token or Discord API unreachable.'
    broadcast()
    return { success: false, error: connectionError }
  }

  botUserId = me.id
  log.info(`[discord] Connected as bot user ${me.username} (${me.id})`)

  // Fetch guilds
  const guildList = await discordFetch<Array<{ id: string; name: string }>>('/users/@me/guilds') ?? []
  guilds = guildList.map((g) => ({ id: g.id, name: g.name }))

  // Fetch text channels for all guilds
  channels = []
  for (const guild of guilds) {
    const channelList = await discordFetch<Array<{ id: string; name: string; type: number }>>(`/guilds/${guild.id}/channels`) ?? []
    for (const ch of channelList) {
      if (ch.type === 0) { // text channels only
        channels.push({ id: ch.id, name: ch.name, type: ch.type, guildId: guild.id })
      }
    }
  }

  connectionState = 'connected'
  loadConfig()
  broadcast()
  startPolling()

  return { success: true }
}

export function disconnectDiscord(): void {
  stopPolling()
  botToken = null
  botUserId = null
  guilds = []
  channels = []
  connectionState = 'disconnected'
  connectionError = null
  broadcast()
}

// ── Message history ───────────────────────────────────────────────

export async function fetchChannelHistory(channelId: string, limit = HISTORY_LIMIT): Promise<DiscordMessage[]> {
  const messages = await discordFetch<RawDiscordMessage[]>(
    `/channels/${channelId}/messages?limit=${limit}`,
  ) ?? []
  return messages.map(parseMessage).filter((m): m is DiscordMessage => m !== null)
}

interface RawDiscordMessage {
  id: string
  channel_id: string
  author: { id: string; username: string; bot?: boolean }
  content: string
  timestamp: string
}

function parseMessage(raw: RawDiscordMessage): DiscordMessage | null {
  if (!raw?.id) return null
  return {
    id: raw.id,
    channelId: raw.channel_id,
    authorId: raw.author.id,
    authorName: raw.author.username,
    content: raw.content,
    timestamp: raw.timestamp,
    isBot: raw.author.bot ?? false,
  }
}

// ── Polling for new messages ──────────────────────────────────────

let responseHandler: ((message: DiscordMessage, channelId: string, projectName: string) => Promise<string | null>) | null = null

export function setAutoRespondHandler(
  handler: (message: DiscordMessage, channelId: string, projectName: string) => Promise<string | null>
): void {
  responseHandler = handler
}

async function pollChannel(channelId: string): Promise<DiscordMessage[]> {
  const after = lastMessageId[channelId] ?? '0'
  const url = `/channels/${channelId}/messages?limit=${POLL_LIMIT}&after=${after}`
  const messages = await discordFetch<RawDiscordMessage[]>(url) ?? []
  const parsed = messages
    .map(parseMessage)
    .filter((m): m is DiscordMessage => m !== null)
    .sort((a, b) => (a.id > b.id ? 1 : -1))  // oldest first

  if (parsed.length > 0) {
    lastMessageId[channelId] = parsed[parsed.length - 1].id
  }

  return parsed
}

async function pollAll(): Promise<void> {
  for (const channelId of monitoredChannels) {
    try {
      const messages = await pollChannel(channelId)
      for (const msg of messages) {
        // Skip own bot messages
        if (msg.isBot || msg.authorId === botUserId) continue

        const projectName = projectMapping[channelId] ?? channelId

        // Broadcast to renderer
        broadcastMessage(msg, projectName)

        // Auto-respond if enabled
        if (autoRespond && responseHandler) {
          try {
            const reply = await responseHandler(msg, channelId, projectName)
            if (reply) {
              await sendMessage(channelId, reply)
            }
          } catch (e) {
            log.error(`[discord] Auto-respond failed for channel ${channelId}`, String(e))
          }
        }
      }
    } catch (e) {
      log.warn(`[discord] Poll error for channel ${channelId}: ${String(e)}`)
    }
  }
}

function startPolling(): void {
  if (pollTimer) return
  log.info('[discord] Starting message polling')
  pollTimer = setInterval(() => { void pollAll() }, POLL_INTERVAL_MS)
}

function stopPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

// ── Send message ──────────────────────────────────────────────────

export async function sendMessage(channelId: string, content: string): Promise<boolean> {
  if (!botToken) return false
  const result = await discordFetch(`/channels/${channelId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ content: content.slice(0, 2000) }),
  })
  return result !== null
}

// ── Configuration ─────────────────────────────────────────────────

export function setProjectMapping(mapping: Record<string, string>): void {
  projectMapping = { ...mapping }
  saveConfig()
  broadcast()
}

export function setMonitoredChannels(channelIds: string[]): void {
  monitoredChannels = [...channelIds]
  saveConfig()
  broadcast()
}

export function setAutoRespond(enabled: boolean): void {
  autoRespond = enabled
  saveConfig()
  broadcast()
}

// ── Status ────────────────────────────────────────────────────────

export function getDiscordStatus(): DiscordGatewayStatus {
  return {
    state: connectionState,
    botUserId,
    guilds,
    channels,
    projectMapping,
    monitoredChannels,
    autoRespond,
    error: connectionError,
  }
}

// ── Subscription ──────────────────────────────────────────────────

export function subscribeDiscordWindow(win: BrowserWindow): void {
  subscribers.add(win)
}

export function unsubscribeDiscordWindow(win: BrowserWindow): void {
  subscribers.delete(win)
}

function broadcast(): void {
  const status = getDiscordStatus()
  for (const win of subscribers) {
    try {
      if (!win.isDestroyed()) win.webContents.send('discord:status', status)
      else subscribers.delete(win)
    } catch {
      subscribers.delete(win)
    }
  }
}

function broadcastMessage(msg: DiscordMessage, projectName: string): void {
  for (const win of subscribers) {
    try {
      if (!win.isDestroyed()) win.webContents.send('discord:message', { message: msg, projectName })
      else subscribers.delete(win)
    } catch {
      subscribers.delete(win)
    }
  }
}

// Auto-load config on module init
loadConfig()
