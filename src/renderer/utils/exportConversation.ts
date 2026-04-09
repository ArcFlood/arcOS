import { Conversation } from '../stores/types'

const ROLE_LABELS: Record<string, string> = {
  user: 'You',
  assistant: 'A.R.C.',
  system: 'System',
}

const MODEL_LABELS: Record<string, string> = {
  ollama: 'Local (Ollama)',
  haiku: 'Claude Haiku',
  'arc-sonnet': 'Claude Sonnet (A.R.C.)',
}

type SessionSummaryPayload = {
  startedAt: number
  endedAt: number
  messages: Array<{ role: string; content: string; model?: string; cost?: number }>
  modelBreakdown: { ollama: number; haiku: number; sonnet: number; opus: number }
  totalCost: number
  fabricPatternsUsed: string[]
  arcCalls: number
}

/**
 * Convert a Conversation to a Markdown string suitable for export.
 */
export function conversationToMarkdown(conversation: Conversation): string {
  const date = new Date(conversation.createdAt).toLocaleString()
  const totalCost = conversation.totalCost > 0 ? `$${conversation.totalCost.toFixed(4)}` : 'Free'

  const header = [
    `# ${conversation.title}`,
    '',
    `**Date:** ${date}`,
    `**Total Cost:** ${totalCost}`,
    conversation.tags.length > 0 ? `**Tags:** ${conversation.tags.join(', ')}` : null,
    '',
    '---',
    '',
  ]
    .filter((l) => l !== null)
    .join('\n')

  const messages = conversation.messages
    .filter((m) => m.role !== 'system') // omit routing system messages
    .map((m) => {
      const label = ROLE_LABELS[m.role] ?? m.role
      const modelNote = m.model ? ` *(${m.modelLabel ?? MODEL_LABELS[m.model] ?? m.model})*` : ''
      const costNote = m.cost && m.cost > 0 ? ` — $${m.cost.toFixed(5)}` : ''
      const time = new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

      return [
        `### ${label}${modelNote}${costNote} · ${time}`,
        '',
        m.content,
        '',
      ].join('\n')
    })
    .join('\n')

  return header + messages
}

/**
 * Trigger native Save dialog and write the conversation as Markdown.
 * Returns true on success.
 */
export async function exportConversationAsMd(conversation: Conversation): Promise<boolean> {
  const content = conversationToMarkdown(conversation)
  const result = await window.electron.saveConversationMd({
    title: conversation.title,
    content,
  })
  return result.success
}

/**
 * Write conversation directly into the Obsidian vault as an arcos source file.
 * Path: <VAULT_PATH>/arcos/YYYY-MM-DD_slug.md
 * Returns { success, filePath?, error? }
 */
export async function saveConversationToVault(
  conversation: Conversation
): Promise<{ success: boolean; filePath?: string; error?: string }> {
  return window.electron.memoryVaultWrite({
    conversationId: conversation.id,
    title: conversation.title,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    messages: conversation.messages.map((m) => ({
      role: m.role,
      content: m.content,
      model: m.model ?? undefined,
      modelLabel: m.modelLabel ?? undefined,
    })),
    tags: conversation.tags,
    totalCost: conversation.totalCost,
  })
}

function conversationSessionSummaryData(conversation: Conversation): SessionSummaryPayload {
  const modelBreakdown = { ollama: 0, haiku: 0, sonnet: 0, opus: 0 }
  for (const message of conversation.messages) {
    if (message.role === 'system') continue
    if (message.model === 'haiku') modelBreakdown.haiku += 1
    else if (message.model === 'arc-sonnet') modelBreakdown.sonnet += 1
    else if (message.model === 'arc-opus') modelBreakdown.opus += 1
    else modelBreakdown.ollama += 1
  }

  return {
    startedAt: conversation.createdAt,
    endedAt: conversation.updatedAt || Date.now(),
    messages: conversation.messages.map((message) => ({
      role: message.role,
      content: message.content,
      model: message.model ?? undefined,
      cost: message.cost,
    })),
    modelBreakdown,
    totalCost: conversation.totalCost,
    fabricPatternsUsed: [],
    arcCalls: conversation.messages.filter((message) => message.model === 'arc-sonnet' || message.model === 'arc-opus').length,
  }
}

export async function writeConversationSessionSummary(
  conversation: Conversation
): Promise<{ success: boolean; filePath?: string; error?: string }> {
  return window.electron.sessionWriteSummary({
    data: conversationSessionSummaryData(conversation),
  })
}

export async function archiveConversationToMemory(
  conversation: Conversation
): Promise<{ success: boolean; vaultPath?: string; sessionPath?: string; error?: string }> {
  const vaultResult = await saveConversationToVault(conversation)
  if (!vaultResult.success) {
    return { success: false, error: vaultResult.error ?? 'Archive failed' }
  }

  const sessionResult = await writeConversationSessionSummary(conversation)
  if (!sessionResult.success) {
    return {
      success: false,
      vaultPath: vaultResult.filePath,
      error: sessionResult.error ?? 'Archive saved to memory vault, but session summary failed.',
    }
  }

  return {
    success: true,
    vaultPath: vaultResult.filePath,
    sessionPath: sessionResult.filePath,
  }
}
