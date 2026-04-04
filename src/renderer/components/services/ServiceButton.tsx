interface Props {
  label: string
  onClick: () => void
  disabled?: boolean
  variant?: 'start' | 'stop' | 'restart'
}

const styles = {
  start: 'border-success/40 text-success hover:bg-success/10',
  stop: 'border-danger/40 text-danger hover:bg-danger/10',
  restart: 'border-warning/40 text-warning hover:bg-warning/10',
}

export default function ServiceButton({ label, onClick, disabled, variant = 'start' }: Props) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded-md border bg-[#12161b] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${styles[variant]}`}
    >
      {label}
    </button>
  )
}
