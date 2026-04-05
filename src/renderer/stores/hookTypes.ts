/**
 * hookTypes.ts — Canonical hook event type definitions for ARCOS.
 *
 * Mirrors the 14 required event types specified in HOOKS.md.
 * Used by hookRegistry (main), hookStore (renderer), and
 * canonicalChainService (chain event emission).
 */

// ── Event type union ──────────────────────────────────────────────

export type HookEventType =
  | 'request.accepted'
  | 'pai_context.loaded'
  | 'openclaw.started'
  | 'openclaw.completed'
  | 'fabric.considered'
  | 'fabric.selected'
  | 'fabric.skipped'
  | 'prompt.rebuilt'
  | 'model.dispatch.started'
  | 'model.dispatch.completed'
  | 'tool.action'
  | 'file.action'
  | 'runtime.degraded'
  | 'runtime.failed'

// ── Stage groupings (for UI display) ─────────────────────────────

export type HookStage =
  | 'intake'
  | 'context'
  | 'routing'
  | 'fabric'
  | 'dispatch'
  | 'tool'
  | 'system'

export const HOOK_EVENT_STAGES: Record<HookEventType, HookStage> = {
  'request.accepted':          'intake',
  'pai_context.loaded':        'context',
  'openclaw.started':          'routing',
  'openclaw.completed':        'routing',
  'fabric.considered':         'fabric',
  'fabric.selected':           'fabric',
  'fabric.skipped':            'fabric',
  'prompt.rebuilt':            'dispatch',
  'model.dispatch.started':    'dispatch',
  'model.dispatch.completed':  'dispatch',
  'tool.action':               'tool',
  'file.action':               'tool',
  'runtime.degraded':          'system',
  'runtime.failed':            'system',
}

// ── Status values ─────────────────────────────────────────────────

export type HookEventStatus = 'started' | 'completed' | 'skipped' | 'failed'

// ── Core hook event shape ─────────────────────────────────────────

export interface HookEvent {
  /** Unique event ID */
  id: string
  /** One of the 14 canonical event types */
  eventType: HookEventType
  /** Which chain stage emitted this */
  stage: HookStage
  /** Lifecycle status of this event */
  status: HookEventStatus
  /** ISO timestamp when the event fired */
  timestamp: string
  /** Conversation/request identifier */
  requestId: string
  /** Short human-readable summary */
  summary: string
  /** Extended details (optional, may be structured) */
  details?: string

  // ── Optional fields (from HOOKS.md spec) ─────────────────────

  /** Set when fabric.selected or fabric.considered */
  selectedFabricPattern?: string
  /** Set when fabric.skipped */
  skipReason?: string
  /** Which local or remote model was targeted */
  modelTarget?: string
  /** Tool name for tool.action events */
  toolName?: string
  /** File path for file.action events */
  filePath?: string
  /** Failure class for runtime.degraded/failed */
  failureClass?: string
  /** Recovery suggestion */
  recoveryHint?: string
}

// ── Hook registry entry (main process) ───────────────────────────

export interface HookRegistryEntry {
  name: string
  description: string
  subscribedEvents: HookEventType[]
  active: boolean
}
