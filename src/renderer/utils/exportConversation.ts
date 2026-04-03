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
      const modelNote = m.model ? ` *(${MODEL_LABELS[m.model] ?? m.model})*` : ''
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
 * Write conversation directly into the Obsidian vault as an arc-hub source file.
 * Path: <VAULT_PATH>/arc-hub/YYYY-MM-DD_slug.md
 * Returns { success, filePath?, error? }
 */
export async function saveConversationToVault(
  conversation: Conversation
): Promise<{ success: boolean; filePath?: string; error?: string }> {
  return window.electron.memoryVaultWrite({
    title: conversation.title,
    createdAt: conversation.createdAt,
    messages: conversation.messages.map((m) => ({
      role: m.role,
      content: m.content,
      model: m.model ?? undefined,
    })),
    tags: conversation.tags,
    totalCost: conversation.totalCost,
  })
}
