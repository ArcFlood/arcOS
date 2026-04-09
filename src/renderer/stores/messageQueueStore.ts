import { create } from 'zustand'

export interface QueuedMessage {
  id: string
  conversationId: string | null
  moduleId?: string | null
  preview: string
  enqueuedAt: number
}

interface MessageQueueStore {
  active: QueuedMessage | null
  queued: QueuedMessage[]
  enqueue: (item: QueuedMessage) => void
  start: (id: string) => boolean
  finish: (id: string) => void
  removeForConversation: (conversationId: string) => void
  removeForModule: (moduleId: string) => void
}

export const useMessageQueueStore = create<MessageQueueStore>((set, get) => ({
  active: null,
  queued: [],

  enqueue: (item) => {
    set((state) => ({ queued: [...state.queued, item] }))
  },

  start: (id) => {
    const item = get().queued.find((entry) => entry.id === id)
    if (!item) return false
    set((state) => ({
      active: item,
      queued: state.queued.filter((entry) => entry.id !== id),
    }))
    return true
  },

  finish: (id) => {
    set((state) => ({
      active: state.active?.id === id ? null : state.active,
    }))
  },

  removeForConversation: (conversationId) => {
    set((state) => ({
      active: state.active?.conversationId === conversationId ? null : state.active,
      queued: state.queued.filter((entry) => entry.conversationId !== conversationId),
    }))
  },

  removeForModule: (moduleId) => {
    set((state) => ({
      active: state.active?.moduleId === moduleId ? null : state.active,
      queued: state.queued.filter((entry) => entry.moduleId !== moduleId),
    }))
  },
}))
