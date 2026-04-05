/**
 * recoveryRecipes.ts — Recovery action maps for known service failures.
 *
 * Each recipe describes what ARCOS should attempt when a service transitions
 * to the 'failed' state and the service name matches.
 */

import { execSync } from 'child_process'
import os from 'os'
import path from 'path'
import { log } from '../logger'

export type RecoveryAction = 'restart_service' | 'start_service' | 'reload_config' | 'notify_only' | 'noop'

export interface RecoveryRecipe {
  serviceName: string
  action: RecoveryAction
  /** Run this shell command to attempt recovery */
  command?: string
  /** Human-readable hint shown in the watchdog status */
  hint: string
  /** Maximum consecutive auto-recovery attempts before giving up */
  maxAttempts: number
}

// ── Recovery recipes per service ──────────────────────────────────

export const RECOVERY_RECIPES: RecoveryRecipe[] = [
  {
    serviceName: 'ollama',
    action: 'start_service',
    command: 'ollama serve',
    hint: 'Attempting to restart the Ollama server. Check that the ollama binary is in PATH.',
    maxAttempts: 3,
  },
  {
    serviceName: 'arc-memory',
    action: 'start_service',
    // arc-memory is started from its project directory via uv
    command: undefined,
    hint: 'ARC-Memory service is down. Start it via: cd ~/arc-memory && uv run uvicorn app.main:app --port 8082',
    maxAttempts: 1, // don't auto-start — requires uv environment
  },
  {
    serviceName: 'fabric',
    action: 'notify_only',
    command: undefined,
    hint: 'Fabric REST API is down. Start it via: fabric --serve (or check your Fabric installation).',
    maxAttempts: 1,
  },
  {
    serviceName: 'openclaw',
    action: 'notify_only',
    command: undefined,
    hint: 'OpenClaw gateway is unreachable. It is typically auto-started by ARCOS. Try sending a message to trigger re-launch.',
    maxAttempts: 0,
  },
]

export function getRecipeForService(serviceName: string): RecoveryRecipe | undefined {
  return RECOVERY_RECIPES.find((r) => r.serviceName === serviceName)
}

/**
 * Execute a recovery attempt for the given service.
 * Returns true if a command was launched (not necessarily successful).
 */
export function executeRecovery(recipe: RecoveryRecipe): boolean {
  if (!recipe.command || recipe.action === 'notify_only' || recipe.action === 'noop') {
    log.warn(`[watchdog] Recovery for ${recipe.serviceName}: ${recipe.hint}`)
    return false
  }

  try {
    log.info(`[watchdog] Attempting recovery for ${recipe.serviceName}: ${recipe.command}`)
    execSync(recipe.command, {
      detached: true,
      stdio: 'ignore',
      env: {
        ...process.env,
        PATH: [
          '/opt/homebrew/bin',
          '/usr/local/bin',
          '/usr/bin',
          '/bin',
          process.env.PATH ?? '',
        ].join(':'),
      },
    })
    return true
  } catch (e) {
    log.error(`[watchdog] Recovery command failed for ${recipe.serviceName}`, String(e))
    return false
  }
}
