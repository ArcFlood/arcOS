import { getDb } from './db'

// ── Types (mirrored from renderer/stores/types.ts) ────────────────
export interface DbConversation {
  id: string
  title: string
  created_at: number
  updated_at: number
  tags: string        // JSON-encoded string[]
  total_cost: number
}

export interface DbMessage {
  id: string
  conversation_id: string
  role: string
  content: string
  model: string | null
  model_label: string | null
  cost: number
  timestamp: number
  routing_reason: string | null
}

export interface DbSpendingRecord {
  id: string
  date: string
  model: string
  amount: number
  conversation_id: string | null
}

// ── Conversations ─────────────────────────────────────────────────

export function listConversations(): DbConversation[] {
  return getDb()
    .prepare('SELECT * FROM conversations ORDER BY updated_at DESC')
    .all() as DbConversation[]
}

export function upsertConversation(c: DbConversation): void {
  getDb()
    .prepare(`
      INSERT INTO conversations (id, title, created_at, updated_at, tags, total_cost)
      VALUES (@id, @title, @created_at, @updated_at, @tags, @total_cost)
      ON CONFLICT(id) DO UPDATE SET
        title      = excluded.title,
        updated_at = excluded.updated_at,
        tags       = excluded.tags,
        total_cost = excluded.total_cost
    `)
    .run(c)
}

export function deleteConversation(id: string): void {
  // ON DELETE CASCADE will remove messages automatically
  getDb().prepare('DELETE FROM conversations WHERE id = ?').run(id)
}

// ── Messages ──────────────────────────────────────────────────────

export function listMessages(conversationId: string): DbMessage[] {
  return getDb()
    .prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY timestamp ASC')
    .all(conversationId) as DbMessage[]
}

export function upsertMessage(m: DbMessage): void {
  getDb()
    .prepare(`
      INSERT INTO messages (id, conversation_id, role, content, model, model_label, cost, timestamp, routing_reason)
      VALUES (@id, @conversation_id, @role, @content, @model, @model_label, @cost, @timestamp, @routing_reason)
      ON CONFLICT(id) DO UPDATE SET
        content        = excluded.content,
        model_label    = excluded.model_label,
        cost           = excluded.cost,
        routing_reason = excluded.routing_reason
    `)
    .run(m)
}

export function deleteMessagesByConversation(conversationId: string): void {
  getDb().prepare('DELETE FROM messages WHERE conversation_id = ?').run(conversationId)
}

// ── Spending Log ──────────────────────────────────────────────────

export function listSpending(): DbSpendingRecord[] {
  return getDb()
    .prepare('SELECT * FROM spending_log ORDER BY date ASC')
    .all() as DbSpendingRecord[]
}

export function insertSpending(r: DbSpendingRecord): void {
  getDb()
    .prepare(`
      INSERT OR IGNORE INTO spending_log (id, date, model, amount, conversation_id)
      VALUES (@id, @date, @model, @amount, @conversation_id)
    `)
    .run(r)
}

export function clearSpending(): void {
  getDb().prepare('DELETE FROM spending_log').run()
}

// ── Settings ──────────────────────────────────────────────────────

export function getSetting(key: string): string | null {
  const row = getDb()
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get(key) as { value: string } | undefined
  return row?.value ?? null
}

export function setSetting(key: string, value: string): void {
  getDb()
    .prepare(`
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `)
    .run(key, value)
}
