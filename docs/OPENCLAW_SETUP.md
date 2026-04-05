# OpenClaw and Fabric Setup for ARCOS

This guide is for anyone setting up ARCOS from GitHub who wants the intended runtime architecture, not just the UI.

## Required Components

You need all of these for the intended ARCOS stack:

1. ARCOS
2. OpenClaw
3. Fabric
4. Ollama

Optional but recommended:

5. ARC-Memory
6. Obsidian vault for local memory

## What ARCOS Expects

ARCOS expects OpenClaw to exist outside the app repo, normally at:

- `~/.openclaw`

ARCOS also expects OpenClaw to be configured for ARCOS-specific operation, not as a generic standalone bot.

## Template Files in This Repo

Use these as the starting point:

- [openclaw-template/openclaw.example.json](/Users/noahpowell/Documents/AI%20Project/arcos/openclaw-template/openclaw.example.json)
- [openclaw-template/workspace](/Users/noahpowell/Documents/AI%20Project/arcos/openclaw-template/workspace)

## Setup Steps

1. Install OpenClaw locally.

2. Create the OpenClaw workspace:

```bash
mkdir -p ~/.openclaw/workspace
```

3. Copy the template workspace files from this repo into `~/.openclaw/workspace`.

Required workspace files:
- `BOOTSTRAP.md`
- `ARCOS_RUNTIME.md`
- `HOOKS.md`
- `AGENTS.md`
- `TOOLS.md`

Template-only starter files you should customize locally:
- `IDENTITY.example.md`
- `USER.example.md`
- `SOUL.example.md`

4. Create your local `~/.openclaw/openclaw.json` from [openclaw.example.json](/Users/noahpowell/Documents/AI%20Project/arcos/openclaw-template/openclaw.example.json).

You must edit this locally. The example file is intentionally sanitized.

5. Make sure Fabric is installed and reachable from the same machine.

Typical local mode:

```bash
fabric --serve
```

6. Make sure Ollama is installed, running, and has at least one usable local chat model.

```bash
ollama serve
```

7. Validate the OpenClaw workspace from the ARCOS repo:

```bash
zsh scripts/openclaw-boot.sh
```

Expected result:
- status `ok`
- no missing files
- no missing hooks

## What Not To Commit

Do not commit your real:
- `~/.openclaw/openclaw.json`
- tokens
- Discord bot credentials
- machine-specific secrets

Only commit sanitized templates and docs.

## Why This Matters

ARCOS is not meant to operate as an isolated Electron app. The intended architecture is:

`ARCOS app -> user prompt -> PAI core context -> OpenClaw -> Fabric -> Response Composer -> local model`

Without OpenClaw and Fabric, a user may still run parts of ARCOS, but they are not running the intended system.

## Current Limitation

At the time of writing, the repo contains the OpenClaw template contract and boot-validation path, and the live ARCOS chain already performs OpenClaw handoff and Fabric selection. Remaining work is in refinement: stronger runtime event plumbing and better Response Composer fidelity.
