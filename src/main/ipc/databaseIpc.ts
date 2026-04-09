import type { IpcMain } from 'electron'
import {
  clearSpending,
  deleteConversation,
  insertSpending,
  listConversations,
  listMessages,
  listSpending,
  upsertConversation,
  upsertMessage,
  type DbConversation,
  type DbMessage,
  type DbSpendingRecord,
} from '../database/operations'
import { getSetting, setSetting } from '../database/operations'
import { optionalString, requireNumber, requireObject, requireString, requireStringValue } from './validation'

function requireDbConversation(value: unknown): DbConversation {
  const obj = requireObject(value, 'conversation')
  return {
    id: requireString(obj.id, 'conversation id', 200),
    title: requireString(obj.title, 'conversation title', 500),
    created_at: requireNumber(obj.created_at, 'conversation created_at'),
    updated_at: requireNumber(obj.updated_at, 'conversation updated_at'),
    tags: requireString(obj.tags, 'conversation tags', 20_000),
    total_cost: requireNumber(obj.total_cost, 'conversation total_cost'),
  }
}

function requireDbMessage(value: unknown): DbMessage {
  const obj = requireObject(value, 'message')
  return {
    id: requireString(obj.id, 'message id', 200),
    conversation_id: requireString(obj.conversation_id, 'message conversation_id', 200),
    role: requireString(obj.role, 'message role', 50),
    content: requireStringValue(obj.content, 'message content', 1_000_000),
    model: optionalString(obj.model, 'message model', 200) ?? null,
    model_label: optionalString(obj.model_label, 'message model label', 200) ?? null,
    cost: requireNumber(obj.cost, 'message cost'),
    timestamp: requireNumber(obj.timestamp, 'message timestamp'),
    routing_reason: optionalString(obj.routing_reason, 'message routing reason', 10_000) ?? null,
  }
}

function requireDbSpendingRecord(value: unknown): DbSpendingRecord {
  const obj = requireObject(value, 'spending record')
  return {
    id: requireString(obj.id, 'spending id', 200),
    date: requireString(obj.date, 'spending date', 100),
    model: requireString(obj.model, 'spending model', 200),
    amount: requireNumber(obj.amount, 'spending amount'),
    conversation_id: optionalString(obj.conversation_id, 'spending conversation id', 200) ?? null,
  }
}

export function registerDatabaseIpc(ipcMain: IpcMain): void {
  ipcMain.handle('db:conversations:list', () => {
    try { return { success: true, data: listConversations() } }
    catch (e) { return { success: false, error: String(e) } }
  })
  ipcMain.handle('db:conversations:save', (_event, conv: DbConversation) => {
    try { upsertConversation(requireDbConversation(conv)); return { success: true } }
    catch (e) { return { success: false, error: String(e) } }
  })
  ipcMain.handle('db:conversations:delete', (_event, id: string) => {
    try { deleteConversation(requireString(id, 'conversation id', 200)); return { success: true } }
    catch (e) { return { success: false, error: String(e) } }
  })
  ipcMain.handle('db:messages:list', (_event, conversationId: string) => {
    try { return { success: true, data: listMessages(requireString(conversationId, 'conversation id', 200)) } }
    catch (e) { return { success: false, error: String(e) } }
  })
  ipcMain.handle('db:messages:save', (_event, msg: DbMessage) => {
    try { upsertMessage(requireDbMessage(msg)); return { success: true } }
    catch (e) { return { success: false, error: String(e) } }
  })
  ipcMain.handle('db:spending:list', () => {
    try { return { success: true, data: listSpending() } }
    catch (e) { return { success: false, error: String(e) } }
  })
  ipcMain.handle('db:spending:add', (_event, record: DbSpendingRecord) => {
    try { insertSpending(requireDbSpendingRecord(record)); return { success: true } }
    catch (e) { return { success: false, error: String(e) } }
  })
  ipcMain.handle('db:spending:clear', () => {
    try { clearSpending(); return { success: true } }
    catch (e) { return { success: false, error: String(e) } }
  })
  ipcMain.handle('db:settings:get', (_event, key: string) => {
    try { return { success: true, value: getSetting(requireString(key, 'settings key', 200)) } }
    catch (e) { return { success: false, error: String(e) } }
  })
  ipcMain.handle('db:settings:set', (_event, key: string, value: string) => {
    try { setSetting(requireString(key, 'settings key', 200), requireStringValue(value, 'settings value', 1_000_000)); return { success: true } }
    catch (e) { return { success: false, error: String(e) } }
  })
}
