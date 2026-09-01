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
npm run tui:navperf            # session-navigation latency against your real local sessions
npm run tui:inputperf          # per-keystroke render cost for each navigation surface
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
- **Spawning resumes, and resuming rewrites the transcript** — identical bytes, new mtime, which is what `listSessions` reports as `lastModified`. Since the pool is prewarmed when a session is *selected*, merely navigating to one would jump it to the top of every list ordered by last activity. Read-only control queries dodge this with `persistSession: false` (`lib/sdkControlQuery.ts`); a pool entry cannot, because the turn it is warmed for must persist. `lib/claudeResumeTouch.ts` instead records the touch during prewarm and subtracts it in the Claude adapter's `listSessions`/`readSessionInfo`. The override is pinned to the exact post-resume mtime *and* file size, so any real write drops it on the next read — it can only hide a timestamp we caused. Codex's `thread/resume` was checked and leaves `updatedAt` alone; no other provider needs this.

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

The page (`app/page.tsx`) drives polling: sessions list every 5s, active-session messages every 2s with an `offset` param for incremental delta.

**`offset` is a positional index, not a stable cursor** (load-bearing). Every window is sliced from
a transcript re-derived from the provider on that read, so a compaction or rollback can leave an
offset pointing at a different message than it did last time. Two guards exist and both matter:
callers pass `expectUuid` (the uuid they believe sits at `offset`) and get a `replace` tail back on
a mismatch instead of a window they would splice into the wrong place; and the SSE pumps stop
walking a cursor forward once it falls more than `MESSAGE_CATCHUP_MAX_MESSAGES` behind, because
each catch-up step re-reads the *whole* transcript and paginating a large gap costs O(gap/limit)
full reads. Both live in `lib/sessionBackend.ts`'s `windowForParams` and the shared
`createWindowPump` in `app/api/sessions/[sessionId]/messages/events/route.ts`.

That route's four provider pumps share `createWindowPump` for the fetch/diff/emit/cursor half and
differ only in which harness they subscribe to. **Each pump must keep subscribing to its harness
before its first `refetch()`** — an event arriving during that first read sets `pending` and is
picked up afterwards, so nothing published during catch-up is lost. It reads like incidental
ordering; it is the thing that closes the reconnect gap. `MessageView.tsx` uses a custom absolute-positioning virtual scroll (`ResizeObserver` per-row + RAF batching), not `react-window`.

### Raw provider frames

`lib/rawFrames.ts` keeps the provider's original frame beside every message the mappers normalize,
so "the card rendered wrong — what did the SDK actually send?" is answerable. Served by
`GET /api/sessions/[sessionId]/messages/[uuid]/raw` (full scope only — a frame carries whatever the
provider sent) and surfaced as the `RAW` action on a transcript row.

Deliberate boundaries: a frame is never a field on `SessionMessage`, never reaches the SQLite index,
and lives only in this process. **Retention is pinned to the mapped-message cache** — frames are
recorded by the mappers, and `lib/mappedMessagesCache.ts` serves an unchanged transcript *without*
re-running its mapper, so a session that is cached but whose frames were dropped would never record
them again. Bucketing per session under the same cap keeps the lifetimes aligned; a 404 means
"no longer retained", which is normal, not an error.

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
- **A prefetch must not compete for the threading worker.** The sidebar neighbour prefetch warms the
  worker's own threading/card caches (`warmTranscriptAsync` → the worker's `kind: 'warm'` request)
  and deliberately gets no transcript back. Building and posting a full detail response is most of
  the cost of a read — ~311ms of worker time for eight first-visit sessions against ~47ms to warm the
  same eight — and the worker is serial, so a prefetch shaped as a `detail` spends that time holding
  the queue against the open the user is actually waiting on. The worker's `THREADING_CACHE_LIMIT`
  must stay ≥ reader + panes + `NEIGHBOR_PREFETCH_RADIUS × 2`, or a prefetch round evicts the session
  being read and the cache thrashes itself.
- **The open debounce is adaptive, and that is the point.** `DETAIL_OPEN_DELAY_MS` protects against
  loading a transcript for every session scrubbed past; a session whose detail is already cached and
  mtime-fresh does no read and no reformat, so it opens on the next tick
  (`DETAIL_OPEN_CACHED_DELAY_MS`) instead of paying a wait for work that will not happen. The
  `opensFromCache` test must keep mirroring `refreshSelectedSessionDetail`'s cached-and-unchanged
  fast path — if they drift, the debounce is skipped for opens that really do read.
- **The mounted card window must not depend on which pane has focus.** Browsing used to cap the
  transcript to a small preview and the focused reader mounted `READER_CARD_WINDOW`, so every Tab
  between the sidebar and the reader mounted or unmounted the difference and re-laid it out — 91% of
  commits during focus toggling missed the 60fps budget, worst frame 46ms, against zero over budget
  and 13ms once the window was held fixed. Holding it fixed costs nothing on open because browse-mode
  cards all render collapsed (`expandedKeysForRender`), so a mounted card's cost there is bounded by
  density, not by how many are mounted; scrubbing is covered separately, by the transcript unmounting
  entirely while `isScrubbing`.
- **Measure with `npm run tui:inputperf`** (`tui/opentui/inputPerf.tsx`) for anything that changes what
  the reader mounts or how a keystroke renders. It drives each navigation surface at key-repeat speed
  and reports the app's own frame canary: commits, how many blew the 60fps budget, and the worst one.
  Each scenario runs in its **own process** — a scenario that leaves the app in an unexpected mode
  (a stray escape on the exit confirm, a `/` reaching the composer instead of search) silently
  mismeasures every scenario after it, and it reads as an app regression rather than a harness bug.
  It is **not deterministic across runs**: scenarios drive the real sidebar, so a run measures
  whichever sessions sit at those positions, and a 12-card session and a 263-card one are not
  comparable. The `cards` column reports what the reader was actually holding — check it before
  believing any before/after, and interleave A/B runs rather than batching them.
- **Switching to an already-cached session costs ~40-60ms of React render**, and that is the floor
  on tab switching (`NAV_PATTERN=tabs`) and on cached sidebar revisits alike. Three plausible causes
  are measured and ruled out, so do not re-try them: the card pipeline (transcriptCards →
  stableCardData → cardDisplayData) profiles at ~3.5ms across a whole switching run
  (`AGENT_VIEWER_TUI_CARD_PROFILE=1`); the mounted-window size is not it either — forcing a 5-card
  window in place of 240 changed nothing; and progressively growing the window after the first
  commit bought nothing for the same reason. What remains is the wider App render, which re-runs in
  full on any state change because the root is one very large component. Attributing it needs a real
  CPU profile — the harnesses here cannot resolve a 20-40ms difference against their own run-to-run
  variance, and bisecting with them produces contradictory answers.
- **Measure with `npm run tui:navperf`** (`tui/opentui/navPerf.tsx`) before changing any of this. It
  mounts the real root against your local sessions and reports the metrics logger's `nav.*` rollup:
  `select-to-open` (debounce), `open-to-detail` (worker read), `detail-to-paint`, and
  `select-to-paint` — the number the user feels. `NAV_PATTERN=down|pingpong|scrub|tabs` covers
  first visits, cached revisits, fly-by scrubbing, and switching between open tabs. Current settled navigation is ~50–85ms p50, from
  ~210ms. The harness flushes on a frame cadence on purpose: React's scheduler is driven by `act()`
  under the test renderer, so a single flush followed by a long sleep reports every state update as
  taking the whole sleep.

#### Project editor: cost per keystroke and the file boundary (load-bearing)

`tui/opentui/EditorPopover.tsx` is a real editor, so it is held to an editor's
defining property: **a keystroke costs the same in a 20,000-line file as in a
200-line one.** Measure with `npm run tui:editortypingperf`
(`tui/opentui/editorTypingPerf.tsx`), which types into the real popover at
key-repeat speed and reports **`cpu/key`** — process CPU per keystroke across
every thread. A React Profiler cannot see this work: the highlighter runs on
timers and in the tree-sitter worker, so `commits` stays flat while the editor
gets slower. `EDITOR_TYPING_LONG_LINES=1` measures a minified file and
`EDITOR_TYPING_EXT=txt` disables highlighting, which is how the highlighter's
share of a cost is separated from the rest.

**Measure at 6,000 lines, not 20,000.** At 6,000 the harness reproduces to ±2%;
at 20,000 it swings ±25% run to run, which is wider than most changes worth
making — two separate readings of the *same* build came out 30.8ms and 73.2ms.
A/B interleaved (never batched), and treat a single 20,000-line reading as
evidence of nothing. Two changes were nearly accepted and one nearly reverted on
noise before this was pinned down.

**The harness must drive the real key path.** `App.tsx` hands every key to the
popover's `handleKey` first and only lets the textarea see it if that returns
false, so a harness calling `mockInput.typeText` alone measures neither the
auto-pair checks nor anything else `handleKey` does per character. Set
`EDITOR_TYPING_RAW_INPUT=1` to get the textarea-only path for comparison.

- **Syntax highlighting is incremental, and must stay that way.** It used to
  call `highlightOnce(entireBuffer)` on a 90ms debounce after every keystroke
  and apply the result with one `addHighlight` per token per line: in a
  6,000-line file, a 181ms parse and 112,013 highlight calls **per character
  typed**. `tui/opentui/editorSyntaxBuffer.ts` now holds one tree-sitter buffer
  per open file and pushes `Edit` ranges, so the worker answers with **only the
  lines it re-parsed** — one line for a one-character insert, 1.0ms at 6,000
  lines and 2.7ms at 20,000. Measured end to end: `cpu/key` at 6,000 lines went
  77.3ms → 12.1ms, and its growth from 200 lines 5.84x → 1.78x. Do not
  reintroduce a whole-file re-highlight.
- **The initial parse is applied in slices, viewport first.** It answers with
  every line in the file, and applying 20,000 of them in one tick was a 45ms
  frame — the single visible hitch in an otherwise flat profile, landing on
  whichever keystroke happened to coincide with it. What is on screen is painted
  immediately and the rest backfills in `SYNTAX_BACKFILL_CHUNK_LINES` slices,
  abandoned if an edit lands (those lines describe the old content). Key p95 at
  20,000 lines: 60ms → 21ms.
- **A highlight response is only valid against the content that produced it.**
  The handler drops a batch unless `editor.plainText === buffer.content`; a
  pending update answers with fresh lines. Applying a stale batch decorates the
  wrong text, and after a newline insert it decorates the wrong *lines*.
- **Decoration that is not syntax is reapplied together** (`applyEditorOverlays`
  — occurrences, brackets, extra cursors), because re-syntaxing a line clears
  whatever those put on it. Each is bounded by the viewport or by cursor count.
  Occurrence scanning is bounded in **characters** as well as lines
  (`OCCURRENCE_MAX_SCAN_CHARS`): a line margin means nothing in a minified file.
- **A file whose longest line exceeds `MAX_HIGHLIGHTED_LINE_CHARS` is not parsed
  at all**, and the status bar says so. The parser would re-derive thousands of
  ranges for that line on every keystroke and hand them over to be discarded —
  the old code took **over ten minutes** to type 25 characters into a 660KB
  minified file. Same threshold skips decorating a single over-wide line pasted
  into an otherwise normal file.
- **Do not read `editor.plainText` on a hot path.** It is not cached: **1.1ms
  per read at 20,000 lines, 6.3ms immediately after an edit**, every time. The
  highlight passes, the signature-help effect and the key handler each used to
  take their own copy per keystroke — the key handler's on *every printable
  character*, for auto-pair checks that only brackets and quotes reach.
  `lineStartsFor` caches by string identity, `editorDocumentOffset` takes
  optional `content`/`lineStarts`, and `detectEditorIndentUnit` samples a
  bounded prefix rather than splitting the file.
- **`activeTab.content` is the buffer's content, not a copy of it.** Every
  change runs `updateActiveContent`, which writes back exactly the string it
  read, and an edit landing before a debounced effect fires cancels and
  reschedules it — so a debounced pass may use `activeTab.content` instead of
  re-materialising the buffer, and gets `lineStartsFor` cache hits for free.
  This invariant is what the whole file already relies on; breaking
  `updateActiveContent` breaks far more than decoration.
- **The language server is synced incrementally too.** `editorLsp.ts` used to
  send the entire document in every `textDocument/didChange`, having never read
  the server's advertised `textDocumentSync`. It now reads the capability and
  sends the one replaced range that separates the two document states
  (`editorLspSync.ts`): measured through the real client, **572.3KB → 0.3KB per
  keystroke** at 20,000 lines, and constant rather than growing with the file.
  A server that asks for full documents still gets them, and one that says
  nothing is treated as asking for full — the spec's literal default of None
  would mean never telling the server about edits at all.

  **A wrong range here fails silently**, which is the whole reason this is
  tested the way it is: the server's copy of the file diverges from the
  editor's and every completion, diagnostic and rename after that is computed
  against a document nobody is looking at, with plausible wrong answers on
  screen. `editorLspSyncSmoke.ts` replays 1,500 randomised edits through a
  conforming server's reconstruction and asserts it still equals the editor's
  text, then runs the real client against a server that rebuilds the document
  from the ranges it receives and reports what it ended up holding. Three
  mutations were checked to fail it. Range boundaries never split a surrogate
  pair: LSP positions are UTF-16 code units, but half a pair is not a character
  and a server cannot recover from being sent one.

- **Ghost text is an overlay, never buffer content.** The dim remainder of the
  selected suggestion at the caret (`editorGhostSuffix` + an absolutely
  positioned `<text>`) is painted over the terminal. OpenTUI's `ExtmarksController`
  *would* give real virtual text, but it works by putting the text in the edit
  buffer and marking the range virtual — which would put it into `plainText`,
  and from there into the tab content, the dirty flag, the language server, the
  tree-sitter buffer, and the file the moment anyone pressed save. Not worth it;
  it is also documented upstream as a simulation pending a native implementation.
  Because an overlay cannot push real text aside the way virtual text does, a
  ghost is drawn **only at end of line**, only when the suggestion is a
  case-exact continuation of the typed prefix, and never for a snippet (whose
  body is `${1:name}` placeholder syntax, not text).
- **The overlay's origin is one row and one column inside the caret's cell.**
  Absolute coordinates are relative to the popover frame, which the completion
  popup absorbs into its own rough placement but the ghost cannot — it has to
  land on the caret exactly. `editorGhostTextSmoke.tsx` asserts the rendered
  column against the typed text's, and a one-column shift was verified to fail
  it; the constants were calibrated from the rendered frame, not derived.

The file boundary is the other half, and both halves lose data silently when
wrong — a smoke is the only thing that catches either, because a truncated
buffer and a converted line ending both *render perfectly*:

- **Line endings are normalized on read and restored on write**
  (`tui/opentui/editorLineEndings.ts`). The edit buffer strips carriage returns,
  so a CRLF file came back as LF and was saved that way: opening a
  Windows-authored file, typing one character and saving rewrote **every line**.
  The buffer holds only LF — which every offset, line table and tree-sitter edit
  already assumes — and `BufferTab.lineEnding` carries the file's own. Every
  disk read normalizes before comparing, including the 1.5s watcher's, or a CRLF
  file reads as externally changed against its own copy forever. Guarded by
  `editorLineEndingSmoke.tsx`.
- **`MAX_FILE_BYTES` is the edit buffer's capacity, not a policy.** The buffer
  holds 1,048,576 characters and discards the rest without a word, while the
  editor advertised 2 MB: a 1.5 MB file opened as "Opened main.ts" missing two
  thirds of itself, and every offset computed from it was wrong. The limit now
  matches, and `verifiedBuffersRef` checks the claim after each mount — a buffer
  that took less than it was handed closes its tab rather than presenting a
  truncation as the file. Guarded by `editorLargeFileSmoke.tsx`; both layers are
  verified to fail independently.
- **`editorSyntaxHighlightSmoke.tsx` is the only test that can see highlighting
  at all** — the editor renders identically whether every token was painted or
  none was. It asserts colours on open, colours travelling with text when a line
  is inserted above them, and a keyword typed mid-file picking up its own colour.

#### OpenTUI memory patterns (load-bearing)

The TUI's footprint is dominated by **parsed module code across isolates**, not by live objects. A
Bun `Worker` is a whole JS VM in the same process: it re-imports its entire graph, so anything the
main isolate and the transcript worker both import is paid for twice. At steady state, live JS is
~60MB (main) + ~65MB (worker) against a ~400MB physical footprint — the rest is module code, JIT
output, and allocator arenas.

- **Idle polling is the app's largest allocator, and allocation rate is what a user sees as
  "it's using a gigabyte".** A JS engine keeps its allocator arenas mapped long after the garbage in
  them is collected: a full `Bun.gc(true)` drops the physical footprint from 180MB to 60MB and moves
  RSS *not at all*. So resident size tracks the high-water mark of churn, not what is live, and the
  only way down is to allocate less. Both steady-state polls therefore ask what a file **is** before
  reading what it **says**:
  `lib/claudeSessionReads.ts` gates the open session's 2s re-read on size + mtime + subagent set
  (3ms and no measurable allocation, against ~45MB to parse a 14.7MB transcript), and
  `lib/claudeSessionListCache.ts` gates the 5s sidebar list on one stat per transcript (601 files in
  1-2ms, against ~300ms and ~44MB to re-derive a 200-session page — listing is not a metadata
  lookup, the SDK derives every entry's summary and first prompt from the transcript itself).
  One minute of idle polling with a session open: **+291MB RSS and 2.1s of CPU before, +45MB and
  0.35s after.** Each token is a gate, never a source — compared only against a previous token, and
  any doubt returns null and re-derives. **Before adding a poll, measure what it allocates**, and
  keep any cache's expiry rare: a 15s TTL on the list cache was itself worth a 45MB burst every
  fourth poll, which is the cost it existed to avoid.
- **`AGENT_VIEWER_TUI_MEM_RAW=1` measures churn; `AGENT_VIEWER_TUI_MEM=1` measures retention.** Both
  live in `tui/opentui/workerHeapProbe.ts` and both write to `AGENT_VIEWER_TUI_MEM_LOG`. The
  retention probe collects before reading, so it can look perfectly flat while resident size climbs
  all night; the raw sampler does not, so a repeating step of the same size in its `objs` column is
  one periodic job, which is how the list cache's expiry was caught.
- **`tui/opentui/memPhases.sh` attributes a phase; `memRun.sh` reports one aggregate peak.** memRun
  hid that the ratchet was on the list path rather than in any one feature. memPhases drives a
  scripted `label:keys:reps:dwell` sequence (`PHASES=`) and prints footprint and RSS after each, so
  "analytics costs 55MB" and "nothing is released when it closes" are separate, visible facts. Run
  it with `MEM_CWD=$PWD` — in an empty temp dir the git, editor and composer phases do nothing.
- **Measure physical footprint, not RSS** — except when chasing churn, where RSS is the point
  (above). RSS counts the resident slice of Bun's own ~2GB binary,
  which is shared and file-backed; it swamps the app's real cost and swings 100MB between identical
  runs. `npm run tui:memrun` reports `vmmap`'s physical footprint, sampled throughout the run
  (a single reading lands wherever the collector happened to leave the heap and varies ~2x).
  `npm run tui:memperf` reports the same split under the test renderer, plus per-isolate JS heap;
  `AGENT_VIEWER_TUI_MEM=1` turns on `tui/opentui/workerHeapProbe.ts`, which is the only way to
  attribute memory to a specific VM.
- **The scenario decides what you measure.** Sidebar navigation alone never fetches session
  metadata; you have to Tab into the reader (`KEYS=$'j\t'`) before that path runs at all. A memory
  A/B against the wrong key sequence reports "no change" for a change worth 95MB.
- **A provider SDK must not load until that provider is used.** `lib/adapters/registry.ts` resolves
  adapters by dynamic import for exactly this reason — importing all eight cost ~88MB. The same rule
  applies to anything in `lib/sessionBackend.ts`'s graph: `claudePool` is loaded on demand behind
  `ensureClaudePool()` because it is the *send* path, and the transcript worker never sends a turn
  yet was paying ~31MB to hold a pool it could not use. Its call sites use the synchronous
  `claudePoolModule()` accessor, which **throws** rather than loading, so a use that is not behind a
  send-path entry point is loud instead of a stall on a hot path.
- **Don't spend a whole VM on a small answer.** Session model + context usage had its own Worker for
  isolation from a read that can block for over a second. That Worker re-imported the full provider
  graph — ~95MB of RSS for a model badge. It now runs in the transcript worker
  (`kind: 'metadata'`), which already holds that graph. The isolation survives because the read is
  I/O-bound: it awaits a provider round-trip and yields immediately, so it interleaves with a detail
  read rather than queueing behind one. That is what separates it from a `warm` prefetch, which is
  CPU-bound and must stay off the critical path.
- **Evict every per-session cache together.** `lastFormattedByKey` (in both the worker and its
  client) is keyed by `${sessionKey}|${cardsVariant}`, not by session, so evicting a session from
  the threading cache used to leave its threaded transcript *and* its card array pinned. With four
  variants per session the worker could hold 24 whole transcripts while intending to hold 6.
  `dropLastFormattedForSession` runs alongside every threading-cache eviction; a new per-session
  cache must join it.
- **Load a rare renderer on demand.** `beautiful-mermaid` costs ~21MB to evaluate and `tui/format.ts`
  is imported by both TUIs *and* the transcript worker. It is now behind
  `ensureTuiMermaidRenderer()`, which the worker awaits only for a transcript that actually contains
  a Mermaid fence (`textNeedsTuiMermaid`); formatting itself stays synchronous. The legacy Ink TUI
  bumps a `mermaidEpoch` to re-run its memo once the renderer resolves.
- **Do not set `NODE_ENV` for the TUI.** Bun leaves it unset, which costs React's development
  build — an `Error` allocated per JSX element for owner stacks, ~6,000 per session opened — and
  defaulting the spawn in `bin/agent-viewer.mjs` to `NODE_ENV=production` did buy that back
  (~27MB peak / ~60MB settled, plus the churn). It also broke running the TUI, because `NODE_ENV`
  is not a React flag: every other module the app and its dependencies load reads it too. It has
  been removed from both `bin/agent-viewer.mjs` and `npm run tui`. Reclaiming React's production
  build needs a mechanism scoped to React alone, not a process-wide environment variable.
- **Keep the send path out of read-path modules.** `lib/adapters/claude.ts` is a read adapter and
  was importing `claudePool` for a single `peekClaudeSession` — 30MB of send-path pool in every
  isolate that reads a session, the transcript worker included. It now asks through
  `lib/claudePoolHandle.ts`, which **is the only module that imports the pool**. That handle's
  read-path answer is exact rather than approximate: a warm entry cannot exist unless the pool has
  been loaded, because only the send path creates one and the send path loads it — so "not loaded"
  and "no warm entry" are the same answer, and the caller's existing cold path is correct. Don't
  reintroduce a direct `import … from './claudePool'`; go through the handle.
- **This graph is cycle-laden, so single-module deferrals measure as zero.** `lib/agentCoordination.ts`
  imports `lib/sessionBackend.ts`, which imports every provider's client, which import the
  coordination tools — so almost any one module, imported alone, drags in nearly the whole layer.
  Three separate deferrals were measured and abandoned because of it: the Claude Agent SDK, the
  coordination SDK tools, and the non-active providers' clients each have a **marginal cost of
  ~0.1MB** inside the full graph, despite costing 30-57MB in isolation. The costs only separate when
  a whole class is excluded at once: with the other providers' clients out, the Claude SDK is 29.5MB
  and zod/typebox (via `agentCoordinationSdkTools`) is 15.5MB. **Always measure the marginal cost in
  the real graph before deferring anything here** — an isolated `import` number will lie to you.
- **The read path is its own module, and the send path loads on demand.**
  `lib/sessionReads.ts` holds every adapter-routed read (list, info, title/tag,
  delete, transcript window, subagents, models, composer options, slash commands,
  diagnostics) plus the shared tail each read ends with — provider-instance
  provenance, inbox ordering, the search-index mirror, and `windowForParams`.
  **Nothing in it may import `lib/sessionBackend.ts`, a provider client, or a
  provider SDK**; adapters load lazily, so a process materializes only the
  providers it talks to. `lib/tui/reads.ts` is the TUI's three read wrappers over
  it (plus the `--attach` HTTP path). `sessionBackend.ts` and `lib/tui/service.ts`
  re-export both, so existing callers are unchanged.

  This is what lets the two isolates stop paying for each other's work:
  `tui/opentui/threadingWorker.ts` imports `lib/tui/reads.ts` rather than
  `lib/tui/service.ts` (72MB → 16MB before its adapter loads), and `service.ts`
  reaches `sessionBackend` and `agentCoordination` only through `sendPath()` /
  `coordination()` loaders, so the main isolate boots without the send path at
  all. Measured on a browse-only run: peak footprint 547MB → 372MB.

  The send path arrives on first use — composer prewarm, a turn, an interrupt —
  and costs one ~94ms import, off the keystroke path. Keep new send-path calls in
  `service.ts` behind `sendPath()`; a static import there silently restores the
  whole graph. `subscribeTuiProtocolRunChanges` is the one synchronous caller: it
  must return an unsubscribe immediately, so it subscribes once the loader
  resolves and its disposer cancels a subscription still in flight.

- **A deferral is only worth what its callers respect.** The live-turn registry
  read (`lib/sessionActivity.ts`) describes turns but is squarely on the *read*
  path: the TUI polls it from boot, every few seconds, to drive live-turn
  reattach and the attention inbox. While it lived in `sessionBackend.ts` that
  poll loaded the whole send path within seconds of startup, so a read-only
  session paid the composer's footprint anyway and the `sendPath()` deferral
  bought nothing. It now answers from `lib/sessionRuntime.ts` and
  `lib/viewerAttention.ts` alone; `sessionBackend` registers a reader for the
  pending-prompt/permission payloads, which are its own state, and until it does
  there are none — exact, not approximate, because nothing can be pending before
  a turn has run. Browsing now never loads the send path at all (verified by
  tracing the loader), worth ~35MB settled on top of the split.

  **When adding a poll or a boot-time read, check what it pulls.** One
  `sendPath()` call on a timer undoes the whole thing, silently.

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

`proxy.ts` calls `evaluateRequestTrust()` and enforces two scopes — `full` and `read-only`. Keep it
at two: a scope set can widen later, it cannot shrink.

**What read-only may reach is declared per route+method in `lib/routeScopes.ts`, not inferred from
the HTTP method.** The method is a proxy for intent and gets it wrong both ways: `POST
/api/sessions/project/messages` is a pure read (so a read-only phone could not load the project
feed), and `GET /api/remote-access` returns the live pairing token (so a read-only device could mint
itself a full-scope credential). Anything undeclared is `write`, so a new route fails closed, and
`npm run routes:smoke` asserts every route file and every method it exports appears in the table —
the same anti-drift pairing as `CAPABILITY_METHODS` in `lib/adapters/registry.ts`. Where patterns
overlap (`/api/sessions/running` vs `/api/sessions/[sessionId]`), the one with more literal segments
wins.

State files under `.agent-viewer-data/` that hold credentials are written `0600` via temp-and-rename:
`remote-access.json` carries a live plaintext pairing token, and a torn write would leave
unparseable JSON, which reads as "no state" and silently unpairs every device.

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

### Session lifecycle and linked pull requests

`lib/sessionInbox.ts` owns `pin | unpin | settle | reopen | snooze | unsnooze` plus
`link-pr | unlink-pr`, stored in `.agent-viewer-data/session-inbox.json`. A session linked to a pull
request settles itself when that PR merges, so finished work leaves the active list on its own.

`lib/linkedPullRequests.ts` runs that sweep: throttled process-wide, batched per repo, and
**fire-and-forget off the sessions-list route, never inside it** — resolving PR state shells out to
`gh`, which must not sit in the path of a 5s sidebar refresh. Settling is one-shot (it fires on the
transition into `MERGED`), so deliberately reopening a settled session is not undone on the next
sweep. A missing or logged-out `gh` yields no state at all and is never an error.

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
| `tui/opentui/EditorPopover.tsx` | ~4715 | Project editor: explorer, buffers, LSP, completion, search, highlighting, key handling |
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

Verification after a change: `npx tsc --noEmit` (web) and/or `npm run tui:check` (OpenTUI). There is no test runner, but there are smoke suites: `npm run composer:smoke` (fast, no network), `npm run routes:smoke` (asserts the remote-access scope table covers every API route), `npm run adapters:smoke` (drives every provider's read path against your real local sessions; providers with no local sessions report SKIP), and `npm run tui:smoke` (slow, spawns real CLIs).
