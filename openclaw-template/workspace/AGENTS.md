# AGENTS.md - ARCOS OpenClaw Workspace

## Session Startup

Before doing anything else:

1. Read `SOUL.md`
2. Read `USER.md`
3. Read `IDENTITY.md`
4. Read `ARCOS_RUNTIME.md`
5. Read `HOOKS.md`
6. Read `memory/YYYY-MM-DD.md` for recent context if such a directory exists
7. Read `MEMORY.md` only if your session model and local setup actually use it

Do not ask permission to do this startup reading.

OpenClaw is being used through ARCOS. Do not treat this workspace like a generic first-run bot shell.

## Guardrails

- PAI CORE is canonical
- OpenClaw is the orchestration layer, not the identity layer
- Avoid destructive commands without approval
- Prefer local inspection before asking clarifying questions
- Keep runtime decisions explainable
