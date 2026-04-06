import Database from 'better-sqlite3'
import path from 'path'
import os from 'os'
import fs from 'fs'
import { SCHEMA } from './schema'

let _db: Database.Database | null = null

export function getDb(): Database.Database {
  if (_db) return _db

  const dir = path.join(os.homedir(), '.noah-ai-hub')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

  const dbPath = path.join(dir, 'conversations.db')
  _db = new Database(dbPath)

  // Performance + integrity settings
  _db.pragma('journal_mode = WAL')    // concurrent reads while writing
  _db.pragma('foreign_keys = ON')     // enforce FK constraints
  _db.pragma('synchronous = NORMAL')  // WAL + NORMAL is safe and fast

  // Run migrations / create tables
  _db.exec(SCHEMA)
  try {
    _db.exec('ALTER TABLE messages ADD COLUMN model_label TEXT')
  } catch {
    // Column already exists on upgraded installs.
  }

  console.log(`[DB] Opened: ${dbPath}`)
  return _db
}

export function closeDb(): void {
  if (_db) {
    _db.close()
    _db = null
  }
}
