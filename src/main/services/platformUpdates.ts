import fs from 'fs'
import os from 'os'
import path from 'path'
import { parseFabricPatternList } from '../integrations/fabric/patterns'
import { runCommandAsync } from './commandRunner'

export type PlatformUpdateTarget = {
  id: 'openclaw' | 'fabric' | 'pai' | 'claude-parity'
  name: string
  status: 'ok' | 'warning' | 'error' | 'unknown'
  installed: boolean
  version?: string
  localPath?: string
  detail: string
  manualCheck: string
  manualUpdate: string
  lastChecked: string
}

export type PlatformUpdateCheck = {
  success: boolean
  checkedAt: string
  policy: 'check-only-manual-approval'
  targets: PlatformUpdateTarget[]
  error?: string
}

export type OpenClawRuntime = {
  nodePath: string
  openClawPath: string
  version: string
}

async function runLocalCommand(command: string, args: string[], cwd?: string): Promise<{ success: boolean; stdout: string; error?: string }> {
  const result = await runCommandAsync(command, args, { cwd, timeoutMs: 5000 })
  return { success: result.success, stdout: result.stdout, error: result.error || result.stderr || undefined }
}

async function gitMaintenanceStatus(repoPath: string): Promise<{ exists: boolean; isGit: boolean; detail: string; version?: string }> {
  if (!fs.existsSync(repoPath)) {
    return { exists: false, isGit: false, detail: `Path not found: ${repoPath}` }
  }
  const gitDir = await runLocalCommand('git', ['-C', repoPath, 'rev-parse', '--show-toplevel'])
  if (!gitDir.success) {
    return { exists: true, isGit: false, detail: 'Path exists, but it is not a Git repository.' }
  }
  const branch = (await runLocalCommand('git', ['-C', repoPath, 'branch', '--show-current'])).stdout || 'detached'
  const head = (await runLocalCommand('git', ['-C', repoPath, 'rev-parse', '--short', 'HEAD'])).stdout || 'unknown'
  const upstream = (await runLocalCommand('git', ['-C', repoPath, 'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'])).stdout
  const shortStatus = (await runLocalCommand('git', ['-C', repoPath, 'status', '--short'])).stdout
  const dirtyCount = shortStatus ? shortStatus.split('\n').filter(Boolean).length : 0
  const upstreamText = upstream ? `upstream ${upstream}` : 'no upstream configured'
  const dirtyText = dirtyCount > 0 ? `${dirtyCount} local change${dirtyCount === 1 ? '' : 's'} present` : 'clean worktree'
  return {
    exists: true,
    isGit: true,
    version: head,
    detail: `${branch} @ ${head}; ${upstreamText}; ${dirtyText}. Remote freshness requires a manual fetch.`,
  }
}

export async function getPlatformUpdateCheck(findOpenClawRuntime: () => OpenClawRuntime): Promise<PlatformUpdateCheck> {
  const checkedAt = new Date().toISOString()
  const targets: PlatformUpdateTarget[] = []

  try {
    const runtime = findOpenClawRuntime()
    let openClawVersion = runtime.version
    const packagePath = path.join(path.dirname(runtime.openClawPath), 'package.json')
    try {
      const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8')) as { version?: string }
      if (pkg.version) openClawVersion = pkg.version
    } catch {
      // Runtime version is still useful if package metadata is unavailable.
    }
    targets.push({
      id: 'openclaw',
      name: 'OpenClaw',
      status: 'ok',
      installed: true,
      version: openClawVersion,
      localPath: runtime.openClawPath,
      detail: `OpenClaw runtime found under Node ${runtime.version}. Remote update status is not checked automatically.`,
      manualCheck: 'npm view openclaw version',
      manualUpdate: 'npm update -g openclaw',
      lastChecked: checkedAt,
    })
  } catch (error) {
    targets.push({
      id: 'openclaw',
      name: 'OpenClaw',
      status: 'error',
      installed: false,
      detail: String(error),
      manualCheck: 'npm view openclaw version',
      manualUpdate: 'npm install -g openclaw@latest',
      lastChecked: checkedAt,
    })
  }

  const fabricVersion = await runLocalCommand('fabric', ['--version'])
  const fabricPatterns = await runLocalCommand('fabric', ['--listpatterns', '--shell-complete-list'])
  const patternCount = fabricPatterns.success ? parseFabricPatternList(fabricPatterns.stdout).length : 0
  targets.push({
    id: 'fabric',
    name: 'Fabric',
    status: fabricVersion.success ? (patternCount > 0 ? 'ok' : 'warning') : 'error',
    installed: fabricVersion.success,
    version: fabricVersion.stdout || undefined,
    detail: fabricVersion.success
      ? `${patternCount} pattern${patternCount === 1 ? '' : 's'} detected locally. Pattern updates require manual approval.`
      : `Fabric CLI unavailable: ${fabricVersion.error ?? 'unknown error'}`,
    manualCheck: 'fabric -L',
    manualUpdate: 'fabric -U',
    lastChecked: checkedAt,
  })

  const paiPath = path.join(os.homedir(), 'pai')
  const pai = await gitMaintenanceStatus(paiPath)
  targets.push({
    id: 'pai',
    name: 'PAI',
    status: !pai.exists ? 'error' : pai.isGit ? 'ok' : 'warning',
    installed: pai.exists,
    version: pai.version,
    localPath: paiPath,
    detail: pai.detail,
    manualCheck: `git -C ${paiPath} fetch --all --prune`,
    manualUpdate: `git -C ${paiPath} pull --ff-only`,
    lastChecked: checkedAt,
  })

  const clawCodePath = path.join(os.homedir(), 'PAI', 'claw-code')
  const clawCode = await gitMaintenanceStatus(clawCodePath)
  targets.push({
    id: 'claude-parity',
    name: 'Claude Parity / claw-code',
    status: !clawCode.exists ? 'warning' : clawCode.isGit ? 'ok' : 'warning',
    installed: clawCode.exists,
    version: clawCode.version,
    localPath: clawCodePath,
    detail: clawCode.detail,
    manualCheck: `git -C ${clawCodePath} fetch --all --prune`,
    manualUpdate: `git -C ${clawCodePath} pull --ff-only`,
    lastChecked: checkedAt,
  })

  return {
    success: true,
    checkedAt,
    policy: 'check-only-manual-approval',
    targets,
  }
}
