// ── Model Types ───────────────────────────────────────────────────
// 4-tier system per PRD v2:
//   ollama      → Free local (Qwen 3 14B default)
//   haiku       → Cheap cloud ($1/$5 per MTok)
//   arc-sonnet  → Premium cloud with A.R.C. ($3/$15 per MTok)
//   arc-opus    → Manual-only ($5/$25 per MTok) — never auto-routed
export type ModelTier = 'ollama' | 'haiku' | 'arc-sonnet' | 'arc-opus'

export interface ModelInfo {
  tier: ModelTier
  displayName: string
  modelId: string
  costPer1MInput: number
  costPer1MOutput: number
  emoji: string
  color: string
  manualOnly?: boolean   // if true, never auto-routed
}

export const MODEL_REGISTRY: Record<ModelTier, ModelInfo> = {
  ollama: {
    tier: 'ollama',
    displayName: 'Local',
    modelId: 'qwen3:14b',
    costPer1MInput: 0,
    costPer1MOutput: 0,
    emoji: '💻',
    color: '#10b981',
  },
  haiku: {
    tier: 'haiku',
    displayName: 'Haiku',
    modelId: 'claude-haiku-4-5-20251001',
    costPer1MInput: 1.0,
    costPer1MOutput: 5.0,
    emoji: '⚡',
    color: '#f59e0b',
  },
  'arc-sonnet': {
    tier: 'arc-sonnet',
    displayName: 'A.R.C.',
    modelId: 'claude-sonnet-4-6',
    costPer1MInput: 3.0,
    costPer1MOutput: 15.0,
    emoji: '🧠',
    color: '#8b5cf6',
  },
  'arc-opus': {
    tier: 'arc-opus',
    displayName: 'A.R.C. Opus',
    modelId: 'claude-opus-4-6',
    costPer1MInput: 5.0,
    costPer1MOutput: 25.0,
    emoji: '🔮',
    color: '#ec4899',
    manualOnly: true,
  },
}

// ── Message & Conversation ────────────────────────────────────────

/**
 * Structured task metadata that can be attached to a message.
 * Stored as metadata, never embedded in the prompt string.
 */
export interface TaskPacket {
  objective: string
  scope?: string
  modelConstraint?: ModelTier | null
  maxTokens?: number
  expectedOutputFormat?: 'prose' | 'json' | 'code' | 'list' | 'table'
  retryPolicy?: 'none' | 'once' | 'twice'
}

export interface Message {
  id: string
  conversationId: string
  role: 'user' | 'assistant' | 'system'
  content: string
  thinkingContent?: string
  model: ModelTier | null
  modelLabel?: string
  cost: number
  timestamp: number
  routingReason?: string
  isStreaming?: boolean
  /** Optional structured task metadata (Item 19) */
  taskPacket?: TaskPacket
}

/**
 * Conversation status — replaces scattered isLoading booleans.
 * Enables retry logic on blocked state and proper cleanup on finished.
 */
export type ConversationStatus =
  | 'idle'        // no active request
  | 'sending'     // request dispatched, awaiting first token
  | 'streaming'   // receiving token stream
  | 'blocked'     // request blocked (budget, permission, etc.)
  | 'error'       // last request ended with an error
  | 'finished'    // last request completed successfully

export interface Conversation {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  tags: string[]
  totalCost: number
  messages: Message[]
  /** Session state machine status (Item 16) */
  status: ConversationStatus
}

// ── Service ───────────────────────────────────────────────────────
export type ServiceName = 'ollama' | 'fabric' | 'arc-memory' | 'openclaw'

export interface ServiceLink {
  label: string
  target: string
  kind: 'url' | 'path'
}

export interface ServiceStatus {
  name: ServiceName
  displayName: string
  running: boolean
  port: number
  pid?: number
  checking: boolean
  error?: string
  manageable?: boolean
  managementNote?: string
  detailLines?: string[]
  links?: ServiceLink[]
}

export interface LocalModelInfo {
  name: string
  sizeBytes: number
  modifiedAt?: string
  family?: string
  parameterSize?: string
  quantizationLevel?: string
}

// ── Settings ──────────────────────────────────────────────────────
export type RoutingMode = 'auto' | 'ollama' | 'haiku' | 'arc-sonnet' | 'arc-opus'
export type RoutingAggressiveness = 'cost-first' | 'balanced' | 'quality-first'
export type AppearanceTheme = 'default' | 'star-wars' | 'lord-of-the-rings' | 'matrix'

export type PluginArchitectureRole = 'prompt-shaper' | 'tool-surface' | 'service-integration' | 'workspace-module'
export type PluginExecutionBoundary = 'renderer' | 'main' | 'external-service'
export type PluginStability = 'experimental' | 'stable'

export interface AppSettings {
  // Note: Claude API key is NOT stored here — it lives in main process only.
  // Use window.electron.apiKeySet / apiKeyHas from the renderer.
  ollamaModel: string
  dailyBudgetLimit: number
  monthlyBudgetLimit: number
  budgetWarnLimit: number        // PRD v2: warn at this monthly spend
  autoStartOllama: boolean
  autoStartFabric: boolean
  routingMode: RoutingMode
  routingAggressiveness: RoutingAggressiveness
  extendedThinking: boolean
  showRoutingReasons: boolean
  appearanceTheme: AppearanceTheme
  appearanceFont: string
  appearanceTextColor: string
  appearanceAccentColor: string
  appearanceAccentSecondaryColor: string
  responseTunerIdentity: string
  responseTunerStyle: string
  responseTunerInstructions: string
}

// ── Plugin ────────────────────────────────────────────────────────

/** Lifecycle hooks attached to a plugin manifest (Item 18). */
export interface PluginHooks {
  onActivate?: string
  onDeactivate?: string
  beforeMessage?: string
}

export interface Plugin {
  id: string
  name: string
  description: string
  version: string
  icon: string
  tier: ModelTier
  commands: string[]
  systemPrompt: string
  architectureRole: PluginArchitectureRole
  targetStages: string[]
  entrySurfaces: string[]
  opensPanels?: string[]
  executionBoundary: PluginExecutionBoundary
  stability: PluginStability
  /** Optional lifecycle hooks (Item 18) */
  hooks?: PluginHooks
}

export interface CodingRuntimeStatus {
  linkedWorkspacePath: string
  activeRepositoryPath: string | null
  branch: string | null
  headShortSha: string | null
  upstream: string | null
  aheadCount: number
  behindCount: number
  worktreeCount: number
  stagedChanges: number
  unstagedChanges: number
  untrackedFiles: number
  conflictCount: number
  dirty: boolean
  staleBranch: boolean
  mergeReadiness: 'ready' | 'needs_sync' | 'pending_local_changes' | 'conflicted' | 'unknown'
  verificationCommands: string[]
  openClawControlUrl: string | null
  environment: 'development' | 'packaged'
}

// ── Cost ──────────────────────────────────────────────────────────
export interface SpendingRecord {
  id: string
  date: string
  amount: number
  model: ModelTier
  conversationId?: string
}

export interface CostSummary {
  today: number
  week: number
  month: number
}
