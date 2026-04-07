import { create } from 'zustand'

export interface QueuedMessage {
  id: string
  conversationId: string | null
  preview: string
  enqueuedAt: number
}

interface MessageQueueStore {
  active: QueuedMessage | null
  queued: QueuedMessage[]
  enqueue: (item: QueuedMessage) => void
  start: (id: string) => void
  finish: (id: string) => void
}

export const useMessageQueueStore = create<MessageQueueStore>((set, get) => ({
  active: null,
  queued: [],

  enqueue: (item) => {
    set((state) => ({ queued: [...state.queued, item] }))
  },

  start: (id) => {
    const item = get().queued.find((entry) => entry.id === id)
    if (!item) return
    set((state) => ({
      active: item,
      queued: state.queued.filter((entry) => entry.id !== id),
    }))
  },

  finish: (id) => {
    set((state) => ({
      active: state.active?.id === id ? null : state.active,
    }))
  },
}))
