import fs from 'fs'
import path from 'path'
import { getOpenClawServiceInfo } from '../integrations/openclaw/runtime'
import { runCommandAsync } from './commandRunner'

export type CodingRuntimeStatus = {
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
  branchCollision: boolean
  branchCollisionDetails: string[]
  verificationCommands: string[]
  openClawControlUrl: string | null
  environment: 'development' | 'packaged'
}

type CodingRuntimePaths = {
  appPath: string
  dirname: string
  cwd: string
  environment: CodingRuntimeStatus['environment']
}

async function runGit(repoPath: string, args: string[]): Promise<string> {
  const result = await runCommandAsync('git', ['-C', repoPath, ...args], { timeoutMs: 5000 })
  if (!result.success) {
    throw new Error(result.error || result.stderr || `git ${args.join(' ')} failed`)
  }
  return result.stdout
}

async function tryGit(repoPath: string, args: string[]): Promise<string | null> {
  try {
    return await runGit(repoPath, args)
  } catch {
    return null
  }
}

async function resolveGitRepo(candidatePath: string): Promise<string | null> {
  const resolved = path.resolve(candidatePath)
  const repoRoot = await tryGit(resolved, ['rev-parse', '--show-toplevel'])
  return repoRoot ? path.resolve(repoRoot) : null
}

export async function resolveActiveRepositoryPath(paths: CodingRuntimePaths): Promise<string | null> {
  const candidates = [
    paths.appPath,
    path.resolve(paths.appPath, '..'),
    path.resolve(paths.dirname, '..', '..'),
    paths.cwd,
  ]
  for (const candidate of candidates) {
    const repo = await resolveGitRepo(candidate)
    if (repo) return repo
  }
  return null
}

function collectVerificationCommands(repoPath: string): string[] {
  const commands: string[] = []
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoPath, 'package.json'), 'utf8')) as { scripts?: Record<string, string> }
    if (pkg.scripts?.lint) commands.push('npm run lint')
    commands.push('npm exec tsc -- --noEmit')
    if (pkg.scripts?.['build:dir']) commands.push('npm run build:dir')
  } catch {
    // ignore missing or invalid package metadata
  }

  const memoryServiceTests = path.join(repoPath, 'memory-service', 'tests')
  if (fs.existsSync(memoryServiceTests)) {
    commands.push('uv run python -m unittest discover -s tests')
  }
  return [...new Set(commands)]
}

async function getWorktreeCount(repoPath: string): Promise<number> {
  const output = await tryGit(repoPath, ['worktree', 'list', '--porcelain'])
  if (!output) return 0
  return output.split('\n').filter((line) => line.startsWith('worktree ')).length
}

async function getBranchCollisionDetails(repoPath: string, activeBranch: string | null): Promise<string[]> {
  if (!activeBranch) return []
  const output = await tryGit(repoPath, ['worktree', 'list', '--porcelain'])
  if (!output) return []

  const normalizedBranchRef = `refs/heads/${activeBranch}`
  const entries: Array<{ path?: string; branch?: string }> = []
  let current: { path?: string; branch?: string } = {}

  for (const line of output.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (current.path || current.branch) entries.push(current)
      current = { path: line.slice('worktree '.length).trim() }
      continue
    }
    if (line.startsWith('branch ')) {
      current.branch = line.slice('branch '.length).trim()
    }
  }
  if (current.path || current.branch) entries.push(current)

  const matches = entries.filter((entry) => entry.branch === normalizedBranchRef)
  return matches.length > 1
    ? matches.map((entry) => entry.path ?? normalizedBranchRef)
    : []
}

export async function getCodingRuntimeStatus(paths: CodingRuntimePaths): Promise<CodingRuntimeStatus> {
  const openClawInfo = getOpenClawServiceInfo()
  const repoPath = await resolveActiveRepositoryPath(paths)

  if (!repoPath) {
    return {
      linkedWorkspacePath: openClawInfo.workspacePath,
      activeRepositoryPath: null,
      branch: null,
      headShortSha: null,
      upstream: null,
      aheadCount: 0,
      behindCount: 0,
      worktreeCount: 0,
      stagedChanges: 0,
      unstagedChanges: 0,
      untrackedFiles: 0,
      conflictCount: 0,
      dirty: false,
      staleBranch: false,
      mergeReadiness: 'unknown',
      branchCollision: false,
      branchCollisionDetails: [],
      verificationCommands: [],
      openClawControlUrl: openClawInfo.controlUrl,
      environment: paths.environment,
    }
  }

  const statusLines = ((await tryGit(repoPath, ['status', '--porcelain=v1'])) ?? '')
    .split('\n')
    .filter(Boolean)
  const branch = await tryGit(repoPath, ['branch', '--show-current']) || null
  const headShortSha = await tryGit(repoPath, ['rev-parse', '--short', 'HEAD']) || null
  const upstream = await tryGit(repoPath, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']) || null

  let aheadCount = 0
  let behindCount = 0
  if (upstream) {
    const counts = await tryGit(repoPath, ['rev-list', '--left-right', '--count', '@{upstream}...HEAD'])
    if (counts) {
      const [behindRaw, aheadRaw] = counts.split('\t')
      behindCount = Number.parseInt(behindRaw ?? '0', 10) || 0
      aheadCount = Number.parseInt(aheadRaw ?? '0', 10) || 0
    }
  }

  const stagedChanges = statusLines.filter((line) => line[0] !== ' ' && line[0] !== '?').length
  const unstagedChanges = statusLines.filter((line) => line[1] !== ' ' && line[0] !== '?').length
  const untrackedFiles = statusLines.filter((line) => line.startsWith('??')).length
  const conflictStates = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'])
  const conflictCount = statusLines.filter((line) => conflictStates.has(line.slice(0, 2))).length
  const dirty = statusLines.length > 0
  const staleBranch = branch === null || behindCount > 0 || conflictCount > 0
  const branchCollisionDetails = await getBranchCollisionDetails(repoPath, branch)

  let mergeReadiness: CodingRuntimeStatus['mergeReadiness'] = 'ready'
  if (conflictCount > 0) mergeReadiness = 'conflicted'
  else if (branchCollisionDetails.length > 0) mergeReadiness = 'pending_local_changes'
  else if (behindCount > 0) mergeReadiness = 'needs_sync'
  else if (dirty) mergeReadiness = 'pending_local_changes'

  return {
    linkedWorkspacePath: openClawInfo.workspacePath,
    activeRepositoryPath: repoPath,
    branch,
    headShortSha,
    upstream,
    aheadCount,
    behindCount,
    worktreeCount: await getWorktreeCount(repoPath),
    stagedChanges,
    unstagedChanges,
    untrackedFiles,
    conflictCount,
    dirty,
    staleBranch,
    mergeReadiness,
    branchCollision: branchCollisionDetails.length > 0,
    branchCollisionDetails,
    verificationCommands: collectVerificationCommands(repoPath),
    openClawControlUrl: openClawInfo.controlUrl,
    environment: paths.environment,
  }
}
