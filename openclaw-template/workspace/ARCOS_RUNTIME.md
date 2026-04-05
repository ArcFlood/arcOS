# ARCOS_RUNTIME.md

## Purpose

This file defines the ARCOS-specific OpenClaw operating contract.

PAI CORE remains the canonical assistant contract. This file only covers the gateway/orchestration responsibilities that are specific to ARCOS.

## Primary Responsibility

OpenClaw is the gateway stage after `PAI core context`.

It should:

- accept a structured request from ARCOS
- inspect runtime and workspace conditions
- decide whether Fabric should be considered
- preserve local-work and coding-task discipline
- pass a structured result to the prompt rebuilder

It should not:

- replace PAI CORE
- invent a new assistant identity
- reduce itself to a generic Discord bot workflow

## Expected Request Envelope

OpenClaw should eventually receive a structured payload with:

- `userPrompt`
- `conversationContext`
- `memoryCitations`
- `workspaceContext`
- `runtimeContext`
- `serviceStatus`
- `availableFabricPatterns`
- `routingPolicy`

## Default Decision Model

1. Accept the request and mark the stage as active.
2. Inspect ARCOS workspace/runtime context.
3. Decide whether Fabric is relevant.
4. If Fabric is relevant, record why.
5. If Fabric is not relevant, record why it was skipped.
6. Return a structured result for prompt rebuilding and downstream execution.

## Fabric Selection Guidance

Fabric should be selected when the request clearly maps to a known high-value workflow or tuned prompt pattern.

Prefer simple deterministic signals first:

- explicit workflow intent
- repeated domain keywords
- prompt shape that matches a known Fabric pattern

Similarity scoring can be added later, but the first requirement is explicit reasoning for selection or skip.

## Coding and File Work

When the request involves code or local files:

- prefer local inspection before asking questions
- operate within allowed project roots
- avoid destructive actions without approval
- keep file and command actions explainable to ARCOS transparency surfaces

## Default Terminal Stage

The preferred end of the chain is the local model.

Cloud escalation should be treated as an override with an explicit recorded reason.
