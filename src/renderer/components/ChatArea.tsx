import { useEffect, useRef } from 'react'
import { useConversationStore } from '../stores/conversationStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useServiceStore } from '../stores/serviceStore'
import UserMessage from './messages/UserMessage'
import AssistantMessage from './messages/AssistantMessage'
import SystemMessage from './messages/SystemMessage'
import MessageInput from './MessageInput'

export default function ChatArea() {
  const activeConversation = useConversationStore((s) => s.activeConversation())
  const createConversation = useConversationStore((s) => s.createConversation)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [activeConversation?.messages.length])

  const messages = activeConversation?.messages ?? []

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto bg-[linear-gradient(180deg,rgba(14,17,22,0.4)_0%,rgba(14,17,22,0)_100%)] px-4 py-4">
        {messages.length === 0 ? (
          <EmptyState onStart={() => createConversation()} />
        ) : (
          <div className="max-w-[800px] mx-auto space-y-4">
            {messages.map((msg) => {
              if (msg.role === 'user') return <UserMessage key={msg.id} message={msg} />
              if (msg.role === 'system') return <SystemMessage key={msg.id} message={msg} />
              return <AssistantMessage key={msg.id} message={msg} />
            })}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-border bg-[#11151a]">
        <div className="max-w-[800px] mx-auto px-4 py-4">
          <MessageInput conversationId={activeConversation?.id ?? null} />
        </div>
      </div>
    </div>
  )
}

function EmptyState({ onStart }: { onStart: () => void }) {
  const hasApiKey = useSettingsStore((s) => s.hasApiKey)
  const ollamaRunning = useServiceStore((s) => s.getService('ollama')?.running ?? false)
  const openSettings = useSettingsStore((s) => s.openSettingsPanel)

  const hasNoSetup = !hasApiKey && !ollamaRunning

  return (
    <div className="flex flex-col items-center justify-center h-full text-center gap-8 py-16">
      <div className="max-w-2xl rounded-2xl border border-border bg-[linear-gradient(180deg,rgba(25,30,37,0.96)_0%,rgba(18,22,27,0.96)_100%)] px-8 py-8 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
        <p className="arcos-kicker mb-3">PAI THREAD MODULE</p>
        <h2 className="text-3xl font-semibold text-text mb-3 tracking-[0.01em]">Work inside the active task thread</h2>
        <p className="text-text-muted text-sm max-w-xl leading-relaxed mx-auto">
          Use this module for live task exchange while the rest of ARCOS keeps routing, services, memory, tools, and execution state visible around it.
        </p>
      </div>

      {/* Onboarding hints — shown when nothing is configured */}
      {hasNoSetup && (
        <div className="w-full max-w-xl space-y-2 text-left">
          <p className="arcos-kicker text-center mb-3">
            Initial Bring-Up
          </p>
          <OnboardingStep
            number={1}
            done={ollamaRunning}
            title="Start Ollama"
            detail="Bring up the Ollama runtime from the Services or Navigator module for local inference."
          />
          <OnboardingStep
            number={2}
            done={hasApiKey}
            title="Add Claude API key"
            detail={
              <span>
                Open{' '}
                <button onClick={openSettings} className="underline text-accent hover:opacity-80">
                  Settings → API Keys
                </button>{' '}
                to authorize Haiku and A.R.C. cloud routing.
              </span>
            }
          />
          <OnboardingStep
            number={3}
            done={false}
            title="Open a task thread"
            detail="ARCOS will route each prompt through the right PAI path once services are ready."
          />
        </div>
      )}

      {/* Status chips */}
      {!hasNoSetup && (
        <div className="flex items-center gap-3 text-xs">
          <StatusChip label="Ollama" active={ollamaRunning} color="text-success" />
          <StatusChip label="Claude API" active={hasApiKey} color="text-arc-accent" />
        </div>
      )}

      <button onClick={onStart} className="btn-primary px-6 py-2.5 text-sm">
        Open thread
        <span className="ml-2 text-white/60 text-xs">⌘K</span>
      </button>
    </div>
  )
}

function OnboardingStep({
  number,
  done,
  title,
  detail,
}: {
  number: number
  done: boolean
  title: string
  detail: React.ReactNode
}) {
  return (
    <div className={`flex gap-3 px-4 py-3 rounded-xl border ${done ? 'border-success/30 bg-success/5' : 'border-border bg-[#181d23]'}`}>
      <div className={`flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold mt-0.5 ${done ? 'bg-success text-white' : 'bg-[#2a313a] text-text-muted'}`}>
        {done ? '✓' : number}
      </div>
      <div>
        <p className={`text-sm font-medium ${done ? 'text-success line-through opacity-60' : 'text-text'}`}>{title}</p>
        <p className="text-xs text-text-muted mt-0.5">{detail}</p>
      </div>
    </div>
  )
}

function StatusChip({ label, active, color }: { label: string; active: boolean; color: string }) {
  return (
    <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs ${active ? `${color} border-current/30 bg-current/5` : 'text-text-muted border-border'}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-current' : 'bg-text-muted'}`} />
      {label}
    </div>
  )
}
