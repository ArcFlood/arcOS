# ARCOS

**A.R.C. (AI Reasoning Companion) Hub** is a personal AI desktop app for macOS — an Electron + React interface that routes your queries across local and cloud models automatically, integrates with Fabric patterns, and keeps all your data local.

---

## Features

- **3-tier smart routing** — queries automatically routed to Ollama (free local), Claude Haiku ($1/M), or Claude Sonnet ($3/M) based on complexity, length, and your daily budget
- **Plugin system** — install JSON-manifest plugins with custom system prompts; activate via the TopBar picker or slash commands (`/review`, `/debug`, etc.)
- **Fabric integration** — browse and run any Fabric pattern through the REST API; streaming output rendered live in chat
- **SQLite persistence** — all conversations, messages, cost records, and settings stored in `~/.noah-ai-hub/conversations.db`
- **Conversation tags** — tag conversations, filter the list by tag, click any tag to search
- **Usage analytics** — 7-day spend chart, per-tier breakdown, message count stats
- **Prompt caching** — A.R.C. system prompt cached with `cache_control: ephemeral` — ~90% cost reduction on repeat messages
- **Ollama model manager** — pull models with live progress, delete, and get suggestions
- **Conversation export** — export any conversation to Markdown via the native Save dialog
- **Native Mac integration** — custom menu bar, system tray, titlebar buttons, keyboard shortcuts

---

## Requirements

| Dependency | Version | Purpose |
|------------|---------|---------|
| Node.js | 20+ | Build toolchain |
| Electron | 28 | Desktop shell |
| Ollama | Any | Local inference |
| Fabric | Any | Pattern runner |

---

## Setup

```bash
# 1. Clone and install
git clone <repo-url>
cd arcos
npm install

# 2. Start in dev mode
npm run dev

# 3. (Optional) Start Ollama and Fabric
ollama serve
fabric --serve
```

On first launch the app:
- Creates `~/.noah-ai-hub/` with `conversations.db` and `plugins/`
- Seeds 5 sample plugins in `~/.noah-ai-hub/plugins/`
- Auto-detects any installed Ollama models

---

## Configuration

Open **Settings** (⌘,) to configure:

| Setting | Description |
|---------|-------------|
| Claude API Key | Required for Haiku and A.R.C. Sonnet tiers |
| Daily budget | Routing falls back to local Ollama when limit is reached |
| Routing mode | Auto (default), or force a specific tier |
| Routing aggressiveness | Cost-first / Balanced / Quality-first |
| Ollama model | Auto-detected from installed models |

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| ⌘K | New chat |
| ⌘, | Open / close Settings |
| Esc | Close Settings |
| Enter | Send message |
| Shift+Enter | New line in message |
| ⌘+Shift+E | Export active conversation |

---

## Plugin System

Plugins live in `~/.noah-ai-hub/plugins/` as `.json` files.

### Manifest format

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "description": "What it does",
  "version": "1.0.0",
  "icon": "🔧",
  "tier": "arc-sonnet",
  "commands": ["/myplugin", "/mp"],
  "systemPrompt": "You are a specialized assistant that..."
}
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier (filename-safe) |
| `name` | string | Display name |
| `tier` | `ollama` \| `haiku` \| `arc-sonnet` | Preferred model tier |
| `commands` | string[] | Slash commands that auto-activate this plugin |
| `systemPrompt` | string | Replaces the A.R.C. prompt when plugin is active |

### Using plugins

- Click **🔌 Plugins** in the TopBar to browse and activate
- Type a slash command (e.g. `/review`) in the message box — the matching plugin activates automatically and the command prefix is stripped before sending
- Deactivate via the **✕** in the TopBar pill

### Pre-installed plugins

| Plugin | Commands | Tier |
|--------|----------|------|
| Code Reviewer | `/review`, `/cr` | A.R.C. |
| Writing Coach | `/write`, `/edit` | Haiku |
| SQL Assistant | `/sql`, `/query` | Haiku |
| Brainstorm | `/brainstorm`, `/ideas` | Local |
| Debugger | `/debug`, `/fix` | A.R.C. |

---

## Data Storage

All data is local to `~/.noah-ai-hub/`:

```
~/.noah-ai-hub/
├── conversations.db    ← SQLite: conversations, messages, spending, settings
└── plugins/
    ├── code-reviewer.json
    ├── writing-coach.json
    ├── sql-assistant.json
    ├── brainstorm.json
    └── debugger.json
```

---

## Building

```bash
# Development
npm run dev

# Package as macOS .app (universal arm64 + x64)
npm run build:mac

# Package without DMG (faster, for testing)
npm run build:dir
```

The packaged `.app` and `.dmg` are written to `dist/`.

---

## Architecture

```
src/
├── main/                    ← Electron main process (Node.js)
│   ├── main.ts              ← IPC handlers, app menu, tray
│   ├── database/
│   │   ├── db.ts            ← SQLite singleton (better-sqlite3)
│   │   ├── schema.ts        ← Table definitions
│   │   └── operations.ts    ← CRUD helpers
│   └── plugins/
│       └── loader.ts        ← Plugin discovery + seed
├── preload/
│   └── preload.ts           ← contextBridge security bridge
└── renderer/                ← React app (Vite)
    ├── stores/              ← Zustand stores (conversation, settings, service, cost, plugin)
    ├── services/            ← API clients (ollama, claude, fabric, chat router)
    └── components/          ← UI components
```

**Key patterns:**
- All HTTP calls (Ollama, Claude, Fabric API) run in the main process — no renderer CORS issues
- Tokens streamed back to renderer via `event.sender.send(`stream-${streamId}`, data)`
- Zustand mutations are synchronous (instant UI); DB writes are fire-and-forget async
- Messages only written to DB when `isStreaming` transitions to `false`

---

## Version History

| Version | Notes |
|---------|-------|
| 1.0.0 | Conversation tags, native menu, system tray |
| 0.7.0 | Plugin system with slash commands |
| 0.6.0 | SQLite persistence for all stores |
| 0.5.0 | Advanced features: analytics, model manager, onboarding |
| 0.4.0 | Polish: keyboard shortcuts, export, electron-builder |
| 0.3.0 | Fabric REST integration |
| 0.2.0 | Claude + Ollama streaming, smart routing |
| 0.1.0 | Initial scaffold |
