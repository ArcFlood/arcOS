import { useEffect, useMemo, useRef, useState } from 'react'
import { useConversationStore } from '../stores/conversationStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useWorkspaceStore } from '../stores/workspaceStore'
import UserMessage from './messages/UserMessage'
import AssistantMessage from './messages/AssistantMessage'
import SystemMessage from './messages/SystemMessage'
import MessageInput from './MessageInput'

interface ChatAreaProps {
  moduleId: string | null
}

export default function ChatArea({ moduleId }: ChatAreaProps) {
  const conversations = useConversationStore((s) => s.conversations)
  const activeConversationId = useConversationStore((s) => s.activeConversationId)
  const createConversation = useConversationStore((s) => s.createConversation)
  const setActiveConversation = useConversationStore((s) => s.setActiveConversation)
  const module = useWorkspaceStore((s) => s.layout.modules.find((entry) => entry.id === moduleId))
  const setModuleConversation = useWorkspaceStore((s) => s.setModuleConversation)
  const ollamaModel = useSettingsStore((s) => s.settings.ollamaModel)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const threadMenuItemsRef = useRef<Array<HTMLButtonElement | null>>([])
  const [threadMenuOpen, setThreadMenuOpen] = useState(false)

  const selectedConversationId = moduleId
    ? (module?.conversationId ?? null)
    : (activeConversationId ?? conversations[0]?.id ?? null)
  const selectedConversation = conversations.find((conversation) => conversation.id === selectedConversationId) ?? null
  const isIdleTerminal = Boolean(
    moduleId &&
    selectedConversationId &&
    activeConversationId &&
    selectedConversationId !== activeConversationId
  )
  const activeModelLabel = useMemo(() => {
    const lastAssistantMessage = [...(selectedConversation?.messages ?? [])]
      .reverse()
      .find((message) => message.role === 'assistant' && message.model)

    if (lastAssistantMessage?.modelLabel) return lastAssistantMessage.modelLabel
    if (lastAssistantMessage?.model === 'ollama') return ollamaModel
    if (lastAssistantMessage?.model === 'arc-sonnet') return 'claude-sonnet-4-6'
    if (lastAssistantMessage?.model === 'arc-opus') return 'claude-opus-4-6'
    if (lastAssistantMessage?.model === 'haiku') return 'claude-haiku-4-5-20251001'
    return ollamaModel
  }, [selectedConversation?.messages, ollamaModel])
  const modelIndicatorTone = selectedConversation?.status === 'error' ? 'text-danger border-danger/30 bg-danger/10' : 'text-success border-success/30 bg-success/10'

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [selectedConversation?.messages.length, selectedConversationId])

  useEffect(() => {
    if (!threadMenuOpen) return
    window.setTimeout(() => threadMenuItemsRef.current[0]?.focus(), 0)
  }, [threadMenuOpen])

  useEffect(() => {
    if (!threadMenuOpen) return
    const itemCount = conversations.length + 1
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        const currentIndex = threadMenuItemsRef.current.findIndex((entry) => entry === document.activeElement)
        const next = Math.min(currentIndex + 1, itemCount - 1)
        threadMenuItemsRef.current[next]?.focus()
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        const currentIndex = threadMenuItemsRef.current.findIndex((entry) => entry === document.activeElement)
        const next = Math.max(currentIndex - 1, 0)
        threadMenuItemsRef.current[next]?.focus()
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        setThreadMenuOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [threadMenuOpen, conversations.length])

  useEffect(() => {
    if (!moduleId) return
    if (module?.conversationId === selectedConversationId) return
    setModuleConversation(moduleId, selectedConversationId)
  }, [moduleId, module?.conversationId, selectedConversationId, setModuleConversation])

  const handleSelectConversation = (conversationId: string) => {
    setActiveConversation(conversationId)
    if (moduleId) setModuleConversation(moduleId, conversationId)
    setThreadMenuOpen(false)
  }

  const handleNewConversation = () => {
    const conversationId = createConversation()
    if (moduleId) setModuleConversation(moduleId, conversationId)
    setThreadMenuOpen(false)
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border bg-[#0f1318] px-3 py-2">
        <div className="flex items-center justify-between gap-2 pb-1">
          <div className="relative">
            <button
              onClick={() => setThreadMenuOpen((current) => !current)}
              className="min-w-[240px] rounded-md border border-border bg-[#12161b] px-3 py-1.5 text-left text-xs text-text-muted transition-colors hover:border-[#8fa1b3]/35 hover:text-text"
            >
              <span className="block truncate text-sm text-text">{selectedConversation?.title ?? 'Select Thread'}</span>
              <span className="mt-0.5 block text-[11px] text-text-dim">Thread Menu</span>
            </button>
            {threadMenuOpen && (
              <div className="absolute left-0 top-full z-20 mt-1 max-h-72 w-72 overflow-auto rounded-md border border-border bg-[#10151b] p-1 shadow-xl">
                <button
                  ref={(element) => { threadMenuItemsRef.current[0] = element }}
                  onClick={handleNewConversation}
                  className="block w-full rounded px-3 py-2 text-left text-xs text-text-muted transition-colors hover:bg-[#18202a] hover:text-text"
                >
                  <span className="block text-sm text-text">New Thread</span>
                  <span className="mt-0.5 block text-[11px] text-text-dim">Create and bind a new thread to this terminal</span>
                </button>
                <div className="my-1 border-t border-border" />
                {conversations.map((conversation) => (
                  <button
                    ref={(element) => { threadMenuItemsRef.current[conversations.indexOf(conversation) + 1] = element }}
                    key={conversation.id}
                    onClick={() => handleSelectConversation(conversation.id)}
                    className={`block w-full rounded px-3 py-2 text-left text-xs transition-colors ${
                      conversation.id === selectedConversationId
                        ? 'bg-[#18202a] text-text'
                        : 'text-text-muted hover:bg-[#18202a] hover:text-text'
                    }`}
                  >
                    <span className="block truncate text-sm">{conversation.title}</span>
                    <span className="mt-0.5 block text-[11px] text-text-dim">
                      {new Date(conversation.updatedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

        </div>

        <div className="mt-2 flex items-center justify-center text-[11px]">
          <StatusChip label={activeModelLabel} toneClass={modelIndicatorTone} />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto bg-[linear-gradient(180deg,rgba(14,17,22,0.4)_0%,rgba(14,17,22,0)_100%)] px-4 py-4">
        {selectedConversation && selectedConversation.messages.length > 0 ? (
          <div className="mx-auto max-w-[800px] space-y-4">
            {selectedConversation.messages.map((message) => {
              if (message.role === 'user') return <UserMessage key={message.id} message={message} />
              if (message.role === 'system') return <SystemMessage key={message.id} message={message} />
              return <AssistantMessage key={message.id} message={message} />
            })}
            <div ref={messagesEndRef} />
          </div>
        ) : (
          <EmptyState onStart={handleNewConversation} />
        )}
      </div>

      <div className="border-t border-border bg-[#11151a]">
        <div className="mx-auto max-w-[800px] px-4 py-4">
          {selectedConversationId ? (
            <>
              {isIdleTerminal && (
                <div className="mb-3 rounded-lg border border-border bg-[#141920] px-3 py-2 text-xs text-text-muted">
                  This terminal is idle. Select it to make it active before sending.
                </div>
              )}
              <MessageInput
                conversationId={selectedConversationId}
                disabled={isIdleTerminal}
                onConversationCreated={(conversationId) => {
                  setActiveConversation(conversationId)
                  if (moduleId) setModuleConversation(moduleId, conversationId)
                }}
              />
            </>
          ) : (
            <MessageInput
              conversationId={null}
              onConversationCreated={(conversationId) => {
                setActiveConversation(conversationId)
                if (moduleId) setModuleConversation(moduleId, conversationId)
              }}
            />
          )}
        </div>
      </div>
    </div>
  )
}

function EmptyState({ onStart }: { onStart: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 py-16 text-center">
      <h2 className="text-2xl font-semibold text-text">Waiting for Input</h2>
      <button onClick={onStart} className="btn-primary px-6 py-2.5 text-sm">
        New Thread <span className="ml-2 text-white/60 text-xs">⌘K</span>
      </button>
    </div>
  )
}

function StatusChip({ label, toneClass }: { label: string; toneClass: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 font-medium ${toneClass}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-90" />
      <span className="truncate">{label}</span>
    </span>
  )
}
