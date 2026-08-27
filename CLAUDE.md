# CLAUDE.md

> _"Ship with care, read before you write, and leave the codebase better than you found it. Every small, well-made change compounds."_
>
> _"Simplicity is the soul of efficiency — the best code is the code you didn't have to write."_
>
> _"Slow is smooth, and smooth is fast. Understand the problem before you reach for the keyboard."_
>
> _"Name things so the next reader needs no comment; the clearest code explains itself."_
>
> _"Delete more than you add. Dead code is a debt the next reader pays in confusion."_
>
> _"Make it work, make it right, make it fast — and never skip the middle step."_
>
> _"Leave a trail the next reader can follow; today's obvious choice is tomorrow's mystery."_
>
> _"Match the code around you; consistency is a kindness that outlives cleverness."_
>
> _"Test the seams, not the center; bugs hide where two certainties meet."_
>
> _"Fix the cause, not the symptom; a patched crack still runs to the foundation."_

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install                    # install dependencies (uses both npm and bun.lock; bun is required for the OpenTUI runtime)
npm run dev                    # Next.js dev server (http://localhost:3000)
npm run build                  # production Next.js build
npm run start                  # serve production build
npm run tui                    # primary OpenTUI terminal app (requires Bun on PATH)
npm run tui:dev                # OpenTUI with --watch
npm run tui:check              # type-check OpenTUI surface (tsc --noEmit via tsconfig.opentui.json)
npm run tui:ink                # legacy Ink TUI
```

Three lockfiles coexist: `package-lock.json` (npm, primary), `bun.lock` (Bun, used by `npm run tui`), and `pnpm-lock.yaml` (pnpm, optional). `pnpm-workspace.yaml` only declares pnpm `allowBuilds` policy — this is **not** a workspace/monorepo. Keep all three lockfiles in sync when bumping dependencies.

There is no test runner and no lint script. Type-checking is the verification step:

- Web/Next.js: `npx tsc --noEmit` (uses `tsconfig.json`)
- OpenTUI: `npm run tui:check` (uses `tsconfig.opentui.json` with `jsxImportSource: "@opentui/react"`)
- Legacy Ink TUI: `tsconfig.tui.json` covers `tui/**` + `lib/**`

`bin/agent-viewer.mjs` is the published `npx agent-viewer` entrypoint — it dispatches to OpenTUI (default), `web` (Next.js), or `--legacy` (Ink). Adding flags or modes belongs here. `--attach <url|port>` connects the OpenTUI app to a running `agent-viewer web` daemon instead of running the backend in-process (env `AGENT_VIEWER_ATTACH`, transport in `lib/tui/remote.ts`): turns run server-side, survive TUI restarts, and share the running-turn registry with the web UI. Git-based features (worktree tasks, checkpoints) stay local — attach assumes the daemon shares the machine/mounts. `agent-viewer pair` mints a pairing code against a running daemon and prints a terminal QR (the headless path to adding a phone); `--host <address>` sets the web bind address explicitly instead of inferring it from whether remote access happens to be enabled.

## Architecture

### Multi-provider session backend

The app is a unified UI over five separate agent runtimes: **Claude** (`@anthropic-ai/claude-agent-sdk`), **Codex** (app-server), **OpenCode** (`@opencode-ai/sdk`), **GitHub Copilot** (`@github/copilot-sdk`), and **Pi** (`@mariozechner/pi-coding-agent`). Do not re-introduce direct JSONL parsing — providers are accessed only through their SDKs.

Each provider follows the same pattern in `lib/`:

- `<provider>Client.ts` — SDK wiring, server-singleton client, session listing/resume
- `<provider>Mapper.ts` — translates provider-native events into the shared `SessionMessage` shape
- `<provider>Tags.ts` / `<provider>Metadata.ts` — local-only tag/title overrides for providers that can't mutate their own metadata (stored under `.agent-viewer-data/`)

`lib/sessionBackend.ts` is the unified facade: it reads the active provider from `lib/providerState.ts` and routes to that provider's implementation. `lib/provider.ts` declares per-provider `SessionCapabilities` (which controls reflect in the UI: fork, rewind, rollback, delete, share, summarize, etc.).

**Read path — `lib/adapters/`.** Every read/metadata op (list, session info, title/tag, delete, transcript, subagents, models, composer options, slash commands, diagnostics) goes through a `SessionAdapter` (`lib/adapters/types.ts`), one file per provider, resolved by `lib/adapters/registry.ts`. `sessionBackend.ts` keeps the shared work — instance decoration, inbox ordering, search-index sync and removal, message windowing — and adapters return only the provider's own data.

Two rules make this safe to extend:

- **An op a provider cannot do is an omitted method, never a stub.** How an omission behaves is documented per method in `types.ts`: some ops have a genuine empty answer (a provider with no subagents has none), others raise, because an empty transcript and an unreadable one must not look alike.
- **`registry.ts` asserts capabilities and adapters agree** at module load, so a `SessionCapabilities` flag cannot drift away from the method backing it. Add new pairs to `CAPABILITY_METHODS` as ops move behind the interface.

Adapters must stay stateless — they are resolved per *provider instance* (`lib/providerRequest.ts`), so two Claude instances with different `CLAUDE_CONFIG_DIR`s cannot share state. Warm resources belong in the existing per-instance pools. Keep each adapter file under ~800 lines; split by concern before it grows past that.

**Send path — still a provider switch in `sessionBackend.ts`.** Turn streaming, prewarm, fork, rewind/rollback, and interrupt have not moved behind the interface yet; that is where the remaining `provider === '…'` branches live.

Supporting modules split out of `sessionBackend.ts` so both paths can share them without an import cycle through the registry: `lib/mappedMessagesCache.ts` (LRU transcript cache), `lib/liveTranscripts.ts` (Copilot/Pi in-flight turn buffers), `lib/codexThreads.ts` (thread read/resume/error classification), `lib/opencodeSessions.ts`, `lib/claudeSessionReads.ts`, `lib/claudeModels.ts`, `lib/withTimeout.ts`, and the composer vocabularies in `lib/adapters/shared.ts` / `lib/copilotComposer.ts` / `lib/piComposer.ts`.

`lib/types.ts` defines the canonical wire format. Every provider must produce `SessionMessage { type, uuid, session_id, message: ApiMessage|SystemMessagePayload, parent_tool_use_id, timestamp?, origin?, provider? }`. `lib/threading.ts` `buildThreadedMessages()` then groups tool_use/tool_result pairs and parses XML tags into the renderer-ready blocks consumed by `MessageItem.tsx` and the TUI formatters.

#### ACP-transport providers (`claude-acp`, `codex-acp`)

Sibling provider ids that drive `claude-agent-acp`/`codex-acp` over the Agent Client Protocol (`session/new → session/prompt → session/update`) as an alternate transport for the same two SDKs — not a `transport` flag on `'claude'`/`'codex'`, and not something OpenCode/Copilot/Pi get (no upstream ACP agent exists for them). `lib/acpAgentSpawn.ts` resolves the subprocess command (env override `CLAUDE_AGENT_ACP_PATH`/`CODEX_ACP_PATH`, else bare command on `PATH`) — the coordinator's `bin/agent-viewer-acp-client.mjs` hand-duplicates this table rather than importing it, since it runs under vanilla `node` with no TS loader. `lib/acpClientPool.ts` is the singleton subprocess/session pool (modeled on `lib/claudePool.ts`): buffers push-based `session/update` notifications into a monotonically indexed array so `lib/sessionBackend.ts`'s poll+offset message model can slice it, queues `session/request_permission`/`elicitation/create` for a real UI round-trip, and reaps idle/stalled subprocesses. `lib/acpMapper.ts` maps buffered ACP updates to `SessionMessage`. `lib/permissions.ts` bridges the pool's pending-request queue into the same `PendingPermission` UI every other provider uses.

ACP has no session-listing, fork, rewind/rollback, delete, or model-listing RPC — sessions are transient/in-memory only (tracked from creation via `lib/sessionRuntime.ts`'s running-session registry, not persisted history), and `sessionBackend.ts` throws/no-ops those operations explicitly rather than faking support. `createAcpStream` (the send-message path) polls the pool's buffer every ~200ms and emits delta frames until the turn's `stop` update arrives — coarser than native providers' token-level streaming, an accepted v1 trade-off matching `lib/acpAgent.ts`'s own precedent.

`lib/acpClientPool.ts`'s `cleanupChild` kills the full descendant tree on close/reap, not just the direct subprocess: both agents spawn their real worker in its own session that escapes a plain process-group signal — `claude-agent-acp` execs the actual `claude` CLI as a separate-session child, and `codex-acp`'s app-server spawns its sandboxed exec helper the same way, sometimes moments *after* the initial signal (its own reaction to `session/cancel`/shutdown). A `detached: true` spawn + one `process.kill(-pid, sig)` alone verifiably leaves these orphaned. The fix walks the live tree via `pgrep -P` (`collectDescendantPids`, recursive) and re-polls + re-kills every ~500ms across a 3s SIGTERM window before a final SIGKILL sweep, instead of a single snapshot-then-kill. Verified E2E for both providers with the pool's own process kept alive throughout the check (no pipe-close masking a real leak).

#### Claude warm-pool reuse rules (load-bearing)

`lib/claudePool.ts` keeps one warm `query()` subprocess per session. What forces a respawn is deliberate:

- **Live-applied, no respawn:** `model` (`setModel`), `permissionMode` (`setPermissionMode`), and `effort` between two *named levels* (`applyFlagSettings({ effortLevel })` — the only path that accepts the session-scoped `'max'`). A failed live apply sets `pendingRecycleReason` instead of recycling immediately, so it can't kill a live turn.
- **Still respawns:** `cwd`, `taskBudget`, `resumeSessionAt`/`forkSession`, and any effort transition touching `off`/`minimal` — those map to a `thinking` config, and thinking has no live control method. Dropping that distinction would leave a warm entry thinking after the user turned it off.
- **`worker_shutting_down`** marks the entry doomed (`pendingRecycleReason`) so `acquire`/`peek` never hand it out for a new turn. An in-turn doomed entry is still reused — recycling it there kills the live turn out from under its SSE stream.

### Web app (Next.js 16, React 19)

Routes live under `app/api/`:

- `provider/route.ts` — GET/POST active provider
- `sessions/route.ts` — list for active provider; `sessions/project/messages/route.ts` for cross-session project feed
- `sessions/[sessionId]/{route,messages,diagnostics,fork,interrupt,models,rewind,actions}/route.ts` — per-session reads + control actions
- `sessions/[sessionId]/subagents/[agentId]/messages/route.ts` — nested transcript for spawned subagents
- `session-index/{search,rebuild,stats}/route.ts` — full-text search over the persistent SQLite index (see Persistent search index below)
- `git/route.ts`

`proxy.ts` (Next 16's middleware replacement, lives at project root) blocks cross-origin mutation requests against `/api/*` to prevent drive-by CSRF — keep it.

`next.config.ts` marks Claude/Pi SDKs as `serverExternalPackages` because they rely on Node APIs and cannot be bundled. Do not import them from client components.

The page (`app/page.tsx`) drives polling: sessions list every 5s, active-session messages every 2s with an `offset` param for incremental delta. `MessageView.tsx` uses a custom absolute-positioning virtual scroll (`ResizeObserver` per-row + RAF batching), not `react-window`.

### Persistent search index

`lib/sessionPersistence.ts` mirrors session metadata + messages into a SQLite database at `.agent-viewer-data/session-index/index.sqlite`. The file is large (~1570 lines) and load-bearing — it backs `/api/session-index/{search,rebuild,stats}` and the in-app session search UI. Key entry points: `syncPersistedSessions`, `syncPersistedSessionMessages`, `searchPersistedSessions`, `readPersistedIndexStats`, `removePersistedSession`, `clearPersistedSessionIndex`.

**`node:sqlite` import quirk** (load-bearing — see commit `5099252`): `node:sqlite` cannot be statically imported because Turbopack/Next bundling rewrites it and breaks the runtime. Use the existing `(0, eval)('import("node:sqlite")')` indirection inside `openDatabase()` to bypass the bundler — do not "clean up" this eval.

### Theming

~30 themes — the five originals (`dark`, `light`, `terminal`, `imessage`, `paper`) plus popular editor palettes (`solarized-*`, `gruvbox-*`, `nord*`, `tokyo-night*`, `catppuccin-*`, `dracula`, `monokai`, `kanagawa`, `ayu-*`, etc.). Web themes are registered in `lib/themes.ts` (`Theme` union + `THEMES`/`THEME_GROUPS`/`THEME_META`); each maps to a `[data-theme="…"]` block in `app/globals.css`. TUI themes are registered separately in `lib/tuiState.ts` (`VALID_TUI_THEMES`) with palette tables in `tui/theme.ts` — adding a theme means touching both registries. Theme is restored before first paint by an inline script in `layout.tsx`. Tool colors use semantic CSS vars (`--t-bash`, `--t-edit`, …). Code-block syntax theme is independent, controlled via `CodeThemeContext`.

### Two terminal UIs

The TUI is mid-migration from Ink to OpenTUI. Both share the `lib/tui/service.ts` reader and `tui/format.ts` card formatters; they diverge only in the renderer.

- **OpenTUI** (`tui/opentui/`, primary): `@opentui/react`. Entry `tui/opentui/main.tsx` runs under Bun. Uses `@jsxImportSource @opentui/react`. Background work (analytics, threading, metadata, session detail) is offloaded to worker files in `tui/opentui/*Worker.ts` with matching `*WorkerClient.ts` wrappers — keep that split when adding heavy computation.
- **Ink** (`tui/App.tsx`, legacy): React for terminal via `node --import tsx`. Shipped with `--legacy` flag.

Both TUIs depend on the same `lib/` provider layer — changes to `sessionBackend.ts`, mappers, or `threading.ts` affect web and TUI alike.

#### OpenTUI performance patterns (load-bearing)

- **Poll fingerprint bail-out** in `setSessionDetail`: return `prev` when `rawMessages.length`, last UUID, model, and title are unchanged so React's identity bail-out skips a full transcript reformat on idle 2s polls.
- **`cardDisplayData` useMemo** pre-computes landmarks, bodyLines, diffText, headerMeta for all cards; the render `.map()` reads from this stable cache rather than recomputing per render.
- **Place static content outside `scrollbox`** — the scrollbox has a fixed `height: transcriptViewportRows` budget. The live-mode spinner intentionally lives outside it.
- **Module-level constants** for static option arrays (e.g. `PROVIDER_SELECT_OPTIONS`); not inside the component body.
- Use **BMP-safe glyphs** (e.g. `●` U+25CF, not `⏺`) — terminal renderers truncate astral chars on Windows.

### Remote access

Opt-in pairing for a phone or a second browser, off by default. `lib/remoteAuth.ts` owns two
credential kinds that are deliberately different:

- A **pairing token** is what the QR carries: single-use, ~10 minute TTL, stored in plaintext so the
  popover can re-render the same code while it is live. It rides in the URL **hash**
  (`/pair#token=…`, `app/pair/page.tsx`) so it never reaches the server or any access log.
- A **device session secret** is what a paired device keeps. It is returned exactly once by
  `POST /api/remote/handshake` as an httpOnly cookie (`<sessionId>.<secret>`) and persisted only as
  a SHA-256 hash, so the state file cannot be replayed as a device. One session per device, so
  revoking one phone leaves the others paired.

`proxy.ts` calls `evaluateRequestTrust()` and enforces the two scopes — `full` and `read-only`,
where read-only means "no mutating methods". Keep it at two: a scope set can widen later, it cannot
shrink.

**`lib/remoteAuth.ts` and `lib/remoteEndpoints.ts` must not cache their state files in module
scope** (load-bearing). Next gives `proxy.ts` and the route handlers *separate module instances*, so
a cache in one never sees writes made by the other — an earlier version let a revoked device keep
working because the proxy's copy was stale. Reads only happen for genuinely remote requests; local
callers short-circuit before touching disk.

`lib/remoteEndpoints.ts` enumerates every interface and tags it `loopback | lan | private | tunnel`,
persisting the user's default **by kind, not by literal address** — a remembered IP stops matching
the moment DHCP hands out a new lease. `lib/tailscale.ts` is an opt-in *endpoint provider* on top of
that, not a new connection kind: tailnet addresses become extra `listAdvertisedEndpoints()` entries
and pair through the ordinary bearer path. A missing or logged-out Tailscale reports
`available`/`running` false and is never an error.

Upgrade path: the pre-per-device state file (`{ enabled, token, createdAt }`) migrates on read into
one device session with a fixed id, so already-paired devices keep working rather than being
silently signed out.

### Local data

`.agent-viewer-data/` (gitignored) stores per-provider local-only state: tags, title overrides, selected provider. Do not commit it; do not expect it to exist on first run.

### Stack notes

- Tailwind v4 + shadcn UI (`components/ui/`); `components.json` is the registry config — use `npx shadcn add <component>` rather than hand-writing.
- React 19 with View Transitions (stable `ViewTransition` from `'react'`, used directly in `components/RouteTransition.tsx`/`TabBar.tsx`/`app/page.tsx` — no `next.config.ts` flag needed as of Next 16.3, which dropped `experimental.viewTransition`).
- Fonts: Oxanium (display), IBM Plex Sans (body), IBM Plex Mono (code).
- TypeScript path alias: `@/*` → repo root.

## Working with the large files

A handful of files dominate the codebase. **Don't `Read` these without `offset`/`limit`** — `Grep` for the symbol first to find a line number, then read a 100–200 line window around it.

| File | Lines | What lives there |
|---|---:|---|
| `tui/opentui/App.tsx` | ~4570 | OpenTUI root; entire reader, composer, key handling, `cardDisplayData` memo, scrollbox layout |
| `components/MessageView.tsx` | ~4220 | Web virtual-scroll timeline, top bar, session controls, `VirtualTimelineRow`, `handleTimelineRowMeasure` |
| `components/MessageItem.tsx` | ~3240 | Renderer for every threaded block — all tool cards (bash/edit/read/grep/glob/agent/etc.) live here |
| `tui/App.tsx` | ~2450 | Legacy Ink TUI root |
| `lib/sessionBackend.ts` | ~7000 | Send/turn path per-provider switch, plus the router that dispatches read ops to `lib/adapters/` |
| `components/SessionList.tsx` | ~2050 | Sidebar: project grouping, search, tag filters, collapsible groups |
| `lib/sessionPersistence.ts` | ~1570 | SQLite mirror of sessions+messages; powers `/api/session-index/*` search/rebuild/stats |
| `components/GitPopover.tsx` | ~1370 | Git diff/branch popover |
| `tui/opentui/AnalyticsPopover.tsx` | ~1150 | OpenTUI analytics overlay (separate impl from the web one) |
| `components/AnalyticsPopover.tsx` | ~1050 | Recharts analytics |
| `components/CommandPalette.tsx` | ~1010 | Web cmd-K palette: provider switch, theme, session actions, navigation — single registry of user-facing commands |
| `app/globals.css` | ~1000 | All ~30 themes' CSS vars + base styles (each `[data-theme="…"]` block is contiguous) |
| `tui/format.ts` | ~915 | `formatTranscriptCards` / `formatMessageExpanded` (shared by both TUIs) |
| `tui/theme.ts` | ~990 | LIGHT/DARK/CYBER palettes + `getProviderAccent` |

Recommended access patterns:

- Tool card rendering for tool `X` → `Grep "X" components/MessageItem.tsx` then read the matched range.
- Provider X behavior in the backend → `Grep "provider === 'X'" lib/sessionBackend.ts` to jump to the relevant branch.
- A theme variable → `Grep "--<var>" app/globals.css`; each theme block is contiguous.
- OpenTUI key handling, scrollbox, or memos → `Grep` for the keyword in `tui/opentui/App.tsx` (`useKeyboard`, `cardDisplayData`, `scrollbox`, `followTail`, `setSessionDetail`).
- `Explore` agent is worth it for cross-file searches that would otherwise need 3+ Greps; for a single known symbol, just Grep directly.

Also: never `Read` `package-lock.json` (~573 KB), `pnpm-lock.yaml` (~360 KB), or `bun.lock` (~248 KB) directly — `grep` them for the package name instead.

## Common changes — where to start

Concrete recipes for typical asks. Each lists every file you usually need to touch.

- **Add a new tool card** (e.g. a new SDK tool to render specially) → `components/MessageItem.tsx` for the web card; `tui/format.ts` for both TUIs (formats are shared); `lib/threading.ts` only if the tool needs new block-grouping logic. Tool color: add a `--t-<name>` var in each `[data-theme="…"]` block in `app/globals.css`.
- **Add a provider** → new `lib/<provider>Client.ts` + `<provider>Mapper.ts`; extend the `AgentProvider` union and `isAgentProvider` in `lib/types.ts`/`lib/provider.ts`; add a `<PROVIDER>_CAPABILITIES` constant + branch in `getProviderCapabilities`; write `lib/adapters/<provider>.ts` and register it in `lib/adapters/registry.ts` (that covers the whole read path — do **not** add read branches to `sessionBackend.ts`); add send-path branches in `lib/sessionBackend.ts` for the turn/fork/rewind ops; add an entry to `PROVIDER_SELECT_OPTIONS` in `components/CommandPalette.tsx`. Verify with `npm run adapters:smoke`.
- **Add a theme** → web: extend the `Theme` union + `THEMES`/`THEME_GROUPS`/`THEME_META` in `lib/themes.ts`, then add a `[data-theme="<name>"] { … }` block in `app/globals.css`. TUI: add the name to `VALID_TUI_THEMES` in `lib/tuiState.ts` and a palette in `tui/theme.ts`. Both registries must agree.
- **Add a command-palette entry** → `components/CommandPalette.tsx` (single registry of user-facing actions and keybindings).
- **Change polling cadence** → `app/page.tsx` (5s sessions list, 2s active-session messages with `offset` delta).
- **Add a session-level API action** → new folder under `app/api/sessions/[sessionId]/<action>/route.ts`; implement the backend method on `lib/sessionBackend.ts` (per-provider switch); reflect via a `SessionCapabilities` flag in `lib/provider.ts` if the UI gates it; thread it through `lib/tui/service.ts` if the TUIs need it too.
- **Touch persistent search behavior** → `lib/sessionPersistence.ts` (SQL + aggregation), then the routes under `app/api/session-index/`. Don't import `node:sqlite` statically — use the existing `(0, eval)('import("node:sqlite")')` indirection.
- **Add an OpenTUI keybinding or modal** → `tui/opentui/App.tsx`; grep for `useKeyboard`. Heavy work belongs in a new `tui/opentui/<thing>Worker.ts` + `<thing>WorkerClient.ts` pair, not on the render thread.

- **Handle a new Claude SDK message type** → `lib/claudeMapper.ts` (`normalizeSystemMessage` for `type:'system'` subtypes, `normalizeClaudeEventAsSystem` for top-level event types — the live-stream path passes the record flat, the history path nests it under `.message`, so both shapes must enrich); then the accent color + badges in `components/MessageItem.tsx`'s `ClaudeSystemCard`, and both `formatBlock`/`formatBlockExpanded` in `tui/format.ts`. Pin it in `scripts/claudeSdkSurfaceSmoke.ts`.

Verification after a change: `npx tsc --noEmit` (web) and/or `npm run tui:check` (OpenTUI). There is no test runner, but there are smoke suites: `npm run composer:smoke` (fast, no network), `npm run adapters:smoke` (drives every provider's read path against your real local sessions; providers with no local sessions report SKIP), and `npm run tui:smoke` (slow, spawns real CLIs).
