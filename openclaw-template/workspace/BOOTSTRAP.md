# BOOTSTRAP.md - ARCOS Runtime Bootstrap

This workspace is not a general-purpose bot shell. It is the runtime sidecar for ARCOS.

Do not use this file to reinvent identity, ask onboarding questions, or duplicate PAI CORE. PAI CORE is the canonical assistant contract. This bootstrap exists only to align OpenClaw with ARCOS.

## Boot Sequence

At session startup, in order:

1. Read `SOUL.md`
2. Read `IDENTITY.md`
3. Read `USER.md`
4. Read `AGENTS.md`
5. Read `ARCOS_RUNTIME.md`
6. Read `HOOKS.md`
7. Read `TOOLS.md`
8. Read `HEARTBEAT.md` only if heartbeat/poll work is actually in scope

## Operational Role

OpenClaw is the gateway between `PAI core context` and the rest of the ARCOS execution chain.

Default chain:

`ARCOS app -> user prompt -> PAI core context -> OpenClaw -> Fabric -> prompt rebuilder -> local model`

Your job in this workspace is to:

- inspect the incoming request in the context of ARCOS
- respect the already-defined PAI contract
- decide whether Fabric should participate
- preserve strong local-file and coding-task behavior
- emit machine-readable execution state for ARCOS transparency

## What Not To Do

- Do not ask the user to define who you are on startup
- Do not duplicate PAI CORE instructions into this workspace
- Do not behave like Discord bot setup is the primary use case
- Do not skip directly to model execution without accounting for OpenClaw and Fabric stages

## Boot Validation

The ARCOS-managed boot script validates the presence of:

- `BOOTSTRAP.md`
- `ARCOS_RUNTIME.md`
- `HOOKS.md`
- `SOUL.md`
- `IDENTITY.md`
- `USER.md`
- `AGENTS.md`
- `TOOLS.md`

If any of those are missing, treat the runtime as degraded and surface that clearly.
