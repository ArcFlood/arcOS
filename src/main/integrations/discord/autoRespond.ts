import { setAutoRespondHandler } from '../../discord/discordGateway'

export function configureDiscordAutoRespond(): void {
  setAutoRespondHandler(async (message, _channelId, projectName) => {
    try {
      const systemPrompt = [
        'You are A.R.C. (AI Reasoning Companion), a personal AI assistant embedded in the ARCOS workspace.',
        `You are responding to a Discord message in the project channel: "${projectName}".`,
        'Keep your response concise and actionable. Respond in plain text (no markdown formatting).',
        'This is a lightweight channel response — be brief.',
      ].join('\n')

      const ollamaRes = await fetch('http://localhost:11434/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'qwen3:8b',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: message.content },
          ],
          stream: false,
        }),
        signal: AbortSignal.timeout(30000),
      })
      if (!ollamaRes.ok) return null
      const data = await ollamaRes.json() as { message?: { content?: string } }
      return data.message?.content ?? null
    } catch {
      return null
    }
  })
}
