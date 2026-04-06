import { Message } from '../../stores/types'
import CopyButton from './CopyButton'

export default function UserMessage({ message }: { message: Message }) {
  return (
    <div className="flex justify-end group">
      <div className="relative max-w-[75%]">
        <div className="mb-1.5 flex items-center justify-end gap-2 px-1">
          <span className="inline-flex items-center gap-1 text-xs font-medium text-text-muted">
            <span>You</span>
          </span>
        </div>
        <div className="bg-accent text-white px-4 py-3 rounded-2xl rounded-tr-sm selectable">
          <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">
            {message.content}
          </p>
        </div>
        <div className="flex justify-end items-center gap-2 mt-1 px-1">
          <span className="text-xs text-text-muted">
            {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
          <CopyButton text={message.content} />
        </div>
      </div>
    </div>
  )
}
