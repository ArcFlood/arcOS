# ARCOS — Build Progress
(hi there)
**Last updated:** 2026-04-03
**App version:** 2.2.0

> This file tracks implementation progress against the original WBS (`ai_hub_wbs.json`).
> Updated after each completed implementation step.

---

## Summary

| Phase | WBS Name | Our Build | Status |
|-------|----------|-----------|--------|
| P0 | Project Setup & Foundation | Electron + React + Vite scaffold | ✅ Complete |
| P1 | Core UI Components | All UI components | ✅ Complete |
| P2 | Local Storage & Data Management | SQLite via better-sqlite3 | ✅ Complete |
| P3 | Ollama Integration | IPC streaming, model auto-detect | ✅ Complete |
| P4 | Claude API Integration | IPC streaming + prompt caching | ✅ Complete |
| P5 | Fabric Integration | Real REST API + streaming patterns | ✅ Complete |
| P6 | Polish / Phase 4 | Keyboard shortcuts, export, packaging | ✅ Complete |
| P7 | Advanced Features | Analytics, model manager, onboarding | ✅ Complete |
| P8 | Plugin System | JSON manifests, slash commands, PluginPicker | ✅ Complete |
| P9 | Phase 9 / WBS Remainder | Conv tags, app menu, tray, docs, 0 TS errors | ✅ Complete |
| P10 | Security Hardening | API key isolation, plugin injection defense | ✅ Complete |
| P11 | PRD v2 / 4-Tier Model System | arc-opus, budget warnings, Qwen 3 defaults | ✅ Complete |
| P12 | FR-11 Observability & Session Logs | Routing log, session history, learnings, CSV export | ✅ Complete |
| P13 | ARC-Memory Integration | Local RAG over Obsidian vault, MCP server on :8082 | ✅ Complete |
| P14 | RAG Phase 2 — Quality | HyDE, reranker, compressor, file watcher | ✅ Complete |
| P15 | RAG Phase 4 — Bidirectional | Vault write-back, Open in Obsidian | ✅ Complete |

> Note: Our implementation combined WBS phases and re-ordered them for faster delivery.
> WBS P2 (SQLite) was deprioritized — data currently lives in Zustand (in-memory per session).

---

## Detailed Status

### P0 — Project Setup & Foundation ✅

| Task | WBS ID | Status | Notes |
|------|--------|--------|-------|
| Electron + React + TypeScript + Vite | P0.1 | ✅ Done | Electron 28, React 18, Vite 5 |
| Tailwind CSS with dark mode | P0.2 | ✅ Done | Custom A.R.C. color palette |
| Zustand state management | P0.3 | ✅ Done | 4 stores: conversation, settings, service, cost |
| Basic app layout structure | P0.4 | ✅ Done | Sidebar + TopBar + ChatArea |

### P1 — Core UI Components ✅

| Task | WBS ID | Status | Notes |
|------|--------|--------|-------|
| Message bubble components | P1.1 | ✅ Done | UserMessage, AssistantMessage, SystemMessage |
| Message input component | P1.2 | ✅ Done | Auto-resize, Enter to send, stop button |
| Service status cards | P1.3 | ✅ Done | Ollama + Fabric with start/stop |
| Conversation list | P1.4 | ✅ Done | Search, select, delete, new chat |
| Cost display components | P1.5 | ✅ Done | CostBadge, CostSummary, CostIndicator |
| Settings panel | P1.6 | ✅ Done | API key, budget, routing prefs, model dropdown |
| Model selector | P1.7 | ✅ Done | 3-tier: Ollama / Haiku / A.R.C. Sonnet |
| Fabric pattern selector | P1.8 | ✅ Done | Real API integration (see P5 below) |

### P2 — Local Storage & Data Management ✅ Complete

| Task | WBS ID | Status | Notes |
|------|--------|--------|-------|
| SQLite database schema | P2.1 | ✅ Done | 4 tables: conversations, messages, spending_log, settings |
| IPC bridge for DB operations | P2.2 | ✅ Done | 10 IPC handlers; db namespace in preload |
| Conversation persistence | P2.3 | ✅ Done | conversationStore reads/writes via `db.conversations` + `db.messages` on every mutation |
| Settings persistence | P2.4 | ✅ Done | settingsStore loads from `db.settings` on startup; persists on every change; strips legacy claudeApiKey on load |
| Cost tracking persistence | P2.5 | ✅ Done | costStore loads from `db.spending` on startup; 90-day auto-prune; writes on every record |

**Completed in P7.** SQLite via better-sqlite3, DB at `~/.noah-ai-hub/conversations.db`. All three stores fully migrated off localStorage.

### P3 — Ollama Integration ✅ (mapped to our Phase 2)

| Task | WBS ID | Status | Notes |
|------|--------|--------|-------|
| Ollama API client | P3.1 | ✅ Done | IPC-based streaming in main.ts |
| Model listing | P3.2 | ✅ Done | `ollama-list-models` IPC handler |
| Streaming chat | P3.3 | ✅ Done | Newline-delimited JSON, AbortController |
| Model auto-detection | P3.4 | ✅ Done | `autoFixOllamaModel()` in settingsStore |
| Service health check | P3.5 | ✅ Done | `service-status` IPC with pgrep |

**Bug fixed:** Default model was `qwen3:14b` (not installed). Auto-selects first available model from Ollama on startup.

### P4 — Claude API Integration ✅ (mapped to our Phase 2)

| Task | WBS ID | Status | Notes |
|------|--------|--------|-------|
| Claude streaming client | P4.1 | ✅ Done | IPC-based, runs in main process (no CORS) |
| Haiku middle tier | P4.2 | ✅ Done | `claude-haiku-4-5-20251001` |
| A.R.C. Sonnet tier | P4.3 | ✅ Done | `claude-sonnet-4-6` |
| Prompt caching | P4.4 | ✅ Done | `cache_control: ephemeral` on system prompt — ~90% cost reduction |
| A.R.C. prompt loading | P4.5 | ✅ Done | Loads from `~/.claude/Skills/CORE/SKILL.md`, 5-min cache, fallback |
| Smart 3-tier routing | P4.6 | ✅ Done | `routeQuery()` — complexity + budget aware |
| Usage tracking | P4.7 | ✅ Done | Input/output/cache tokens logged per message |

**Bug fixed:** Renderer CORS block on `api.anthropic.com`. Moved all fetch calls to main process, stream tokens back via IPC.

### P5 — Fabric Integration ✅ (our Phase 3 — just completed)

| Task | WBS ID | Status | Notes |
|------|--------|--------|-------|
| Pattern list from REST API | P5.1 | ✅ Done | `GET /api/patterns` with fallback to 7 hardcoded |
| Pattern execution via REST API | P5.2 | ✅ Done | `POST /api/pattern/{id}` — IPC-based, streaming |
| PatternSelector UI overhaul | P5.3 | ✅ Done | 2-panel: list → input → stream to chat |
| Fabric service health check | P5.4 | ✅ Done | Live badge in trigger button |
| fabricService.ts helper module | P5.5 | ✅ Done | `listFabricPatterns()`, `runFabricPattern()`, label/emoji/description helpers |
| Streaming response to chat | P5.6 | ✅ Done | Tokens streamed into assistant message in real-time |
| Offline/fallback behavior | P5.7 | ✅ Done | Shows 7 preview patterns when Fabric offline; Apply button disabled with message |

---

### P6 — Polish & Quality (our Phase 4) ✅ Complete

| Task | Status | Notes |
|------|--------|-------|
| Cmd+K → new chat | ✅ Done | `keydown` listener in Layout.tsx — works globally |
| Cmd+, → toggle settings | ✅ Done | Same listener; Escape also closes settings panel |
| Conversation export to Markdown | ✅ Done | `↓` button on hover in ConversationItem; native Save dialog via main process |
| Service status animations | ✅ Done | Pulsing ring on running services (CSS `animate-ping`); warning state during restart |
| Service card polish | ✅ Done | Border color transitions green when running; real log lines in logs panel |
| Package as .app (Mac) | ✅ Done | `npm run build:mac` — universal arm64+x64 DMG; entitlements.mac.plist added |
| Zustand persist middleware | ✅ Done | Settings persist to `localStorage` via `zustand/middleware`; conversations persist too |
| Streaming interrupt recovery | ✅ Done | `onRehydrateStorage` cleans up `isStreaming: true` messages left from app crash/close |
| App version bumped to 0.4.0 | ✅ Done | package.json |

### P7 — Advanced Features ✅ Complete

| Task | Status | Notes |
|------|--------|-------|
| costStore persist | ✅ Done | Spending records survive restarts; 90-day auto-prune on load |
| Analytics helpers | ✅ Done | `getRecordsByDay(n)` + `getRecordsByTier()` added to costStore |
| Ollama model manager | ✅ Done | Pull with progress bar, delete, suggestions list; Settings → Models tab |
| `ollama-pull-model` IPC | ✅ Done | Streams progress events (status, completed/total) via `stream-${id}` |
| `ollama-delete-model` IPC | ✅ Done | DELETE /api/delete to Ollama; refreshes model list after |
| Usage analytics panel | ✅ Done | 7-day daily spend bar chart, per-tier breakdown, message count stats |
| Analytics tab in Settings | ✅ Done | Settings → Analytics shows all charts + clear records button |
| First-run onboarding | ✅ Done | EmptyState shows 3-step checklist when no API key + Ollama offline |
| Onboarding auto-completes | ✅ Done | Steps tick off as Ollama starts and API key is entered |
| Routing mode/aggressiveness dropdowns | ✅ Done | Replaced hard-coded radio with proper selects in Settings → Routing tab |
| Keyboard shortcuts in About tab | ✅ Done | Full shortcut reference card |
| Model comparison mode | 🔲 Skipped | Side-by-side responses — out of scope |
| SQLite persistence | ✅ Done | `~/.noah-ai-hub/conversations.db`; all 3 stores migrated off localStorage |
| Plugin system | ✅ Done | See P8 below |

### P8 — Plugin System ✅ Complete

| Task | Status | Notes |
|------|--------|-------|
| Plugin manifest format (JSON) | ✅ Done | `id, name, description, version, icon, tier, commands[], systemPrompt` |
| Plugin loader (`src/main/plugins/loader.ts`) | ✅ Done | Scans `~/.noah-ai-hub/plugins/`, validates shape, sorts by name |
| Seed 5 sample plugins on first run | ✅ Done | Code Reviewer, Writing Coach, SQL Assistant, Brainstorm, Debugger |
| `plugins:list` IPC handler | ✅ Done | Returns validated manifests from disk |
| `plugins:install-file` IPC handler | ✅ Done | Native open-file dialog for `.json` install |
| `plugins:open-dir` IPC handler | ✅ Done | `shell.openPath()` to plugins folder |
| `pluginStore.ts` Zustand store | ✅ Done | `plugins[], activePlugin, loadPlugins(), activatePlugin(), deactivatePlugin(), findByCommand()` |
| `PluginPicker.tsx` TopBar UI | ✅ Done | Dropdown with plugin list, active state, install button, deactivate ✕ |
| Slash command auto-activation | ✅ Done | `/review`, `/debug`, etc. parsed in `handleSend()` — strip prefix, route to plugin tier |
| `chatService.ts` systemPromptOverride | ✅ Done | Active plugin's `systemPrompt` replaces A.R.C. prompt when set |
| `chatService.ts` tierOverride | ✅ Done | Plugin tier overrides 3-tier router decision |
| Routing preview shows plugin name | ✅ Done | "→ A.R.C. Plugin: Code Reviewer" visible before send |
| Layout bootstrap | ✅ Done | `loadPlugins()` called in `Promise.all` alongside settings/conversations/cost |

### P9 — WBS Completion Pass ✅ Complete

| Task | WBS ID | Status | Notes |
|------|--------|--------|-------|
| Conversation tags | P9.5 | ✅ Done | Tag badges on ConversationItem, autocomplete input, tag filter chips in ConversationList, `getAllTags()` + `tagFilter` + `setTagFilter()` in store |
| Native Mac app menu | P10.3 | ✅ Done | Full Mac menu bar: File/Edit/View/Window/Help; Cmd+K, Cmd+, Cmd+Shift+E; `menu:*` IPC events to renderer |
| System tray icon | P10.4 | ✅ Done | Tray with click toggle (show/hide), context menu (Show, New Chat, Quit) |
| README documentation | P10.5 | ✅ Done | Full README with setup, shortcuts, plugin format, architecture |
| Final testing / zero TS errors | P10.6 | ✅ Done | `tsc --noEmit` passes with 0 errors; pre-existing bugs fixed (unused imports, cacheReadTokens, unused router.ts deleted) |

---

### P10 — Security Hardening ✅ Complete

| Task | Status | Notes |
|------|--------|-------|
| API key isolation to main process | ✅ Done | Raw key stored in SQLite DB key `claude-api-key`; renderer gets only `hasApiKey: boolean`; never transits IPC after write |
| Write-only ApiKeyInput component | ✅ Done | Draft input never stored in state; Save button calls `apiKeySet` IPC; shows configured/not-configured badge only |
| Remove `claudeApiKey` from renderer state | ✅ Done | Stripped from `AppSettings`, `DEFAULT_SETTINGS`, `chatService.ts` SendOptions, `claudeService.ts` params |
| Plugin prompt injection defense | ✅ Done | `validateSystemPrompt()` in loader.ts: 8000-char cap + 8 injection regex patterns (ignore previous instructions, jailbreak, etc.) |
| Plugin ID sanitization | ✅ Done | IDs stripped to `[a-z0-9-_]` only before writing to disk |
| Security comments in main.ts | ✅ Done | `sandbox: false` and `webSecurity: !isDev` documented with rationale |

### P11 — PRD v2 / 4-Tier Model System ✅ Complete

| Task | Status | Notes |
|------|--------|-------|
| Add `arc-opus` tier | ✅ Done | `claude-opus-4-6`, $5/$25 per MTok, `manualOnly: true` — never auto-routed |
| Update MODEL_REGISTRY | ✅ Done | All 4 tiers: ollama / haiku / arc-sonnet / arc-opus |
| Update RoutingMode type | ✅ Done | Includes `arc-opus` for manual override only |
| Update all `Record<ModelTier, ...>` maps | ✅ Done | MessageBadge, MessageInput, PluginPicker, costStore, AnalyticsPanel all updated |
| Budget warning banner | ✅ Done | Yellow warning at `$10` (configurable), hard block at `$15`; shown in AnalyticsPanel |
| Qwen 3 14B default Ollama model | ✅ Done | `modelId: 'qwen3:14b'` in MODEL_REGISTRY |
| CSV export for spending | ✅ Done | `spending:export-csv` IPC handler; Export button in AnalyticsPanel |
| `budgetWarnLimit` setting | ✅ Done | Added to AppSettings and DEFAULT_SETTINGS |
| Version bump to 2.0.0 | ✅ Done | package.json |

### P12 — FR-11 Observability & Session Log System ✅ Complete

| Task | Status | Notes |
|------|--------|-------|
| Routing JSONL log | ✅ Done | `~/.noah-ai-hub/logs/routing-YYYY-MM-DD.jsonl`; IPC handlers: `routing:append`, `routing:get-entries`, `routing:get-dates` |
| Session summary writer | ✅ Done | `session:write-summary` → `~/.noah-ai-hub/sessions/YYYY-MM-DD-HH-mm.md`; includes model breakdown, costs, Fabric patterns used |
| SessionHistoryPanel | ✅ Done | Right-side drawer; date-sorted session list + markdown content viewer; accessible via Cmd+Shift+H and sidebar button |
| Weekly Digest card | ✅ Done | `WeeklyDigest.tsx` shown on Mondays; 7-day spend, session count, message count; localStorage guard prevents repeat shows |
| Learnings / bookmarks | ✅ Done | ☆/★ bookmark button on AssistantMessage; `learnings:save` IPC writes to `~/.noah-ai-hub/learnings/`; `learnings:open-dir` IPC |
| Session History in Help menu | ✅ Done | Native menu item triggers `menu:open-history` IPC event |
| Preload + electron.d.ts types | ✅ Done | All FR-11 IPC bridges typed: RoutingEntry, SessionFile, SessionSummaryData |

### P14 — RAG Phase 2 — Quality Improvements ✅ Complete (v2.2.0)

| Task | Status | Notes |
|------|--------|-------|
| `retrieval/hyde.py` | ✅ Done | HyDE query expansion via qwen3:14b; SQLite cache at `~/.noah-ai-hub/memory/hyde_cache.db`; falls back to raw query on error |
| `retrieval/reranker.py` | ✅ Done | Lazy-loaded `cross-encoder/ms-marco-MiniLM-L-6-v2`; top-k by rerank score; graceful fallback to original score order |
| `prompting/compressor.py` | ✅ Done | 2000-token budget; top-1 always verbatim; lower-ranked chunks summarized via qwen3:14b if over budget |
| `watcher/file_watcher.py` | ✅ Done | watchdog Observer; 300ms debounce per-path; Created/Modified → ingest, Deleted → remove from LanceDB; lock file guard |
| `mcp_server/server.py` v2.0.0 | ✅ Done | 4-step async pipeline: HyDE → hybrid_search → reranker → compressor; `use_hyde/use_reranker/compress` flags; file watcher in lifespan |
| pyproject.toml 0.2.0 | ✅ Done | Version bump; `watcher` package added |

### P15 — RAG Phase 4 — Bidirectional Integration ✅ Complete (v2.2.0)

| Task | Status | Notes |
|------|--------|-------|
| `memory:vault-write` IPC handler | ✅ Done | Parses `memory-service/.env` for VAULT_PATH; writes `arcos/YYYY-MM-DD_slug.md` with `source: arcos` frontmatter; file watcher auto-indexes within 5s |
| `memory:vault-path` IPC handler | ✅ Done | Returns VAULT_PATH to renderer for display/validation |
| `saveConversationToVault()` util | ✅ Done | Added to `exportConversation.ts`; wraps `memoryVaultWrite` IPC call |
| "Save to Vault" button | ✅ Done | Hex icon (⬡) in ConversationItem hover row; turns ✓ for 2s on success; disabled when conversation has no messages |
| Open in Obsidian button | ✅ Done | Added to `ChunkCard` in MemoryPanel; matches chunk to citation by `source_path`; calls `openExternal(obsidian_uri)`; uses `obsidian://open?vault=...` URI |
| `memoryVaultWrite` + `memoryVaultPath` preload bindings | ✅ Done | Exposed via contextBridge; typed in `electron.d.ts` |
| TypeScript 0 errors | ✅ Done | `tsc --noEmit` clean after all Phase 4 changes |

### P13 — ARC-Memory Integration ✅ Complete (v2.1.0)

| Task | Status | Notes |
|------|--------|-------|
| `memory-service/` Python project | ✅ Done | Copied into arcos repo; managed via `uv` package manager |
| `ingestion/obsidian_reader.py` | ✅ Done | Walks vault, validates `source:` frontmatter, SHA256 hash per file, `ConversationDoc` dataclass |
| `ingestion/chunker.py` | ✅ Done | Hierarchical: index-0 summary chunk (200 tok) + section chunks (600 tok, 100 overlap); respects speaker boundaries |
| `ingestion/embedder.py` | ✅ Done | nomic-embed-text via Ollama `/api/embeddings`; batch=50; exponential backoff (3 retries) |
| `ingestion/lancedb_writer.py` | ✅ Done | Upsert by `conversation_id` (delete+insert); hash-skip unchanged files; FTS index on `text` column |
| `ingestion/run_ingest.py` | ✅ Done | tqdm progress bar; skips unchanged files; writes manifest to `~/.noah-ai-hub/memory/last_ingest.json` |
| `retrieval/hybrid_search.py` | ✅ Done | LanceDB `query_type="hybrid"` (vector + BM25); optional `date_after` filter; vector fallback if FTS index not ready |
| `mcp_server/server.py` | ✅ Done | FastAPI on `:8082`; `GET /status`, `POST /query`, `POST /ingest` (background task); CORS for localhost |
| ARC-Memory added to service manager | ✅ Done | `ServiceName` type extended; `service-status/start/stop` IPC handles `arc-memory`; starts via `uv run python -m mcp_server.server` |
| `memory-query` / `memory-ingest` / `memory-status` IPC | ✅ Done | 3 new handlers in main.ts; proxy to `:8082`; 8s timeout on query |
| `memoryService.ts` | ✅ Done | Typed wrapper: `searchMemory()`, `getMemoryStatus()`, `triggerIngest()`, `sourceLabel()`, `sourceColor()` |
| `MemoryPanel.tsx` | ✅ Done | Right-side drawer; search bar → chunk result cards with expand/collapse; index status view with ingest trigger |
| Sidebar Memory Search button | ✅ Done | Added above Session History; `Cmd+Shift+M` keyboard shortcut |
| TypeScript 0 errors | ✅ Done | All pre-existing TS errors also fixed: arc-opus in all Record maps, claudeApiKey refs removed, `activeConversation()` call fix |
| Version bump to 2.1.0 | ✅ Done | package.json |

---

## Architecture Decisions

**IPC Streaming Pattern** — All API calls (Ollama, Claude, Fabric) run in the Electron main process to avoid CORS. Tokens streamed back to renderer via `event.sender.send(`stream-${streamId}`, data)`. UUID-based stream IDs prevent collisions. AbortController wired through for stop functionality.

**4-Tier Routing** — `routeQuery()` in MessageInput makes automatic tier decisions based on: query complexity, word count, code detection, budget guard, user aggressiveness setting. arc-opus is manual-only (`manualOnly: true`) — never auto-routed. Routing reason shown in chat when enabled.

**Prompt Caching** — A.R.C. system prompt sent with `cache_control: { type: 'ephemeral' }`. Anthropic caches for 5 minutes, reducing input token cost by ~90% on subsequent calls.

**Fabric REST vs child_process** — Original WBS suggested spawning `fabric` as a child process. We use the REST API (`fabric --serve`) instead — cleaner, no stdout parsing, easier streaming.

**API Key Isolation (P10)** — Raw Claude API key is written to SQLite by main process only (`claude-api-key` setting key). Renderer never holds the raw key — only a `hasApiKey: boolean`. This prevents the key from appearing in renderer memory dumps or transiting IPC on every message.

**Plugin Injection Defense (P10)** — Before writing any plugin JSON, `validateSystemPrompt()` checks: (1) length ≤ 8000 chars, (2) text doesn't match 8 injection patterns (e.g., "ignore previous instructions", "you are now", "jailbreak"). Plugin IDs are sanitized to `[a-z0-9-_]` only.

**ARC-Memory MCP Pattern (P13)** — Memory service mirrors Fabric exactly: Python FastAPI on `:8082`, managed by the same `service-status/start/stop` IPC handlers, shown as a ServiceCard in the sidebar. This makes future services (e.g., a code indexer) trivially addable. LanceDB was chosen over Chroma for embedded operation (no separate server process) and native hybrid search support. nomic-embed-text via Ollama means zero embedding cost and zero privacy leak — embeddings never leave the machine.

**RAG Quality Pipeline (P14)** — Phase 2 adds a 4-step query pipeline: (1) HyDE generates a hypothetical answer and embeds that instead of the raw query — better recall for semantic mismatch queries; (2) cross-encoder reranker (`ms-marco-MiniLM-L-6-v2`) rescores top-20 hits with precise relevance scores; (3) context compressor summarizes lower-ranked chunks with qwen3:14b if the total exceeds 2000 tokens; (4) file watcher auto-indexes vault changes within 5 seconds. All Phase 2 components have graceful fallbacks — if qwen3:14b is unavailable, HyDE and compression degrade silently.

**Vault Write-Back (P15)** — Conversations can be pushed directly to the Obsidian vault via the ⬡ button on each ConversationItem. The main process reads `VAULT_PATH` from `memory-service/.env`, writes `VAULT_PATH/arcos/YYYY-MM-DD_slug.md` with `source: arcos` frontmatter, and the file watcher auto-indexes it within 5s — closing the full loop: ARCOS → Obsidian vault → ARC-Memory search. The "Open in Obsidian" button in MemoryPanel chunk cards uses the `obsidian://open?vault=...` URI scheme (available via `obsidian_uri` field returned by `/query`).

---

## File Tree

```
arcos/
├── memory-service/                      ← ARC-Memory Python project (P13)
│   ├── pyproject.toml                   ← uv deps: lancedb, fastapi, uvicorn, watchdog
│   ├── ingestion/
│   │   ├── obsidian_reader.py           ← Parse .md + frontmatter, SHA256 hash
│   │   ├── chunker.py                   ← Hierarchical chunking (600 tok, 100 overlap)
│   │   ├── embedder.py                  ← nomic-embed-text via Ollama, batch=50
│   │   ├── lancedb_writer.py            ← Upsert + FTS index, hash dedup
│   │   └── run_ingest.py                ← Orchestrator with tqdm + manifest
│   ├── retrieval/
│   │   ├── hybrid_search.py             ← LanceDB vector + BM25 hybrid query
│   │   ├── hyde.py                      ← HyDE query expansion (qwen3:14b) + SQLite cache (P14)
│   │   └── reranker.py                  ← cross-encoder/ms-marco-MiniLM-L-6-v2 reranking (P14)
│   ├── prompting/
│   │   └── compressor.py                ← Token-budget context compression (P14)
│   ├── watcher/
│   │   └── file_watcher.py              ← watchdog Observer, 300ms debounce (P14)
│   └── mcp_server/
│       └── server.py v2.0.0             ← FastAPI :8082; HyDE→search→rerank→compress pipeline (P14)
├── src/
│   ├── main/
│   │   ├── main.ts                      ← All IPC: Ollama, Claude, Fabric, Memory, vault-write, services, plugins
│   │   ├── database/
│   │   │   ├── db.ts                    ← SQLite singleton
│   │   │   ├── schema.ts                ← 4-table schema
│   │   │   └── operations.ts            ← CRUD helpers
│   │   ├── plugins/
│   │   │   └── loader.ts                ← Scan ~/.noah-ai-hub/plugins/; injection defense (P10)
│   │   ├── logger.ts                    ← Structured app log (FR-11)
│   │   ├── routingLog.ts                ← JSONL routing decisions per-day (FR-11)
│   │   └── sessionHistory.ts            ← Session summaries, learnings, CSV export (FR-11)
│   ├── preload/
│   │   └── preload.ts                   ← contextBridge security bridge
│   └── renderer/
│       ├── electron.d.ts                ← TypeScript types for window.electron
│       ├── stores/
│       │   ├── types.ts                 ← ModelTier (4-tier), ServiceName (inc. arc-memory)
│       │   ├── conversationStore.ts
│       │   ├── settingsStore.ts         ← hasApiKey, checkApiKey(), setApiKey() (P10)
│       │   ├── serviceStore.ts          ← ollama + fabric + arc-memory (P13)
│       │   ├── costStore.ts             ← 4-tier rates, arc-opus support
│       │   └── pluginStore.ts
│       ├── services/
│       │   ├── arcLoader.ts             ← Load A.R.C. SKILL.md prompt
│       │   ├── chatService.ts           ← Route to Ollama / Haiku / Sonnet / Opus
│       │   ├── ollamaService.ts         ← IPC streaming wrapper
│       │   ├── claudeService.ts         ← IPC streaming wrapper (no apiKey param — P10)
│       │   ├── fabricService.ts         ← IPC streaming wrapper
│       │   └── memoryService.ts         ← searchMemory, getMemoryStatus, triggerIngest (P13)
│       └── components/
│           ├── Layout.tsx               ← Memory panel state + Cmd+Shift+M (P13)
│           ├── Sidebar.tsx              ← Memory Search + Session History buttons
│           ├── TopBar.tsx
│           ├── ChatArea.tsx
│           ├── MessageInput.tsx         ← 4-tier routing labels + colors
│           ├── messages/
│           │   ├── AssistantMessage.tsx ← BookmarkButton (☆/★) for learnings (FR-11)
│           │   ├── MessageBadge.tsx     ← arc-opus pink badge
│           │   └── CopyButton.tsx
│           ├── memory/
│           │   └── MemoryPanel.tsx      ← Search drawer + chunk cards + Open-in-Obsidian button (P13/P15)
│           ├── history/
│           │   ├── SessionHistoryPanel.tsx ← Session log viewer (FR-11)
│           │   └── WeeklyDigest.tsx     ← Monday digest card (FR-11)
│           ├── services/
│           ├── conversations/
│           ├── cost/
│           │   └── AnalyticsPanel.tsx   ← arc-opus tier, budget warning, CSV export (P11)
│           ├── models/
│           ├── patterns/
│           ├── plugins/
│           ├── debug/
│           │   └── ErrorLogPanel.tsx    ← Structured log viewer (FR-11)
│           └── settings/
│               └── ApiKeyInput.tsx      ← Write-only, status badge only (P10)
```

---

*This file is updated after each completed phase step.*

---

## RAG WBS Status

| Phase | Tasks | Status |
|---|---|---|
| Phase 1 — Working Retrieval | 1.0–8.0 | ✅ Complete |
| Phase 2 — Quality (HyDE, reranker, compressor, watcher) | 9.0–12.0 | ✅ Complete |
| Phase 2 — Quality Validation | 13.0 | Pending manual testing |
| Phase 3 — ARCOS Integration | 14.0, 16.0 | ✅ Complete (done as P13) |
| Phase 3 — /memory Slash Command | 15.0 | Deferred — MemoryPanel drawer implemented instead |
| Phase 4 — Bidirectional | 17.0, 18.0 | ✅ Complete |
| Phase 4 — Final QA | 19.0 | Pending end-to-end user testing |
