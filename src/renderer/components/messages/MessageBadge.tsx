import { ModelTier, MODEL_REGISTRY } from '../../stores/types'
import { formatCostBadge } from '../../utils/formatCurrency'

interface Props {
  tier: ModelTier
  cost?: number
}

export default function MessageBadge({ tier, cost }: Props) {
  const info = MODEL_REGISTRY[tier]
  const colorMap: Record<ModelTier, string> = {
    ollama: 'text-success',
    haiku: 'text-haiku-accent',
    'arc-sonnet': 'text-arc-accent',
    'arc-opus': 'text-pink-400',
  }

  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${colorMap[tier]}`}>
      <span>{info.emoji}</span>
      <span>{info.displayName}</span>
      {cost !== undefined && cost > 0 && (
        <span className="text-danger opacity-70">({formatCostBadge(cost)})</span>
      )}
    </span>
  )
}
