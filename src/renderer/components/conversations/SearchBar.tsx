import { useConversationStore } from '../../stores/conversationStore'

export default function SearchBar() {
  const searchQuery = useConversationStore((s) => s.searchQuery)
  const setSearchQuery = useConversationStore((s) => s.setSearchQuery)
  return (
    <div className="relative">
      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted text-xs pointer-events-none">
        🔍
      </span>
      <input
        type="text"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        placeholder="Search sessions..."
        className="arcos-input w-full rounded-md pl-7 pr-3 py-2 text-xs"
      />
    </div>
  )
}
