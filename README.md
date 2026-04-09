# ARCOS

ARCOS is a local-first desktop control surface for a PAI-based workflow. It is not a generic chat shell. It is the operating layer that coordinates prompt composition, routing, observability, memory, and local model execution.

Core request path:

`ARCOS -> PAI core context -> OpenClaw -> Fabric -> Response Composer -> model`

Test path:

`ARCOS -> model`

The test path is available from the Terminal `T` toggle when you need to bypass PAI/OpenClaw/Fabric and send directly to the model.

## Current Scope

ARCOS currently includes:
- modular grid workspace with saved layouts and multi-page workspaces
- Terminal module with queued sends, visible thinking state, model indicator, and optional voice playback
- Routing, Services, Transparency, History, Memory Search, Dev Tools, Automation, and Hestia modules
- ARC-Memory integration, archive-to-memory flow, and memory hygiene scanning
- OpenClaw-aware request composition with runtime files kept internal to the OpenClaw stage
- Fabric integration for prompt-pattern routing
- local Ollama execution with request token tracking
- ElevenLabs playback inside ARCOS
- startup overlay and bundled greeting audio
- permission-policy controls and security hardening work in progress

## Runtime Dependencies

Required for the intended local stack:
- Node.js 20+
- Ollama
- OpenClaw
- Fabric

Optional but expected for the fuller ARCOS experience:
- ARC-Memory
- Obsidian vault for memory ingestion and write-back
- ElevenLabs API key for voice playback
- iSMC for local sensor telemetry in Hestia

Important architectural note:

If ARCOS is run without OpenClaw and Fabric, the app still functions, but it is not running the intended full orchestration path.

Roles:
- ARCOS: UI, orchestration surface, observability, and operator controls
- PAI core: base identity and response contract
- OpenClaw: gateway/orchestration analysis layer
- Fabric: prompt-skill / pattern layer
- Ollama: default local inference layer
- ARC-Memory: memory storage and retrieval layer

## Quick Start

```bash
git clone <repo-url>
cd arcos
npm install
```

Complete setup for the local sidecar stack:
- [OPENCLAW_SETUP.md](/Users/noahpowell/Documents/AI%20Project/arcos/docs/OPENCLAW_SETUP.md)

Then run:

```bash
# terminal 1
ollama serve

# terminal 2
fabric --serve

# terminal 3
npm run dev
```

Build the packaged app:

```bash
npm run build:dir
```

## OpenClaw Setup Assets

This repo includes safe template files for the OpenClaw sidecar workspace under:
- [openclaw-template](/Users/noahpowell/Documents/AI%20Project/arcos/openclaw-template)

Included templates:
- [openclaw-template/openclaw.example.json](/Users/noahpowell/Documents/AI%20Project/arcos/openclaw-template/openclaw.example.json)
- [openclaw-template/workspace/BOOTSTRAP.md](/Users/noahpowell/Documents/AI%20Project/arcos/openclaw-template/workspace/BOOTSTRAP.md)
- [openclaw-template/workspace/ARCOS_RUNTIME.md](/Users/noahpowell/Documents/AI%20Project/arcos/openclaw-template/workspace/ARCOS_RUNTIME.md)
- [openclaw-template/workspace/HOOKS.md](/Users/noahpowell/Documents/AI%20Project/arcos/openclaw-template/workspace/HOOKS.md)
- [openclaw-template/workspace/AGENTS.md](/Users/noahpowell/Documents/AI%20Project/arcos/openclaw-template/workspace/AGENTS.md)
- [openclaw-template/workspace/TOOLS.md](/Users/noahpowell/Documents/AI%20Project/arcos/openclaw-template/workspace/TOOLS.md)
- [openclaw-template/workspace/IDENTITY.example.md](/Users/noahpowell/Documents/AI%20Project/arcos/openclaw-template/workspace/IDENTITY.example.md)
- [openclaw-template/workspace/USER.example.md](/Users/noahpowell/Documents/AI%20Project/arcos/openclaw-template/workspace/USER.example.md)
- [openclaw-template/workspace/SOUL.example.md](/Users/noahpowell/Documents/AI%20Project/arcos/openclaw-template/workspace/SOUL.example.md)

Validation helper:
- [scripts/openclaw-boot.sh](/Users/noahpowell/Documents/AI%20Project/arcos/scripts/openclaw-boot.sh)

Do not commit your real `~/.openclaw/openclaw.json`.

## Development Notes

Useful commands:

```bash
npm run dev
npm run build:dir
npm run lint
npm run format:check
```

## Project Status

Implemented and usable:
- modular workspace pages and module presets
- Terminal rebuild around core chat flow
- request token tracking in Terminal and Routing
- Transparency event feed with lifecycle metadata
- Hestia local system telemetry module
- Dev Tools with error log, audit, repo state, and platform update checks
- Automation module with Hooks and Log tabs
- session history export and archive-to-memory flow
- memory hygiene scan for short/duplicate/low-value memory files
- startup greeting overlay
- direct ARCOS-hosted ElevenLabs playback
- main-process refactor out of a single `main.ts` god file

Still under active refinement:
- Terminal edge cases and queue behavior under heavy use
- Hestia widget polish and telemetry coverage
- preload bridge narrowing and IPC hardening follow-through
- MCP server expansion
- automation workflow depth
- Learnings / CAPTURE system
