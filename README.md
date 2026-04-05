# ARCOS

ARCOS is the desktop operating surface for PAI. It is not just a chat shell. It is a local-first control plane for the execution chain:

`ARCOS app -> user prompt -> PAI core context -> OpenClaw -> Fabric -> Response Composer -> local model`

## What You Need

ARCOS depends on more than the Electron app itself.

Required:
- Node.js 20+
- Ollama
- OpenClaw
- Fabric

Optional but expected for the full local stack:
- ARC-Memory
- Obsidian vault for memory ingestion/write-back

## Important Architecture Note

If someone downloads ARCOS without also setting up OpenClaw and Fabric, they are not running the intended product.

ARCOS is the UI and control surface.
OpenClaw is the gateway/orchestration layer.
Fabric is the prompt-skill layer.
Ollama is the default local inference layer.

## Quick Start

```bash
git clone <repo-url>
cd arcos
npm install
```

Then complete the runtime setup in:

- [OPENCLAW_SETUP.md](/Users/noahpowell/Documents/AI%20Project/arcos/docs/OPENCLAW_SETUP.md)

After that:

```bash
# terminal 1
ollama serve

# terminal 2
fabric --serve

# terminal 3
npm run dev
```

## OpenClaw and Fabric Setup

This repo includes safe template files for the OpenClaw sidecar workspace under:

- [openclaw-template](/Users/noahpowell/Documents/AI%20Project/arcos/openclaw-template)

That template includes:
- workspace bootstrap files required by ARCOS
- runtime contract files
- hook/event contract files
- a sanitized example `openclaw.example.json`

Do not copy your real `~/.openclaw/openclaw.json` into Git.

## Repo Setup Files

OpenClaw templates:
- [openclaw-template/openclaw.example.json](/Users/noahpowell/Documents/AI%20Project/arcos/openclaw-template/openclaw.example.json)
- [openclaw-template/workspace/BOOTSTRAP.md](/Users/noahpowell/Documents/AI%20Project/arcos/openclaw-template/workspace/BOOTSTRAP.md)
- [openclaw-template/workspace/ARCOS_RUNTIME.md](/Users/noahpowell/Documents/AI%20Project/arcos/openclaw-template/workspace/ARCOS_RUNTIME.md)
- [openclaw-template/workspace/HOOKS.md](/Users/noahpowell/Documents/AI%20Project/arcos/openclaw-template/workspace/HOOKS.md)
- [openclaw-template/workspace/AGENTS.md](/Users/noahpowell/Documents/AI%20Project/arcos/openclaw-template/workspace/AGENTS.md)
- [openclaw-template/workspace/TOOLS.md](/Users/noahpowell/Documents/AI%20Project/arcos/openclaw-template/workspace/TOOLS.md)
- [openclaw-template/workspace/IDENTITY.example.md](/Users/noahpowell/Documents/AI%20Project/arcos/openclaw-template/workspace/IDENTITY.example.md)
- [openclaw-template/workspace/USER.example.md](/Users/noahpowell/Documents/AI%20Project/arcos/openclaw-template/workspace/USER.example.md)
- [openclaw-template/workspace/SOUL.example.md](/Users/noahpowell/Documents/AI%20Project/arcos/openclaw-template/workspace/SOUL.example.md)

Setup docs:
- [docs/OPENCLAW_SETUP.md](/Users/noahpowell/Documents/AI%20Project/arcos/docs/OPENCLAW_SETUP.md)

Validation helper:
- [scripts/openclaw-boot.sh](/Users/noahpowell/Documents/AI%20Project/arcos/scripts/openclaw-boot.sh)

## Development

```bash
npm run dev
```

Build the packaged app:

```bash
npm run build:dir
```

## Current Status

ARCOS has the main structural pieces in place:
- pocket-grid modular workspace
- saved layouts and detached panels
- ARC-Memory integration and write-back
- observability/history panels
- OpenClaw visibility in the app
- canonical staged chat path inside ARCOS

What is still being refined:
- Response Composer fidelity so Fabric-backed requests preserve upstream quality more literally
- execution surfaces fed by emitted runtime events instead of staged UI logic
- continued OpenClaw/Fabric refinement based on live use
