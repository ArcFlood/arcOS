import { app, BrowserWindow, dialog } from 'electron'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { getSetting } from '../database/operations'
import { appendLog } from '../logger'

const APP_SETTINGS_DB_KEY = 'app-settings'

export type PermissionPolicy = 'readonly' | 'workspace-only' | 'ask' | 'unrestricted'

type PermissionDeniedResult = {
  success: false
  permissionDenied: true
  action: string
  activePolicy: PermissionPolicy
  requiredPolicy: PermissionPolicy
  reason: string
  targetPath?: string
  error: string
}

let getMainWindow: () => BrowserWindow | null = () => null
let getExtraRoots: () => string[] = () => []

export function configurePermissionPolicy(options: {
  getMainWindow: () => BrowserWindow | null
  getExtraRoots?: () => string[]
}): void {
  getMainWindow = options.getMainWindow
  getExtraRoots = options.getExtraRoots ?? (() => [])
}

function getPermissionPolicy(): PermissionPolicy {
  try {
    const raw = getSetting(APP_SETTINGS_DB_KEY)
    if (!raw) return 'workspace-only'
    const parsed = JSON.parse(raw) as { permissionPolicy?: unknown }
    return parsed.permissionPolicy === 'readonly' ||
      parsed.permissionPolicy === 'workspace-only' ||
      parsed.permissionPolicy === 'ask' ||
      parsed.permissionPolicy === 'unrestricted'
      ? parsed.permissionPolicy
      : 'workspace-only'
  } catch {
    return 'workspace-only'
  }
}

function notifyPermissionEvent(payload: {
  action: string
  outcome: 'approved' | 'denied'
  activePolicy: PermissionPolicy
  requiredPolicy: PermissionPolicy
  reason: string
  targetPath?: string
}) {
  const mainWindow = getMainWindow()
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('permission:event', {
      ...payload,
      timestamp: Date.now(),
    })
  }
}

function permissionDenied(
  action: string,
  policy = getPermissionPolicy(),
  requiredPolicy: PermissionPolicy = 'workspace-only',
  reason?: string,
  targetPath?: string,
): PermissionDeniedResult {
  const detail = reason ?? `Permission policy "${policy}" blocked ${action}.`
  const error = `${detail} Change Settings -> General -> Permission Policy if this action should be allowed.`
  appendLog('warn', 'main', error, undefined, 'trust_gate')
  notifyPermissionEvent({
    action,
    outcome: 'denied',
    activePolicy: policy,
    requiredPolicy,
    reason: detail,
    targetPath,
  })
  return {
    success: false,
    permissionDenied: true,
    action,
    activePolicy: policy,
    requiredPolicy,
    reason: detail,
    targetPath,
    error,
  }
}

function resolvePermissionRoots(): string[] {
  return [
    app.getAppPath(),
    app.getPath('userData'),
    path.join(os.homedir(), 'Documents', 'AI Project'),
    ...getExtraRoots(),
  ]
    .filter(Boolean)
    .map((root) => path.resolve(root))
}

export function isPathInside(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

export function canonicalPathAllowMissing(targetPath: string): string {
  try {
    return fs.realpathSync.native(targetPath)
  } catch {
    const parent = path.dirname(targetPath)
    const base = path.basename(targetPath)
    try {
      return path.join(fs.realpathSync.native(parent), base)
    } catch {
      return path.resolve(targetPath)
    }
  }
}

function canonicalRoots(): string[] {
  return resolvePermissionRoots().map((root) => {
    try {
      return fs.realpathSync.native(root)
    } catch {
      return root
    }
  })
}

function requestPermissionApproval(
  action: string,
  policy: PermissionPolicy,
  requiredPolicy: PermissionPolicy,
  targetPath?: string,
): boolean {
  if (policy !== 'ask') return false
  const mainWindow = getMainWindow()
  const result = dialog.showMessageBoxSync(mainWindow ?? undefined, {
    type: 'warning',
    buttons: ['Allow Once', 'Deny'],
    defaultId: 1,
    cancelId: 1,
    title: 'ARCOS Permission Approval',
    message: `Allow ARCOS to ${action}?`,
    detail: [
      `Active policy: ${policy}`,
      `Required policy: ${requiredPolicy}`,
      targetPath ? `Target: ${targetPath}` : null,
    ].filter(Boolean).join('\n'),
  })
  const approved = result === 0
  notifyPermissionEvent({
    action,
    outcome: approved ? 'approved' : 'denied',
    activePolicy: policy,
    requiredPolicy,
    reason: approved ? 'User approved this action once.' : 'User denied this action.',
    targetPath,
  })
  return approved
}

export function enforceWritePermission(action: string, targetPath?: string): PermissionDeniedResult | null {
  const policy = getPermissionPolicy()
  if (policy === 'unrestricted') return null
  if (policy === 'readonly') {
    return permissionDenied(action, policy, 'workspace-only', `Writes are not allowed in ${policy} mode.`, targetPath)
  }
  if (policy === 'ask') {
    return requestPermissionApproval(action, policy, targetPath ? 'unrestricted' : 'workspace-only', targetPath)
      ? null
      : permissionDenied(action, policy, targetPath ? 'unrestricted' : 'workspace-only', 'User denied this action.', targetPath)
  }
  if (!targetPath) return null
  const resolved = canonicalPathAllowMissing(targetPath)
  const allowed = canonicalRoots().some((root) => isPathInside(root, resolved))
  return allowed ? null : permissionDenied(`${action} outside approved workspace roots`, policy, 'unrestricted', `Path is outside approved workspace roots: ${resolved}`, targetPath)
}

export function enforceExecutePermission(action: string): PermissionDeniedResult | null {
  const policy = getPermissionPolicy()
  if (policy === 'unrestricted' || policy === 'workspace-only') return null
  if (policy === 'ask') {
    return requestPermissionApproval(action, policy, 'workspace-only')
      ? null
      : permissionDenied(action, policy, 'workspace-only', 'User denied this action.')
  }
  return permissionDenied(action, policy, 'workspace-only', `Execute actions are not allowed in ${policy} mode.`)
}
