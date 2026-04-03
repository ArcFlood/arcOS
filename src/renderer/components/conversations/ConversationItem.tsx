import { useState, useRef, useEffect, useMemo, KeyboardEvent } from 'react'
import { Conversation } from '../../stores/types'
import { useConversationStore } from '../../stores/conversationStore'
import { formatCostBadge } from '../../utils/formatCurrency'
import { exportConversationAsMd, saveConversationToVault } from '../../utils/exportConversation'

interface Props {
  conversation: Conversation
  isActive: boolean
}

export default function ConversationItem({ conversation, isActive }: Props) {
  const [exporting, setExporting] = useState(false)
  const [savingToVault, setSavingToVault] = useState(false)
  const [vaultSaved, setVaultSaved] = useState(false)
  const [tagging, setTagging] = useState(false)
  const [tagInput, setTagInput] = useState('')
  const [showSuggestions, setShowSuggestions] = useState(false)
  const tagInputRef = useRef<HTMLInputElement>(null)

  const setActive = useConversationStore((s) => s.setActiveConversation)
  const deleteConversation = useConversationStore((s) => s.deleteConversation)
  const addTag = useConversationStore((s) => s.addTag)
  const removeTag = useConversationStore((s) => s.removeTag)
  const getAllTags = useConversationStore((s) => s.getAllTags)
  const setTagFilter = useConversationStore((s) => s.setTagFilter)

  const allTags = getAllTags()
  const suggestions = useMemo(
    () => tagInput.length === 0 ? [] : allTags.filter(
      (t) => t.toLowerCase().includes(tagInput.toLowerCase()) && !conversation.tags.includes(t)
    ),
    [tagInput, allTags, conversation.tags]
  )

  // Focus tag input when it opens
  useEffect(() => {
    if (tagging) tagInputRef.current?.focus()
  }, [tagging])

  const handleExport = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (exporting) return
    setExporting(true)
    await exportConversationAsMd(conversation)
    setExporting(false)
  }

  const handleSaveToVault = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (savingToVault || conversation.messages.length === 0) return
    setSavingToVault(true)
    const res = await saveConversationToVault(conversation)
    setSavingToVault(false)
    if (res.success) {
      setVaultSaved(true)
      setTimeout(() => setVaultSaved(false), 2000)
    }
  }

  const handleTagKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      commitTag(tagInput)
    } else if (e.key === 'Escape') {
      setTagging(false)
      setTagInput('')
    }
  }

  const commitTag = (raw: string) => {
    const tag = raw.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
    if (tag && !conversation.tags.includes(tag)) {
      addTag(conversation.id, tag)
    }
    setTagInput('')
    setShowSuggestions(false)
    tagInputRef.current?.focus()
  }

  const timeStr = new Date(conversation.updatedAt).toLocaleDateString([], {
    month: 'short', day: 'numeric',
  })

  return (
    <div
      onClick={() => setActive(conversation.id)}
      className={`group relative flex flex-col px-3 py-2.5 rounded-lg cursor-pointer transition-colors ${
        isActive ? 'bg-accent/15 border border-accent/30' : 'hover:bg-surface-elevated border border-transparent'
      }`}
    >
      {/* Title row */}
      <div className="flex items-start justify-between gap-1">
        <p className="text-sm text-text font-medium leading-snug line-clamp-1 flex-1">
          {conversation.title}
        </p>
        {/* Action buttons — appear on hover */}
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
          <button
            onClick={(e) => { e.stopPropagation(); setTagging((v) => !v) }}
            className="text-text-muted hover:text-accent transition-colors text-xs p-0.5 rounded"
            title="Add tag"
          >
            #
          </button>
          <button
            onClick={handleExport}
            disabled={exporting}
            className="text-text-muted hover:text-accent transition-colors text-xs p-0.5 rounded"
            title="Export as Markdown"
          >
            {exporting ? '⟳' : '↓'}
          </button>
          <button
            onClick={handleSaveToVault}
            disabled={savingToVault || conversation.messages.length === 0}
            className="text-text-muted hover:text-purple-400 transition-colors text-xs p-0.5 rounded"
            title="Save to Obsidian vault"
          >
            {savingToVault ? '⟳' : vaultSaved ? '✓' : '⬡'}
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); deleteConversation(conversation.id) }}
            className="text-danger hover:text-danger/80 transition-colors text-xs p-0.5 rounded"
            title="Delete conversation"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Meta row */}
      <div className="flex items-center justify-between mt-1">
        <span className="text-xs text-text-muted">{timeStr}</span>
        {conversation.totalCost > 0 && (
          <span className="text-xs text-danger/70">{formatCostBadge(conversation.totalCost)}</span>
        )}
      </div>

      {/* Tag badges */}
      {conversation.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {conversation.tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-accent/15 text-accent border border-accent/20 cursor-pointer hover:bg-danger/15 hover:text-danger hover:border-danger/20 transition-colors"
              onClick={(e) => {
                e.stopPropagation()
                // Clicking the tag filters by it
                setTagFilter(tag)
              }}
              title={`Filter by #${tag} (click ✕ to remove from conversation)`}
            >
              #{tag}
              <span
                className="opacity-0 group-hover:opacity-60 hover:!opacity-100 ml-0.5"
                onClick={(e) => { e.stopPropagation(); removeTag(conversation.id, tag) }}
                title={`Remove #${tag}`}
              >
                ✕
              </span>
            </span>
          ))}
        </div>
      )}

      {/* Inline tag input */}
      {tagging && (
        <div
          className="relative mt-1.5"
          onClick={(e) => e.stopPropagation()}
        >
          <input
            ref={tagInputRef}
            value={tagInput}
            onChange={(e) => { setTagInput(e.target.value); setShowSuggestions(true) }}
            onKeyDown={handleTagKeyDown}
            onBlur={() => { setTimeout(() => { setShowSuggestions(false); setTagging(false); setTagInput('') }, 150) }}
            placeholder="tag-name (Enter to add)"
            className="w-full text-[11px] bg-surface-elevated border border-accent/40 rounded px-2 py-1 text-text placeholder:text-text-muted focus:outline-none focus:border-accent"
          />
          {/* Suggestions dropdown */}
          {showSuggestions && suggestions.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-0.5 bg-surface border border-border rounded-lg shadow-lg z-50 overflow-hidden">
              {suggestions.map((s) => (
                <button
                  key={s}
                  onMouseDown={() => commitTag(s)}
                  className="w-full text-left px-2 py-1 text-[11px] text-text hover:bg-surface-elevated transition-colors"
                >
                  #{s}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
