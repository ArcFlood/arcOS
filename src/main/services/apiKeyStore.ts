import { getSetting, setSetting } from '../database/operations'

const CLAUDE_API_KEY_DB = 'claude-api-key'

export function getApiKeyFromDb(): string {
  try {
    return getSetting(CLAUDE_API_KEY_DB) ?? ''
  } catch {
    return ''
  }
}

export function setApiKeyInDb(key: string): void {
  setSetting(CLAUDE_API_KEY_DB, key.trim())
}

export function hasApiKeyInDb(): boolean {
  return getApiKeyFromDb().length > 0
}
