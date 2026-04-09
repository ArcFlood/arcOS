import fs from 'fs'
import os from 'os'
import path from 'path'

export type MemoryHygieneCandidate = {
  id: string
  title: string
  filePath: string
  source: 'learnings' | 'vault'
  reason: string
  sizeBytes: number
  preview: string
  modifiedAt: string
}

export function memoryHygieneRoots(vaultPath?: string): Array<{ source: MemoryHygieneCandidate['source']; root: string }> {
  const roots: Array<{ source: MemoryHygieneCandidate['source']; root: string }> = [
    { source: 'learnings', root: path.join(os.homedir(), '.noah-ai-hub', 'history', 'learnings') },
  ]
  if (vaultPath) {
    roots.push({ source: 'vault', root: path.join(vaultPath, 'arcos') })
  }
  return roots
}

function collectMarkdownFiles(root: string, limit = 400): string[] {
  if (!fs.existsSync(root)) return []
  const results: string[] = []
  const stack = [root]
  while (stack.length > 0 && results.length < limit) {
    const current = stack.pop()
    if (!current) continue
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(fullPath)
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        results.push(fullPath)
        if (results.length >= limit) break
      }
    }
  }
  return results
}

function normalizeMemoryBody(content: string): string {
  return content
    .replace(/^---[\s\S]*?---\s*/m, '')
    .replace(/^# .+$/gm, '')
    .replace(/^\*\*(Source|Model|Date|Tags):\*\*.*$/gm, '')
    .replace(/^_Saved from ARCOS_$/gm, '')
    .replace(/^_Generated automatically by ARCOS_$/gm, '')
    .replace(/^## Content$/gm, '')
    .replace(/^---$/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function isLowValuePrompt(text: string): boolean {
  const body = normalizeMemoryBody(text)
    .replace(/^(answer|summary|analysis|actions|results|status|capture|next|completed)\s*:/gim, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!body) return true
  if (body.length < 8) return true
  return /^(test|testing|hello|hi|hey|ok|okay|thanks|thank you|n\/a|none)$/i.test(body)
}

function extractArcosArchiveUserMessages(content: string): string[] {
  if (!/^source:\s*arcos$/m.test(content)) return []
  const matches = content.matchAll(/\*\*User:\*\*\s*\n\n([\s\S]*?)(?=\n\n---\n\n\*\*(?:User|Assistant):\*\*|$)/g)
  return Array.from(matches, (match) => match[1]?.trim() ?? '').filter(Boolean)
}

function arcosArchiveCandidateReason(content: string): string | null {
  const userMessages = extractArcosArchiveUserMessages(content)
  if (userMessages.length === 0) return null
  if (userMessages.every(isLowValuePrompt)) {
    return 'Archived conversation only contains low-value test/greeting prompts'
  }
  return null
}

function memoryCandidateReason(content: string, seenBodies: Set<string>): string | null {
  const archiveReason = arcosArchiveCandidateReason(content)
  if (archiveReason) return archiveReason
  const body = normalizeMemoryBody(content)
  if (!body) return 'Empty memory body'
  if (body.length < 40) return 'Very short memory body'
  if (/^(test|testing|hello|hi|ok|okay|thanks|thank you|n\/a|none)$/i.test(body)) return 'Low-value placeholder content'
  if (/^(answer|summary|results|next|completed)\s*:\s*$/i.test(body)) return 'Empty PAI response section'
  const duplicateKey = body.toLowerCase()
  if (seenBodies.has(duplicateKey)) return 'Duplicate memory body'
  seenBodies.add(duplicateKey)
  return null
}

function buildMemoryHygieneCandidate(
  filePath: string,
  source: MemoryHygieneCandidate['source'],
  seenBodies: Set<string>,
): MemoryHygieneCandidate | null {
  const content = fs.readFileSync(filePath, 'utf8')
  const stat = fs.statSync(filePath)
  const reason = stat.size < 1024
    ? 'Memory file is under 1 KB'
    : memoryCandidateReason(content, seenBodies)
  if (!reason) return null
  const body = normalizeMemoryBody(content)
  const title = content.match(/^#\s+(.+)$/m)?.[1]?.trim() || path.basename(filePath)
  return {
    id: Buffer.from(filePath).toString('base64url'),
    title,
    filePath,
    source,
    reason,
    sizeBytes: stat.size,
    preview: body.slice(0, 220) || '(empty)',
    modifiedAt: stat.mtime.toISOString(),
  }
}

export function scanMemoryHygieneCandidates(vaultPath?: string): MemoryHygieneCandidate[] {
  const seenBodies = new Set<string>()
  return memoryHygieneRoots(vaultPath)
    .flatMap(({ source, root }) => collectMarkdownFiles(root).map((filePath) => ({ source, filePath })))
    .sort((a, b) => a.filePath.localeCompare(b.filePath))
    .flatMap(({ source, filePath }) => {
      try {
        const candidate = buildMemoryHygieneCandidate(filePath, source, seenBodies)
        return candidate ? [candidate] : []
      } catch {
        return []
      }
    })
}
