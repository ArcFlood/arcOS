import fs from 'fs'
import path from 'path'
import os from 'os'

export interface PluginManifest {
  id: string
  name: string
  description: string
  version: string
  icon: string
  tier: 'ollama' | 'haiku' | 'arc-sonnet'
  commands: string[]
  systemPrompt: string
  architectureRole?: 'prompt-shaper' | 'tool-surface' | 'service-integration' | 'workspace-module'
  targetStages?: string[]
  entrySurfaces?: string[]
  opensPanels?: string[]
  executionBoundary?: 'renderer' | 'main' | 'external-service'
  stability?: 'experimental' | 'stable'
}

const PLUGINS_DIR = path.join(os.homedir(), '.noah-ai-hub', 'plugins')

const SAMPLE_PLUGINS: PluginManifest[] = [
  {
    id: 'code-reviewer',
    name: 'Code Reviewer',
    description: 'Reviews code for bugs, security issues, and best practices',
    version: '1.0.0',
    icon: '🔍',
    tier: 'arc-sonnet',
    commands: ['/review', '/cr'],
    architectureRole: 'prompt-shaper',
    targetStages: ['PAI core context', 'Response Composer', 'local model'],
    entrySurfaces: ['composer-command', 'tools-panel', 'prompt-inspector'],
    opensPanels: ['tools', 'prompt_inspector', 'runtime'],
    executionBoundary: 'renderer',
    stability: 'stable',
    systemPrompt: `You are an expert code reviewer with deep knowledge of software engineering, security, and best practices across multiple languages. When given code:

1. Identify bugs, logic errors, and edge cases
2. Flag security vulnerabilities (injection, XSS, auth issues, etc.)
3. Note performance concerns and suggest optimizations
4. Check for style and maintainability issues
5. Suggest refactors with concrete examples

Format your review with clear sections. Be specific and actionable. Always explain *why* something is an issue.`,
  },
  {
    id: 'writing-coach',
    name: 'Writing Coach',
    description: 'Improves clarity, tone, and structure of written content',
    version: '1.0.0',
    icon: '✍️',
    tier: 'haiku',
    commands: ['/write', '/edit'],
    architectureRole: 'prompt-shaper',
    targetStages: ['PAI core context', 'Response Composer', 'local model'],
    entrySurfaces: ['composer-command', 'tools-panel', 'prompt-inspector'],
    opensPanels: ['tools', 'prompt_inspector'],
    executionBoundary: 'renderer',
    stability: 'stable',
    systemPrompt: `You are a professional writing coach and editor. Your goal is to make writing clearer, more compelling, and better structured.

When reviewing or writing:
- Improve clarity without changing the author's voice
- Tighten sentences — cut filler words ruthlessly
- Ensure logical flow between paragraphs
- Adjust tone to match the intended audience
- Flag passive voice when active would be stronger

Always explain your changes. Show before/after when editing existing text.`,
  },
  {
    id: 'sql-assistant',
    name: 'SQL Assistant',
    description: 'Writes, explains, and optimizes SQL queries',
    version: '1.0.0',
    icon: '🗄️',
    tier: 'haiku',
    commands: ['/sql', '/query'],
    architectureRole: 'prompt-shaper',
    targetStages: ['PAI core context', 'Response Composer', 'local model'],
    entrySurfaces: ['composer-command', 'tools-panel', 'prompt-inspector'],
    opensPanels: ['tools', 'prompt_inspector'],
    executionBoundary: 'renderer',
    stability: 'stable',
    systemPrompt: `You are an expert SQL developer specializing in query writing, optimization, and database design.

For every SQL task:
- Write clean, readable queries with proper formatting
- Explain what each part of the query does
- Suggest indexes when relevant
- Warn about performance pitfalls (N+1, missing WHERE clauses, full table scans)
- Handle edge cases (NULLs, empty sets, duplicates)

Default to PostgreSQL syntax unless the user specifies another dialect. Always wrap queries in code blocks.`,
  },
  {
    id: 'brainstorm',
    name: 'Brainstorm',
    description: 'Divergent thinking — generates ideas, alternatives, and creative options',
    version: '1.0.0',
    icon: '💡',
    tier: 'ollama',
    commands: ['/brainstorm', '/ideas'],
    architectureRole: 'prompt-shaper',
    targetStages: ['PAI core context', 'Response Composer', 'local model'],
    entrySurfaces: ['composer-command', 'tools-panel'],
    opensPanels: ['tools'],
    executionBoundary: 'renderer',
    stability: 'stable',
    systemPrompt: `You are a creative brainstorming partner. Your job is to generate diverse, unexpected, and useful ideas.

Rules:
- Generate at minimum 8–10 distinct ideas per request
- Vary the ideas across different dimensions (conservative → wild, cheap → expensive, fast → thorough)
- Don't self-censor — include unconventional ideas
- Group related ideas when there are clear clusters
- After the list, briefly note which 2–3 ideas you find most promising and why

Keep ideas concise — one sentence each. The goal is quantity and variety.`,
  },
  {
    id: 'debugger',
    name: 'Debugger',
    description: 'Diagnoses errors, stack traces, and unexpected behavior',
    version: '1.0.0',
    icon: '🐛',
    tier: 'arc-sonnet',
    commands: ['/debug', '/fix'],
    architectureRole: 'prompt-shaper',
    targetStages: ['OpenClaw', 'Fabric', 'Response Composer', 'local model'],
    entrySurfaces: ['composer-command', 'tools-panel', 'runtime', 'prompt-inspector'],
    opensPanels: ['tools', 'runtime', 'prompt_inspector', 'execution'],
    executionBoundary: 'renderer',
    stability: 'stable',
    systemPrompt: `You are an expert debugger and problem solver. When given an error, stack trace, or unexpected behavior:

1. Identify the root cause — not just the symptom
2. Explain exactly why the error occurs
3. Provide a concrete fix with code
4. Explain why the fix works
5. Suggest how to prevent the same class of error in the future

If the problem could have multiple causes, work through them systematically. Ask clarifying questions if the error context is ambiguous. Be precise about line numbers and file names when referencing code.`,
  },
]

export function ensurePluginsDir(): void {
  if (!fs.existsSync(PLUGINS_DIR)) {
    fs.mkdirSync(PLUGINS_DIR, { recursive: true })
  }
}

function normalizePluginManifest(parsed: PluginManifest): PluginManifest {
  return {
    ...parsed,
    architectureRole: parsed.architectureRole ?? 'prompt-shaper',
    targetStages: parsed.targetStages ?? ['PAI core context', 'Response Composer', 'local model'],
    entrySurfaces: parsed.entrySurfaces ?? ['composer-command', 'tools-panel'],
    opensPanels: parsed.opensPanels ?? ['tools', 'prompt_inspector'],
    executionBoundary: parsed.executionBoundary ?? 'renderer',
    stability: parsed.stability ?? 'stable',
  }
}

export function seedSamplePlugins(): void {
  ensurePluginsDir()
  // Only seed if the directory is empty (first run)
  const existing = fs.readdirSync(PLUGINS_DIR).filter((f) => f.endsWith('.json'))
  if (existing.length > 0) return

  for (const plugin of SAMPLE_PLUGINS) {
    const dest = path.join(PLUGINS_DIR, `${plugin.id}.json`)
    fs.writeFileSync(dest, JSON.stringify(plugin, null, 2), 'utf8')
  }
  console.log(`[Plugins] Seeded ${SAMPLE_PLUGINS.length} sample plugins to ${PLUGINS_DIR}`)
}

export function listPlugins(): PluginManifest[] {
  ensurePluginsDir()
  const files = fs.readdirSync(PLUGINS_DIR).filter((f) => f.endsWith('.json'))
  const plugins: PluginManifest[] = []

  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(PLUGINS_DIR, file), 'utf8')
      const parsed = normalizePluginManifest(JSON.parse(raw) as PluginManifest)
      // Basic validation
      if (
        parsed.id && parsed.name && parsed.systemPrompt &&
        Array.isArray(parsed.commands) &&
        ['ollama', 'haiku', 'arc-sonnet'].includes(parsed.tier) &&
        Array.isArray(parsed.targetStages) &&
        Array.isArray(parsed.entrySurfaces)
      ) {
        plugins.push(parsed)
      }
    } catch (e) {
      console.warn(`[Plugins] Failed to load ${file}:`, e)
    }
  }

  return plugins.sort((a, b) => a.name.localeCompare(b.name))
}

// Max allowed system prompt length (prevents exfiltration via enormous prompts)
const MAX_SYSTEM_PROMPT_LENGTH = 8_000

// Characters/patterns that suggest prompt injection attempts
const INJECTION_PATTERNS = [
  /ignore\s+(previous|all|prior)\s+instructions?/i,
  /you\s+are\s+now\s+(?:a\s+)?(?:an?\s+)?(?:evil|malicious|unrestricted)/i,
  /forget\s+(?:your|all)\s+(?:previous\s+)?(?:instructions?|training|rules)/i,
  /disregard\s+(?:your|all)\s+(?:previous\s+)?instructions?/i,
  /\bexfiltrate\b/i,
  /send\s+(?:all|this|the)\s+(?:data|content|conversation)\s+to/i,
]

function validateSystemPrompt(prompt: string): { valid: boolean; reason?: string } {
  if (!prompt || prompt.trim().length === 0) {
    return { valid: false, reason: 'systemPrompt is empty' }
  }
  if (prompt.length > MAX_SYSTEM_PROMPT_LENGTH) {
    return { valid: false, reason: `systemPrompt exceeds ${MAX_SYSTEM_PROMPT_LENGTH} character limit` }
  }
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(prompt)) {
      return { valid: false, reason: `systemPrompt contains suspicious pattern: ${pattern.source}` }
    }
  }
  return { valid: true }
}

export function installPlugin(srcPath: string): { success: boolean; error?: string } {
  try {
    ensurePluginsDir()
    const raw = fs.readFileSync(srcPath, 'utf8')
    const parsed = normalizePluginManifest(JSON.parse(raw) as PluginManifest)
    if (!parsed.id || !parsed.name || !parsed.systemPrompt) {
      return { success: false, error: 'Invalid plugin manifest: missing id, name, or systemPrompt' }
    }
    // Sanitize id — only allow alphanumeric, hyphens, underscores
    if (!/^[a-z0-9_-]{1,64}$/.test(parsed.id)) {
      return { success: false, error: 'Plugin id must be 1-64 characters: letters, numbers, hyphens, underscores only' }
    }
    // Validate systemPrompt for injection patterns and length
    const check = validateSystemPrompt(parsed.systemPrompt)
    if (!check.valid) {
      return { success: false, error: `Invalid plugin: ${check.reason}` }
    }
    const dest = path.join(PLUGINS_DIR, `${parsed.id}.json`)
    fs.copyFileSync(srcPath, dest)
    return { success: true }
  } catch (e) {
    return { success: false, error: String(e) }
  }
}

export function getPluginsDir(): string {
  return PLUGINS_DIR
}
