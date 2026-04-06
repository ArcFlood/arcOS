interface Props {
  running: boolean
  checking?: boolean
  warning?: boolean
  size?: 'sm' | 'md'
}

export default function StatusIndicator({ running, checking, warning, size = 'sm' }: Props) {
  const dim = size === 'md' ? 'w-2.5 h-2.5' : 'w-2 h-2'

  if (checking) {
    return (
      <span className={`${dim} rounded-full bg-warning animate-pulse inline-block`} />
    )
  }

  if (warning) {
    return (
      <span className="relative inline-flex">
        <span className={`absolute inline-flex ${dim} rounded-full bg-warning opacity-60 animate-ping`} />
        <span className={`relative inline-flex ${dim} rounded-full bg-warning`} />
      </span>
    )
  }

  if (running) {
    return (
      <span className="relative inline-flex">
        {/* Outer pulse ring */}
        <span className={`absolute inline-flex ${dim} rounded-full bg-success opacity-60 animate-ping`} />
        {/* Solid inner dot */}
        <span className={`relative inline-flex ${dim} rounded-full bg-success`} />
      </span>
    )
  }

  return <span className={`${dim} rounded-full inline-block bg-danger`} />
}
