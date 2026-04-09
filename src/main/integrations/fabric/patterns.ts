import { runCommandAsync } from '../../services/commandRunner'

const FABRIC_PATTERN_CACHE_TTL_MS = 60_000
let cachedFabricPatterns: { patterns: string[]; sampledAt: number } | null = null

export function parseFabricPatternList(output: string): string[] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .sort()
}

export async function listFabricPatternsCli(): Promise<string[]> {
  if (cachedFabricPatterns && Date.now() - cachedFabricPatterns.sampledAt < FABRIC_PATTERN_CACHE_TTL_MS) {
    return cachedFabricPatterns.patterns
  }

  const result = await runCommandAsync('fabric', ['--listpatterns', '--shell-complete-list'], {
    timeoutMs: 5000,
    maxOutputBytes: 512_000,
  })
  if (!result.success) {
    throw new Error(result.error || result.stderr || 'Fabric pattern listing failed')
  }

  const patterns = parseFabricPatternList(result.stdout)
  cachedFabricPatterns = { patterns, sampledAt: Date.now() }
  return patterns
}
