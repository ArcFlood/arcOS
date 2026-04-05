# HOOKS.md

## Purpose

This file defines the ARCOS-facing hook and event contract for OpenClaw.

ARCOS transparency and execution surfaces should ultimately reflect runtime-emitted facts, not inferred UI guesses.

## Required Event Types

OpenClaw-related hooks should be able to emit structured events for:

- `request.accepted`
- `pai_context.loaded`
- `openclaw.started`
- `openclaw.completed`
- `fabric.considered`
- `fabric.selected`
- `fabric.skipped`
- `prompt.rebuilt`
- `model.dispatch.started`
- `model.dispatch.completed`
- `tool.action`
- `file.action`
- `runtime.degraded`
- `runtime.failed`

## Minimum Event Fields

Every emitted event should eventually carry:

- `eventType`
- `stage`
- `status`
- `timestamp`
- `requestId`
- `summary`
- `details`

Optional but useful fields:

- `selectedFabricPattern`
- `skipReason`
- `modelTarget`
- `toolName`
- `filePath`
- `failureClass`
- `recoveryHint`

## Existing Internal Hooks

The current runtime config should retain these internal hooks:

- `session-memory`
- `command-logger`
- `bootstrap-extra-files`
- `boot-md`

These hooks are not enough by themselves. They are the base layer that later runtime integration should build on.

## Logging Rule

If a request takes a degraded or fallback path, the hook output should say so explicitly. Silence is not acceptable state.
