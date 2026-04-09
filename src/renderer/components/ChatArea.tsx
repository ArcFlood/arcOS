import { useEffect, useMemo, useRef } from 'react'
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

  const selectedConversationId = moduleId
    ? (module?.conversationId ?? null)
    : (activeConversationId ?? conversations[0]?.id ?? null)
  const selectedConversation = conversations.find((conversation) => conversation.id === selectedConversationId) ?? null
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
  const modelIndicatorTone = selectedConversation?.status === 'error' || selectedConversation?.status === 'provider_failure' || selectedConversation?.status === 'zero_output_failure'
    ? 'text-danger border-danger/30 bg-danger/10'
    : 'text-success border-success/30 bg-success/10'

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [selectedConversation?.messages.length, selectedConversationId])

  useEffect(() => {
    if (!moduleId || module?.panelId !== 'chat' || module.conversationId) return
    const latestModule = useWorkspaceStore.getState().layout.modules.find((entry) => entry.id === moduleId)
    if (!latestModule || latestModule.panelId !== 'chat' || latestModule.conversationId) return
    const conversationId = createConversation(latestModule.title ?? 'Terminal')
    setActiveConversation(conversationId)
    setModuleConversation(moduleId, conversationId)
  }, [createConversation, module?.conversationId, module?.panelId, module?.title, moduleId, setActiveConversation, setModuleConversation])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border bg-[#0f1318] px-3 py-2">
        <div className="flex items-center justify-center text-[11px]">
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
          <div ref={messagesEndRef} />
        )}
      </div>

      <div className="border-t border-border bg-[#11151a]">
        <div className="mx-auto max-w-[800px] px-4 py-4">
          {selectedConversationId ? (
            <MessageInput
              conversationId={selectedConversationId}
              moduleId={moduleId}
              onConversationCreated={(conversationId) => {
                setActiveConversation(conversationId)
                if (moduleId) setModuleConversation(moduleId, conversationId)
              }}
            />
          ) : (
            <MessageInput
              conversationId={null}
              moduleId={moduleId}
              disabled={Boolean(moduleId)}
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

function StatusChip({ label, toneClass }: { label: string; toneClass: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 font-medium ${toneClass}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-90" />
      <span className="truncate">{label}</span>
    </span>
  )
}
