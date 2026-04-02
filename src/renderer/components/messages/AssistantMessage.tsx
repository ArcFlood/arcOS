import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { Message } from '../../stores/types'
import { useConversationStore } from '../../stores/conversationStore'
import MessageBadge from './MessageBadge'
import CopyButton from './CopyButton'

function BookmarkButton({ message }: { message: Message }) {
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const activeConversation = useConversationStore((s) => s.activeConversation())

  const handleSave = async () => {
    if (saving || saved) return
    setSaving(true)
    try {
      const result = await window.electron.learningsSave?.({
        content: message.content,
        model: message.model ?? 'unknown',
        conversationTitle: activeConversation?.title ?? 'Untitled',
        userTags: [],
      })
      if (result?.success) setSaved(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <button
      onClick={handleSave}
      disabled={saving}
      title={saved ? 'Saved to learnings' : 'Save to learnings'}
      className={`text-xs transition-colors ${
        saved ? 'text-accent' : 'text-text-muted hover:text-accent'
      } disabled:opacity-40`}
    >
      {saved ? '★' : '☆'}
    </button>
  )
}

export default function AssistantMessage({ message }: { message: Message }) {
  return (
    <div className="flex justify-start group">
      <div className="max-w-[85%] w-full">
        {/* Badge row */}
        <div className="flex items-center gap-2 mb-1.5 px-1">
          {message.model && <MessageBadge tier={message.model} cost={message.cost} />}
          {message.routingReason && (
            <span className="text-xs text-text-muted italic">— {message.routingReason}</span>
          )}
        </div>

        <div className="bg-surface border border-border px-4 py-3 rounded-2xl rounded-tl-sm relative selectable">
          {message.isStreaming && (
            <span className="inline-block w-2 h-4 bg-text-muted animate-pulse rounded-sm ml-1" />
          )}
          <div className="prose prose-sm prose-invert max-w-none text-text leading-relaxed">
            <ReactMarkdown
              components={{
                code({ node: _node, className, children, ...props }) {
                  const match = /language-(\w+)/.exec(className || '')
                  const isBlock = match !== null
                  return isBlock ? (
                    <SyntaxHighlighter
                      style={oneDark}
                      language={match[1]}
                      PreTag="div"
                      customStyle={{ borderRadius: '6px', fontSize: '13px', margin: '8px 0' }}
                    >
                      {String(children).replace(/\n$/, '')}
                    </SyntaxHighlighter>
                  ) : (
                    <code
                      className="bg-surface-elevated px-1.5 py-0.5 rounded text-xs font-mono"
                      {...props}
                    >
                      {children}
                    </code>
                  )
                },
              }}
            >
              {message.content}
            </ReactMarkdown>
          </div>
        </div>

        {/* Footer row */}
        <div className="flex items-center gap-2 mt-1 px-1">
          <span className="text-xs text-text-muted">
            {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
          <CopyButton text={message.content} />
          {!message.isStreaming && <BookmarkButton message={message} />}
        </div>
      </div>
    </div>
  )
}
