import { spawn } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'

export type OpenClawServiceInfo = {
  configPath: string
  workspacePath: string
  logsPath: string
  gatewayPort: number
  browserPort: number
  bindHost: string
  gatewayMode: string
  gatewayCanvasUrl: string
  controlUrl: string
}

export type OpenClawGatewaySettings = OpenClawServiceInfo & {
  token?: string
  password?: string
}

export type OpenClawRuntime = {
  nodePath: string
  openClawPath: string
  version: string
}

export function getOpenClawServiceInfo(): OpenClawServiceInfo {
  const configPath = path.join(os.homedir(), '.openclaw', 'openclaw.json')
  const workspacePath = path.join(os.homedir(), '.openclaw', 'workspace')
  const logsPath = path.join(os.homedir(), '.openclaw', 'logs')

  const defaults: OpenClawServiceInfo = {
    configPath,
    workspacePath,
    logsPath,
    gatewayPort: 18789,
    browserPort: 18791,
    bindHost: '127.0.0.1',
    gatewayMode: 'local',
    gatewayCanvasUrl: 'http://127.0.0.1:18789/__openclaw__/canvas/',
    controlUrl: 'http://127.0.0.1:18791/',
  }

  if (!fs.existsSync(configPath)) {
    return defaults
  }

  try {
    const raw = fs.readFileSync(configPath, 'utf8')
    const parsed = JSON.parse(raw) as {
      agents?: { defaults?: { workspace?: string } }
      gateway?: { port?: number; bind?: string; mode?: string }
    }

    const gatewayPort = parsed.gateway?.port ?? defaults.gatewayPort
    const bind = parsed.gateway?.bind ?? 'loopback'
    const bindHost = bind === 'loopback' ? '127.0.0.1' : bind
    const workspace = parsed.agents?.defaults?.workspace ?? workspacePath
    const browserPort = gatewayPort + 2

    return {
      configPath,
      workspacePath: workspace,
      logsPath,
      gatewayPort,
      browserPort,
      bindHost,
      gatewayMode: parsed.gateway?.mode ?? defaults.gatewayMode,
      gatewayCanvasUrl: `http://${bindHost}:${gatewayPort}/__openclaw__/canvas/`,
      controlUrl: `http://${bindHost}:${browserPort}/`,
    }
  } catch {
    return defaults
  }
}

export function getOpenClawGatewaySettings(): OpenClawGatewaySettings {
  const info = getOpenClawServiceInfo()

  if (!fs.existsSync(info.configPath)) {
    return info
  }

  try {
    const raw = fs.readFileSync(info.configPath, 'utf8')
    const parsed = JSON.parse(raw) as {
      gateway?: {
        auth?: {
          token?: string
          password?: string
        }
      }
    }

    return {
      ...info,
      token: typeof parsed.gateway?.auth?.token === 'string' ? parsed.gateway.auth.token.trim() : undefined,
      password: typeof parsed.gateway?.auth?.password === 'string' ? parsed.gateway.auth.password.trim() : undefined,
    }
  } catch {
    return info
  }
}

export function loadOpenClawContext(): {
  workspacePath: string
  files: Array<{ name: string; path: string; content: string }>
} {
  const info = getOpenClawServiceInfo()
  const workspacePath = info.workspacePath
  const contextFiles = ['AGENTS.md', 'SOUL.md', 'MEMORY.md', 'HEARTBEAT.md']
  const files = contextFiles.flatMap((fileName) => {
    const filePath = path.join(workspacePath, fileName)
    if (!fs.existsSync(filePath)) return []
    const content = fs.readFileSync(filePath, 'utf8').slice(0, 4000)
    return [{ name: fileName, path: filePath, content }]
  })
  return { workspacePath, files }
}

function compareOpenClawSemverDesc(a: string, b: string): number {
  const normalize = (value: string) => value.replace(/^v/, '').split('.').map((part) => Number(part) || 0)
  const aParts = normalize(a)
  const bParts = normalize(b)
  const max = Math.max(aParts.length, bParts.length)
  for (let index = 0; index < max; index += 1) {
    const delta = (bParts[index] ?? 0) - (aParts[index] ?? 0)
    if (delta !== 0) return delta
  }
  return 0
}

export function findOpenClawRuntime(): OpenClawRuntime {
  const nvmBase = path.join(os.homedir(), '.nvm', 'versions', 'node')
  if (!fs.existsSync(nvmBase)) {
    throw new Error(`OpenClaw runtime not found under ${nvmBase}`)
  }

  const versions = fs.readdirSync(nvmBase).sort(compareOpenClawSemverDesc)
  for (const version of versions) {
    const base = path.join(nvmBase, version)
    const nodePath = path.join(base, 'bin', 'node')
    const openClawPath = path.join(base, 'lib', 'node_modules', 'openclaw', 'openclaw.mjs')
    if (fs.existsSync(nodePath) && fs.existsSync(openClawPath)) {
      return { nodePath, openClawPath, version }
    }
  }

  throw new Error('Unable to locate an OpenClaw runtime under ~/.nvm/versions/node')
}

export function runOpenClawGatewayCall(method: string, params: unknown, timeoutMs = 300000): Promise<unknown> {
  const runtime = findOpenClawRuntime()
  return new Promise((resolve, reject) => {
    const child = spawn(runtime.nodePath, [
      runtime.openClawPath,
      'gateway',
      'call',
      method,
      '--json',
      '--timeout',
      String(timeoutMs),
      '--params',
      JSON.stringify(params ?? {}),
    ], {
      env: {
        ...process.env,
        HOME: process.env.HOME ?? os.homedir(),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk)
    })

    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })

    child.on('error', (error) => {
      reject(error)
    })

    child.on('close', (code) => {
      if (code !== 0) {
        const detail = [stderr.trim(), stdout.trim()].filter(Boolean).join('\n')
        reject(new Error(detail || `openclaw gateway call ${method} exited with status ${code ?? 'unknown'}`))
        return
      }

      try {
        resolve(JSON.parse(stdout))
      } catch (error) {
        reject(error)
      }
    })
  })
}
