/**
 * tools.ts — ARCOS Tool Surface Registry (Item 21).
 *
 * Explicitly enumerates all tools available in the ARCOS runtime.
 * Makes the tool surface auditable and lets the UI reflect what's active.
 *
 * Tool entries include:
 *   - id, name, description
 *   - permissions[]  — what access the tool needs
 *   - active         — whether the tool is currently available
 *   - source         — 'builtin' | 'mcp' | 'plugin'
 *   - category       — grouping for display
 */

export type ArcToolPermission = 'none' | 'read' | 'write' | 'execute' | 'network'
export type ArcToolSource = 'builtin' | 'mcp' | 'plugin'
export type ArcToolCategory = 'filesystem' | 'memory' | 'ai' | 'system' | 'fabric' | 'runtime'

export interface ArcTool {
  id: string
  name: string
  description: string
  permissions: ArcToolPermission[]
  active: boolean
  source: ArcToolSource
  category: ArcToolCategory
}

// ── Built-in tool definitions ─────────────────────────────────────

export const BUILTIN_TOOLS: ArcTool[] = [
  // ── Filesystem ─────────────────────────────────────────────────
  {
    id: 'vault_write',
    name: 'Vault Write',
    description: 'Write files to the ArcVault directory (~/.noah-ai-hub/vault/)',
    permissions: ['write'],
    active: true,
    source: 'builtin',
    category: 'filesystem',
  },
  {
    id: 'conversation_export',
    name: 'Conversation Export',
    description: 'Export conversation history to Markdown in the vault',
    permissions: ['write'],
    active: true,
    source: 'builtin',
    category: 'filesystem',
  },
  {
    id: 'session_summary_write',
    name: 'Session Summary Write',
    description: 'Persist session summaries to ~/.noah-ai-hub/sessions/',
    permissions: ['write'],
    active: true,
    source: 'builtin',
    category: 'filesystem',
  },
  {
    id: 'learning_save',
    name: 'Learning Save',
    description: 'Save bookmarked insights to ~/.noah-ai-hub/learnings/',
    permissions: ['write'],
    active: true,
    source: 'builtin',
    category: 'filesystem',
  },
  {
    id: 'open_path',
    name: 'Open Path',
    description: 'Open a file or directory in the default system app',
    permissions: ['execute'],
    active: true,
    source: 'builtin',
    category: 'filesystem',
  },

  // ── Memory ─────────────────────────────────────────────────────
  {
    id: 'memory_query',
    name: 'Memory Query',
    description: 'Semantic search over ARC-Memory via hybrid + HyDE re-ranking',
    permissions: ['network'],
    active: true,
    source: 'mcp',
    category: 'memory',
  },
  {
    id: 'memory_ingest',
    name: 'Memory Ingest',
    description: 'Trigger Obsidian vault ingest into ARC-Memory vector store',
    permissions: ['network', 'read'],
    active: true,
    source: 'mcp',
    category: 'memory',
  },

  // ── AI ─────────────────────────────────────────────────────────
  {
    id: 'ollama_stream',
    name: 'Ollama Stream',
    description: 'Stream inference from local Ollama models (qwen3:14b default)',
    permissions: ['network'],
    active: true,
    source: 'builtin',
    category: 'ai',
  },
  {
    id: 'claude_stream',
    name: 'Claude Stream',
    description: 'Stream inference from Anthropic Claude (Haiku / Sonnet / Opus)',
    permissions: ['network'],
    active: true,
    source: 'builtin',
    category: 'ai',
  },
  {
    id: 'openclaw_analyze',
    name: 'OpenClaw Analyze',
    description: 'Run OpenClaw intent analysis and routing recommendation',
    permissions: ['network'],
    active: true,
    source: 'builtin',
    category: 'ai',
  },

  // ── Fabric ─────────────────────────────────────────────────────
  {
    id: 'fabric_list_patterns',
    name: 'Fabric Pattern List',
    description: 'Enumerate available Fabric prompt patterns from local install',
    permissions: ['network'],
    active: true,
    source: 'builtin',
    category: 'fabric',
  },
  {
    id: 'fabric_run_pattern',
    name: 'Fabric Run Pattern',
    description: 'Execute a Fabric pattern against a prompt and stream results',
    permissions: ['network'],
    active: true,
    source: 'builtin',
    category: 'fabric',
  },

  // ── Runtime ────────────────────────────────────────────────────
  {
    id: 'coding_runtime_status',
    name: 'Coding Runtime Status',
    description: 'Read git branch, SHA, worktree count, and merge readiness',
    permissions: ['execute'],
    active: true,
    source: 'builtin',
    category: 'runtime',
  },
  {
    id: 'ollama_pull_model',
    name: 'Ollama Pull Model',
    description: 'Download a model from the Ollama registry with progress streaming',
    permissions: ['network', 'write'],
    active: true,
    source: 'builtin',
    category: 'runtime',
  },
  {
    id: 'ollama_delete_model',
    name: 'Ollama Delete Model',
    description: 'Remove a locally installed Ollama model by name',
    permissions: ['execute'],
    active: true,
    source: 'builtin',
    category: 'runtime',
  },

  // ── System ─────────────────────────────────────────────────────
  {
    id: 'hook_emit',
    name: 'Hook Emit',
    description: 'Emit a hook event into the ARCOS event bus for observability',
    permissions: ['none'],
    active: true,
    source: 'builtin',
    category: 'system',
  },
  {
    id: 'log_append',
    name: 'Log Append',
    description: 'Append a structured log entry to the ARCOS error log',
    permissions: ['write'],
    active: true,
    source: 'builtin',
    category: 'system',
  },
  {
    id: 'audit_run',
    name: 'Audit Run',
    description: 'Execute the 7-check system audit and save the report',
    permissions: ['network', 'write'],
    active: true,
    source: 'builtin',
    category: 'system',
  },
  {
    id: 'bug_report_submit',
    name: 'Bug Report Submit',
    description: 'Capture environment snapshot and submit bug report to GitHub or save locally',
    permissions: ['execute', 'network', 'write'],
    active: true,
    source: 'builtin',
    category: 'system',
  },
  {
    id: 'discord_send',
    name: 'Discord Send',
    description: 'Send a message to a monitored Discord channel via bot token',
    permissions: ['network'],
    active: true,
    source: 'builtin',
    category: 'system',
  },
  {
    id: 'spending_export_csv',
    name: 'Spending Export CSV',
    description: 'Export cost records to CSV for external analysis',
    permissions: ['write'],
    active: true,
    source: 'builtin',
    category: 'system',
  },
]

/**
 * Returns the full tool list, merging built-ins with any additional tools
 * from MCP servers or plugins (passed in as extras).
 */
export function getToolRegistry(extras: ArcTool[] = []): ArcTool[] {
  const seen = new Set(BUILTIN_TOOLS.map((t) => t.id))
  const deduped = extras.filter((t) => !seen.has(t.id))
  return [...BUILTIN_TOOLS, ...deduped]
}

/** Tools grouped by category for display purposes. */
export function getToolsByCategory(extras: ArcTool[] = []): Record<ArcToolCategory, ArcTool[]> {
  const all = getToolRegistry(extras)
  return {
    filesystem: all.filter((t) => t.category === 'filesystem'),
    memory:     all.filter((t) => t.category === 'memory'),
    ai:         all.filter((t) => t.category === 'ai'),
    system:     all.filter((t) => t.category === 'system'),
    fabric:     all.filter((t) => t.category === 'fabric'),
    runtime:    all.filter((t) => t.category === 'runtime'),
  }
}
