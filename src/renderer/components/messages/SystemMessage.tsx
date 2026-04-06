import { Message } from '../../stores/types'

export default function SystemMessage({ message }: { message: Message }) {
  return (
    <div className="flex justify-center">
      <div className="max-w-[90%]">
        <div className="mb-1.5 flex items-center justify-center px-1">
          <span className="text-xs font-medium uppercase tracking-wider text-text-dim">System</span>
        </div>
        <div className="bg-surface-elevated border border-border rounded-full px-4 py-1.5 text-xs text-text-muted italic text-center">
          {message.content}
        </div>
      </div>
    </div>
  )
}
