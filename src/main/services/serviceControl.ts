import { app } from 'electron'
import { ChildProcess, spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import { getOpenClawServiceInfo } from '../integrations/openclaw/runtime'
import { log } from '../logger'
import { enforceExecutePermission } from '../permissions/policy'
import { runCommandAsync } from './commandRunner'

const SERVICE_NAMES = new Set(['ollama', 'fabric', 'arc-memory', 'openclaw'])
const serviceProcesses: Record<string, ChildProcess> = {}

function requireServiceName(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error('service name must be a string')
  }
  const name = value.trim()
  if (!SERVICE_NAMES.has(name)) {
    throw new Error(`Unknown service: ${name}`)
  }
  return name
}

async function isHttpEndpointReachable(url: string, timeoutMs = 1200): Promise<boolean> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    return response.status > 0
  } catch {
    return false
  }
}

export async function getServiceStatus(requestedName: unknown) {
  try {
    const name = requireServiceName(requestedName)
    if (name === 'ollama') {
      const result = await runCommandAsync('pgrep', ['-x', 'ollama'], { timeoutMs: 1500, maxOutputBytes: 16_000 })
      const r = result.success ? result.stdout : ''
      return { running: r.length > 0, pid: parseInt(r) || undefined }
    }
    if (name === 'fabric') {
      try {
        const r = await fetch('http://localhost:8080/api/patterns', { signal: AbortSignal.timeout(1500) })
        return { running: r.ok || r.status < 500 }
      } catch { return { running: false } }
    }
    if (name === 'arc-memory') {
      try {
        const r = await fetch('http://localhost:8082/status', { signal: AbortSignal.timeout(1500) })
        return { running: r.ok }
      } catch { return { running: false } }
    }
    if (name === 'openclaw') {
      const info = getOpenClawServiceInfo()
      const [gatewayReachable, controlReachable] = await Promise.all([
        isHttpEndpointReachable(info.gatewayCanvasUrl),
        isHttpEndpointReachable(info.controlUrl),
      ])
      return {
        running: gatewayReachable || controlReachable,
        port: info.gatewayPort,
        displayName: 'OpenClaw',
        manageable: false,
        managementNote: 'Managed from the existing .openclaw runtime',
        detailLines: [
          `Gateway mode: ${info.gatewayMode}`,
          `Gateway: ws://${info.bindHost}:${info.gatewayPort}`,
          `Control UI: ${info.controlUrl}`,
        ],
        links: [
          { label: 'Open Control UI', target: info.controlUrl, kind: 'url' },
          { label: 'Open Workspace', target: info.workspacePath, kind: 'path' },
          { label: 'Open Logs', target: info.logsPath, kind: 'path' },
          { label: 'Open Config', target: info.configPath, kind: 'path' },
        ],
      }
    }
  } catch { return { running: false } }
  return { running: false }
}

export function startService(requestedName: unknown) {
  try {
    const name = requireServiceName(requestedName)
    const denied = enforceExecutePermission(`starting service ${name}`)
    if (denied) return denied
    if (name === 'ollama') {
      const p = spawn('ollama', ['serve'], {
        detached: true,
        stdio: 'ignore',
      })
      p.unref(); serviceProcesses[name] = p
      return { success: true }
    }
    if (name === 'fabric') {
      const p = spawn('fabric', ['--serve'], { detached: true, stdio: 'ignore' })
      p.unref(); serviceProcesses[name] = p
      return { success: true }
    }
    if (name === 'arc-memory') {
      const memDir = app.isPackaged
        ? path.join(process.resourcesPath, 'memory-service')
        : path.join(app.getAppPath(), 'memory-service')

      if (!fs.existsSync(memDir)) {
        const error = `ARC-Memory resources not found at ${memDir}`
        log.error('ARC-Memory start failed', error)
        return { success: false, error }
      }

      const p = spawn('uv', ['run', 'arc-serve'], {
        cwd: memDir,
        detached: true,
        stdio: 'ignore',
      })
      p.unref(); serviceProcesses[name] = p
      return { success: true }
    }
    if (name === 'openclaw') {
      return { success: false, error: 'OpenClaw is linked from ~/.openclaw and is not started by ARCOS yet.' }
    }
  } catch (e) { return { success: false, error: String(e) } }
  return { success: false, error: 'Unknown service' }
}

export async function stopService(requestedName: unknown) {
  try {
    const name = requireServiceName(requestedName)
    const denied = enforceExecutePermission(`stopping service ${name}`)
    if (denied) return denied
    if (serviceProcesses[name]) { serviceProcesses[name].kill(); delete serviceProcesses[name] }
    if (name === 'ollama') {
      try { await runCommandAsync('pkill', ['-x', 'ollama'], { timeoutMs: 1500 }) } catch {
        // Best-effort process cleanup only.
      }
    }
    if (name === 'fabric') {
      try { await runCommandAsync('pkill', ['-f', 'fabric --serve'], { timeoutMs: 1500 }) } catch {
        // Best-effort process cleanup only.
      }
    }
    if (name === 'arc-memory') {
      try { await runCommandAsync('pkill', ['-f', 'mcp_server.server'], { timeoutMs: 1500 }) } catch {
        // Best-effort process cleanup only.
      }
    }
    if (name === 'openclaw') {
      return { success: false, error: 'OpenClaw is managed outside ARCOS right now.' }
    }
    return { success: true }
  } catch (e) { return { success: false, error: String(e) } }
}

export function stopManagedServiceProcesses(): void {
  Object.values(serviceProcesses).forEach((processHandle) => {
    try {
      processHandle.kill()
    } catch {
      // Best-effort child cleanup during shutdown.
    }
  })
}
