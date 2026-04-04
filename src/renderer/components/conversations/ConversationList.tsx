import { useConversationStore } from '../../stores/conversationStore'
import NewChatButton from './NewChatButton'
import SearchBar from './SearchBar'
import ConversationItem from './ConversationItem'

export default function ConversationList() {
  const filtered = useConversationStore((s) => s.filteredConversations())
  const activeId = useConversationStore((s) => s.activeConversationId)
  const tagFilter = useConversationStore((s) => s.tagFilter)
  const setTagFilter = useConversationStore((s) => s.setTagFilter)
  const getAllTags = useConversationStore((s) => s.getAllTags)

  const allTags = getAllTags()

  return (
    <div className="flex flex-col h-full px-3 py-3 gap-2">
      <NewChatButton />
      <SearchBar />

      {/* Tag filter chips */}
      {allTags.length > 0 && (
        <div className="flex flex-wrap gap-1 px-0.5">
          {allTags.map((tag) => (
            <button
              key={tag}
              onClick={() => setTagFilter(tagFilter === tag ? null : tag)}
              className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full border transition-colors ${
                tagFilter === tag
                  ? 'bg-[#3d4957] text-text border-[#7e90a2]'
                  : 'bg-transparent text-text-muted border-border hover:border-[#7e90a2]/50 hover:text-text'
              }`}
            >
              #{tag}
            </button>
          ))}
          {tagFilter && (
            <button
              onClick={() => setTagFilter(null)}
              className="text-[10px] text-text-muted hover:text-danger transition-colors px-1"
              title="Clear tag filter"
            >
              clear
            </button>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto space-y-1 mt-1">
        {filtered.length === 0 ? (
          <p className="text-xs text-text-muted text-center py-4 italic">
            {tagFilter ? `No conversations tagged #${tagFilter}` : 'No conversations yet'}
          </p>
        ) : (
          filtered.map((conv) => (
            <ConversationItem
              key={conv.id}
              conversation={conv}
              isActive={conv.id === activeId}
            />
          ))
        )}
      </div>
    </div>
  )
}
