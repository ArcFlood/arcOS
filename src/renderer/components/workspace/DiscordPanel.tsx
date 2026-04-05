/**
 * DiscordPanel.tsx — Discord server integration panel.
 *
 * Connects to Discord via bot token, displays channel history + live
 * messages, supports channel-to-project mapping, and shows auto-respond status.
 *
 * Design constraints:
 *   - Channel-based project mapping (one channel per project)
 *   - Full chain auto-respond (lightweight — skip memory/Fabric)
 *   - History + live messages
 */

import { useEffect, useState, useRef, useCallback } from 'react'

type DiscordConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error'
interface DiscordMessage {
  id: string
  channelId: string
  authorId: string
  authorName: string
  content: string
  timestamp: string
  isBot: boolean
}
interface DiscordChannel {
  id: string
  name: string
  type: number
  guildId: string
}
interface DiscordGuild {
  id: string
  name: string
}
interface DiscordGatewayStatus {
  state: DiscordConnectionState
  botUserId: string | null
  guilds: DiscordGuild[]
  channels: DiscordChannel[]
  projectMapping: Record<string, string>
  monitoredChannels: string[]
  autoRespond: boolean
  error: string | null
}

const STATE_COLORS: Record<DiscordConnectionState, string> = {
  disconnected: 'text-slate-500',
  connecting:   'text-amber-400',
  connected:    'text-emerald-400',
  error:        'text-red-400',
}

export default function DiscordPanel() {
  const [status, setStatus] = useState<DiscordGatewayStatus | null>(null)
  const [token, setToken] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [connectError, setConnectError] = useState<string | null>(null)
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null)
  const [messages, setMessages] = useState<DiscordMessage[]>([])
  const [compose, setCompose] = useState('')
  const [sending, setSending] = useState(false)
  const [tab, setTab] = useState<'messages' | 'config'>('messages')
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const loadStatus = useCallback(async () => {
    try {
      const result = await window.electron.discordStatus?.()
      if (result?.success && result.status) setStatus(result.status)
    } catch { /* not available */ }
  }, [])

  useEffect(() => {
    void loadStatus()
    void window.electron.discordSubscribe?.()

    const statusCleanup = window.electron.discordOnStatus?.((s: DiscordGatewayStatus) => setStatus(s))
    const messageCleanup = window.electron.discordOnMessage?.((data: { message: DiscordMessage; projectName: string }) => {
      setMessages((prev) => {
        const exists = prev.some((m) => m.id === data.message.id)
        if (exists) return prev
        return [...prev, data.message]
      })
    })

    return () => {
      statusCleanup?.()
      messageCleanup?.()
      void window.electron.discordUnsubscribe?.()
    }
  }, [loadStatus])

  // Auto-scroll messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  const handleConnect = async () => {
    if (!token.trim()) return
    setConnecting(true)
    setConnectError(null)
    try {
      const result = await window.electron.discordConnect?.(token.trim())
      if (!result?.success) {
        setConnectError(result?.error ?? 'Connection failed')
      } else {
        setToken('') // Don't persist token in UI state
      }
    } catch (e) {
      setConnectError(String(e))
    } finally {
      setConnecting(false)
    }
  }

  const handleLoadHistory = async (channelId: string) => {
    setActiveChannelId(channelId)
    setMessages([])
    try {
      const result = await window.electron.discordChannelHistory?.(channelId, 50)
      if (result?.success && result.messages) {
        setMessages(result.messages.sort((a, b) => a.id < b.id ? -1 : 1))
      }
    } catch { /* ignore */ }
  }

  const handleSend = async () => {
    if (!activeChannelId || !compose.trim() || sending) return
    setSending(true)
    try {
      const result = await window.electron.discordSend?.(activeChannelId, compose.trim())
      if (result?.success) setCompose('')
    } catch { /* ignore */ } finally {
      setSending(false)
    }
  }

  const isConnected = status?.state === 'connected'

  return (
    <div className="flex flex-col h-full bg-[#0f1117] text-slate-200 text-xs">

      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-700/50 shrink-0">
        <span className="font-semibold text-sm text-slate-100">Discord</span>
        {status && (
          <span className={`text-[10px] font-medium ${STATE_COLORS[status.state]}`}>
            {status.state}
          </span>
        )}
        <div className="ml-auto flex gap-1.5">
          <button
            onClick={() => setTab('messages')}
            className={`px-2 py-0.5 rounded text-[10px] transition-colors ${tab === 'messages' ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-200'}`}
          >
            Messages
          </button>
          <button
            onClick={() => setTab('config')}
            className={`px-2 py-0.5 rounded text-[10px] transition-colors ${tab === 'config' ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-200'}`}
          >
            Config
          </button>
          {isConnected && (
            <button
              onClick={() => void window.electron.discordDisconnect?.()}
              className="px-2 py-0.5 rounded text-[10px] bg-red-950/40 border border-red-800/40 text-red-400 hover:text-red-200 transition-colors"
            >
              Disconnect
            </button>
          )}
        </div>
      </div>

      {/* Connect form (if not connected) */}
      {!isConnected && tab === 'messages' && (
        <div className="flex flex-col gap-3 px-3 py-4">
          <div className="text-slate-400">Connect a Discord bot to monitor channels and auto-respond.</div>
          <div className="flex gap-2">
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void handleConnect()}
              placeholder="Bot token…"
              className="flex-1 bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
            <button
              onClick={() => void handleConnect()}
              disabled={!token.trim() || connecting}
              className="px-3 py-1.5 text-sm rounded bg-indigo-600 hover:bg-indigo-500 text-white transition-colors disabled:opacity-50"
            >
              {connecting ? 'Connecting…' : 'Connect'}
            </button>
          </div>
          {connectError && (
            <div className="text-red-400 text-[10px] bg-red-950/30 border border-red-800/40 rounded px-2 py-1.5">
              {connectError}
            </div>
          )}
          {status?.state === 'error' && status.error && (
            <div className="text-red-400 text-[10px] bg-red-950/30 border border-red-800/40 rounded px-2 py-1.5">
              {status.error}
            </div>
          )}
        </div>
      )}

      {/* Messages tab (connected) */}
      {isConnected && tab === 'messages' && status && (
        <>
          {/* Channel list */}
          <div className="flex gap-1 px-3 py-1.5 border-b border-slate-700/40 overflow-x-auto shrink-0">
            {status.channels.filter((c: DiscordChannel) => status.monitoredChannels.includes(c.id) || status.channels.length <= 6).slice(0, 8).map((ch: DiscordChannel) => (
              <button
                key={ch.id}
                onClick={() => void handleLoadHistory(ch.id)}
                className={`px-2 py-0.5 rounded text-[10px] whitespace-nowrap transition-colors border ${
                  activeChannelId === ch.id
                    ? 'bg-slate-600 border-slate-500 text-white'
                    : 'bg-slate-800 border-slate-600 text-slate-400 hover:text-slate-200'
                }`}
              >
                #{ch.name}
                {status.projectMapping[ch.id] && (
                  <span className="ml-1 text-indigo-400">{status.projectMapping[ch.id]}</span>
                )}
                {status.monitoredChannels.includes(ch.id) && (
                  <span className="ml-1 w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
                )}
              </button>
            ))}
          </div>

          {/* Message feed */}
          <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5">
            {!activeChannelId && (
              <div className="flex items-center justify-center h-24 text-slate-500">
                Select a channel to view messages.
              </div>
            )}
            {activeChannelId && messages.length === 0 && (
              <div className="flex items-center justify-center h-24 text-slate-500">No messages.</div>
            )}
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`rounded px-2.5 py-1.5 border ${msg.isBot ? 'border-indigo-700/40 bg-indigo-950/20' : 'border-slate-700/40 bg-slate-800/30'}`}
              >
                <div className="flex items-center gap-2">
                  <span className={`font-medium shrink-0 ${msg.isBot ? 'text-indigo-300' : 'text-slate-200'}`}>
                    {msg.authorName}
                    {msg.isBot && <span className="ml-1 text-[9px] text-indigo-400">BOT</span>}
                  </span>
                  <span className="text-slate-600 text-[9px]">
                    {new Date(msg.timestamp).toLocaleTimeString()}
                  </span>
                </div>
                <div className="text-slate-300 mt-0.5 break-words">{msg.content}</div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Composer */}
          {activeChannelId && (
            <div className="flex gap-2 px-3 py-2 border-t border-slate-700/40 shrink-0">
              <input
                type="text"
                value={compose}
                onChange={(e) => setCompose(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && void handleSend()}
                placeholder="Send a message…"
                disabled={sending}
                className="flex-1 bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-[11px] text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 disabled:opacity-60"
              />
              <button
                onClick={() => void handleSend()}
                disabled={!compose.trim() || sending}
                className="px-3 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] transition-colors disabled:opacity-50"
              >
                {sending ? '…' : 'Send'}
              </button>
            </div>
          )}
        </>
      )}

      {/* Config tab */}
      {tab === 'config' && status && isConnected && (
        <DiscordConfigTab status={status} />
      )}
    </div>
  )
}

// ── Config Tab ────────────────────────────────────────────────────

function DiscordConfigTab({ status }: { status: DiscordGatewayStatus }) {
  const [mapping, setMapping] = useState<Record<string, string>>(status.projectMapping)
  const [monitored, setMonitored] = useState<Set<string>>(new Set(status.monitoredChannels))
  const [autoRespond, setAutoRespond] = useState(status.autoRespond)

  const handleSaveMapping = async () => {
    await window.electron.discordSetMapping?.(mapping)
    await window.electron.discordSetMonitored?.([...monitored])
    await window.electron.discordSetAutoRespond?.(autoRespond)
  }

  const toggleMonitor = (channelId: string) => {
    setMonitored((prev) => {
      const next = new Set(prev)
      if (next.has(channelId)) next.delete(channelId)
      else next.add(channelId)
      return next
    })
  }

  return (
    <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
      {/* Guilds */}
      <div>
        <div className="text-[10px] font-medium text-slate-400 mb-1">Connected Servers ({status.guilds.length})</div>
        <div className="flex flex-wrap gap-1">
          {status.guilds.map((g: DiscordGuild) => (
            <span key={g.id} className="px-2 py-0.5 rounded bg-slate-800 border border-slate-600 text-[10px] text-slate-300">
              {g.name}
            </span>
          ))}
        </div>
      </div>

      {/* Channel mapping */}
      <div>
        <div className="text-[10px] font-medium text-slate-400 mb-1">Channel → Project Mapping</div>
        <div className="space-y-1.5">
          {status.channels.map((ch: DiscordChannel) => (
            <div key={ch.id} className="flex items-center gap-2">
              <button
                onClick={() => toggleMonitor(ch.id)}
                className={`w-4 h-4 rounded border flex-shrink-0 ${monitored.has(ch.id) ? 'bg-emerald-600 border-emerald-500' : 'bg-slate-800 border-slate-600'}`}
                title="Monitor this channel"
              />
              <span className="text-slate-300 w-28 truncate">#{ch.name}</span>
              <input
                type="text"
                value={mapping[ch.id] ?? ''}
                onChange={(e) => setMapping((m) => ({ ...m, [ch.id]: e.target.value }))}
                placeholder="project name…"
                className="flex-1 bg-slate-800 border border-slate-600 rounded px-2 py-0.5 text-[10px] text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
              />
            </div>
          ))}
        </div>
      </div>

      {/* Auto-respond */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => setAutoRespond((v: boolean) => !v)}
          className={`w-8 h-4 rounded-full relative transition-colors ${autoRespond ? 'bg-indigo-600' : 'bg-slate-700'}`}
        >
          <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${autoRespond ? 'translate-x-4' : 'translate-x-0.5'}`} />
        </button>
        <span className="text-slate-300">Auto-respond to messages (lightweight chain — local model only)</span>
      </div>

      <button
        onClick={() => void handleSaveMapping()}
        className="px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] transition-colors"
      >
        Save configuration
      </button>
    </div>
  )
}
