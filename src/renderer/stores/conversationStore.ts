import { create } from 'zustand'
import { Conversation, ConversationStatus, Message } from './types'

function generateId(): string {
  return crypto.randomUUID()
}

function generateTitle(firstMessage: string): string {
  return firstMessage.length > 50 ? firstMessage.slice(0, 47) + '...' : firstMessage
}

// ── DB serialisation helpers ──────────────────────────────────────

function convToDb(c: Conversation) {
  return {
    id: c.id,
    title: c.title,
    created_at: c.createdAt,
    updated_at: c.updatedAt,
    tags: JSON.stringify(c.tags),
    total_cost: c.totalCost,
  }
}

function msgToDb(m: Message) {
  return {
    id: m.id,
    conversation_id: m.conversationId,
    role: m.role,
    content: m.content,
    model: m.model ?? null,
    cost: m.cost,
    timestamp: m.timestamp,
    routing_reason: m.routingReason ?? null,
  }
}

function dbToConv(row: Record<string, unknown>): Omit<Conversation, 'messages'> {
  return {
    id: row.id as string,
    title: row.title as string,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
    tags: (() => { try { return JSON.parse((row.tags as string) || '[]') as string[] } catch { return [] } })(),
    totalCost: row.total_cost as number,
    status: 'idle',  // always reset to idle on load; in-flight state doesn't persist
  }
}

function dbToMsg(row: Record<string, unknown>): Message {
  return {
    id: row.id as string,
    conversationId: row.conversation_id as string,
    role: row.role as 'user' | 'assistant' | 'system',
    content: row.content as string,
    model: (row.model as import('./types').ModelTier | null) ?? null,
    cost: row.cost as number,
    timestamp: row.timestamp as number,
    routingReason: (row.routing_reason as string | null) ?? undefined,
    isStreaming: false,
  }
}

// ── Store interface ───────────────────────────────────────────────

interface ConversationStore {
  conversations: Conversation[]
  activeConversationId: string | null
  searchQuery: string
  tagFilter: string | null
  dbReady: boolean

  activeConversation: () => Conversation | null
  filteredConversations: () => Conversation[]
  getAllTags: () => string[]

  // DB bootstrap — called once on app mount
  loadFromDb: () => Promise<void>

  createConversation: () => string
  setActiveConversation: (id: string | null) => void
  deleteConversation: (id: string) => void
  addMessage: (conversationId: string, msg: Omit<Message, 'id' | 'conversationId'>) => Message
  updateMessage: (conversationId: string, messageId: string, updates: Partial<Message>) => void
  updateConversationTitle: (id: string, title: string) => void
  setConversationStatus: (id: string, status: ConversationStatus) => void
  addTag: (id: string, tag: string) => void
  removeTag: (id: string, tag: string) => void
  setSearchQuery: (q: string) => void
  setTagFilter: (tag: string | null) => void
  clearAll: () => void
}

export const useConversationStore = create<ConversationStore>((set, get) => ({
  conversations: [],
  activeConversationId: null,
  searchQuery: '',
  tagFilter: null,
  dbReady: false,

  activeConversation: () => {
    const { conversations, activeConversationId } = get()
    return conversations.find((c) => c.id === activeConversationId) ?? null
  },

  filteredConversations: () => {
    const { conversations, searchQuery, tagFilter } = get()
    let result = conversations
    if (tagFilter) {
      result = result.filter((c) => c.tags.includes(tagFilter))
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      result = result.filter(
        (c) =>
          c.title.toLowerCase().includes(q) ||
          c.tags.some((t) => t.toLowerCase().includes(q)) ||
          c.messages.some((m) => m.content.toLowerCase().includes(q))
      )
    }
    return result
  },

  getAllTags: () => {
    const { conversations } = get()
    const tagSet = new Set<string>()
    conversations.forEach((c) => c.tags.forEach((t) => tagSet.add(t)))
    return Array.from(tagSet).sort()
  },

  // ── Bootstrap from DB ─────────────────────────────────────────
  loadFromDb: async () => {
    try {
      const convResult = await window.electron.db.conversations.list()
      if (!convResult.success || !convResult.data) return

      const conversations: Conversation[] = await Promise.all(
        convResult.data.map(async (row) => {
          const base = dbToConv(row as Record<string, unknown>)
          const msgResult = await window.electron.db.messages.list(base.id)
          const messages = (msgResult.data ?? []).map((r) =>
            dbToMsg(r as Record<string, unknown>)
          )
          return { ...base, messages }
        })
      )

      set({ conversations, dbReady: true })
    } catch (e) {
      console.error('[ConversationStore] DB load failed:', e)
      set({ dbReady: true }) // mark ready even on error so UI doesn't hang
    }
  },

  // ── Mutations (update state + fire-and-forget DB persist) ─────

  createConversation: () => {
    const id = generateId()
    const conversation: Conversation = {
      id,
      title: 'New Conversation',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      tags: [],
      totalCost: 0,
      messages: [],
      status: 'idle',
    }
    set((s) => ({
      conversations: [conversation, ...s.conversations],
      activeConversationId: id,
    }))
    window.electron.db.conversations.save(convToDb(conversation)).catch(console.error)
    return id
  },

  setActiveConversation: (id) => set({ activeConversationId: id }),

  deleteConversation: (id) => {
    set((s) => ({
      conversations: s.conversations.filter((c) => c.id !== id),
      activeConversationId: s.activeConversationId === id ? null : s.activeConversationId,
    }))
    window.electron.db.conversations.delete(id).catch(console.error)
  },

  addMessage: (conversationId, msgData) => {
    const msg: Message = { id: generateId(), conversationId, ...msgData }
    set((s) => ({
      conversations: s.conversations.map((c) => {
        if (c.id !== conversationId) return c
        const messages = [...c.messages, msg]
        const title =
          c.messages.length === 0 && msg.role === 'user'
            ? generateTitle(msg.content)
            : c.title
        const updated = {
          ...c,
          messages,
          title,
          updatedAt: Date.now(),
          totalCost: c.totalCost + (msg.cost ?? 0),
        }
        // Persist conversation metadata
        window.electron.db.conversations.save(convToDb(updated)).catch(console.error)
        // Persist message — skip if mid-stream (will save on completion)
        if (!msg.isStreaming) {
          window.electron.db.messages.save(msgToDb(msg)).catch(console.error)
        }
        return updated
      }),
    }))
    return msg
  },

  updateMessage: (conversationId, messageId, updates) => {
    set((s) => ({
      conversations: s.conversations.map((c) => {
        if (c.id !== conversationId) return c
        const messages = c.messages.map((m) => (m.id === messageId ? { ...m, ...updates } : m))
        const totalCost =
          updates.cost !== undefined
            ? messages.reduce((sum, m) => sum + (m.cost ?? 0), 0)
            : c.totalCost
        const updated = { ...c, messages, totalCost }

        // Only persist to DB once streaming is finished
        if (updates.isStreaming === false) {
          const finalMsg = messages.find((m) => m.id === messageId)
          if (finalMsg) {
            window.electron.db.messages.save(msgToDb(finalMsg)).catch(console.error)
          }
          window.electron.db.conversations.save(convToDb(updated)).catch(console.error)
        }
        return updated
      }),
    }))
  },

  updateConversationTitle: (id, title) => {
    set((s) => ({
      conversations: s.conversations.map((c) => (c.id === id ? { ...c, title } : c)),
    }))
    const conv = get().conversations.find((c) => c.id === id)
    if (conv) window.electron.db.conversations.save(convToDb(conv)).catch(console.error)
  },

  addTag: (id, tag) => {
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === id && !c.tags.includes(tag) ? { ...c, tags: [...c.tags, tag] } : c
      ),
    }))
    const conv = get().conversations.find((c) => c.id === id)
    if (conv) window.electron.db.conversations.save(convToDb(conv)).catch(console.error)
  },

  removeTag: (id, tag) => {
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === id ? { ...c, tags: c.tags.filter((t) => t !== tag) } : c
      ),
    }))
    const conv = get().conversations.find((c) => c.id === id)
    if (conv) window.electron.db.conversations.save(convToDb(conv)).catch(console.error)
  },

  setConversationStatus: (id, status) => {
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === id ? { ...c, status } : c
      ),
    }))
  },

  setSearchQuery: (searchQuery) => set({ searchQuery }),

  setTagFilter: (tagFilter) => set({ tagFilter }),

  clearAll: () => {
    set({ conversations: [], activeConversationId: null })
    // No DB call — individual deletes handle cascade; clearAll is UI-only for now
  },
}))
