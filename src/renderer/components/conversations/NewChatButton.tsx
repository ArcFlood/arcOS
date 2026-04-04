import { useConversationStore } from '../../stores/conversationStore'

export default function NewChatButton() {
  const createConversation = useConversationStore((s) => s.createConversation)
  return (
    <button
      onClick={() => createConversation()}
      className="arcos-action-primary w-full flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors"
    >
      <span className="text-base leading-none">+</span>
      <span>New Session</span>
    </button>
  )
}
