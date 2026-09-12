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
- **The system prompt is recorded for the conversation** (`snapshot: true` on both send paths). That is what keeps the API prompt-cache prefix stable across turns and resumes, and stops a prompt that shifted between launches from discarding extended thinking's earlier reasoning. Its cost is deliberate: a live `setModel` no longer re-renders the prompt, so a mid-session model switch inherits the recorded one until compaction or a new session. **Both paths must pass it** — a cold first turn that records a prompt the pooled turns decline to reuse is worse than neither doing it.
- **Read-only queries declare `permissionPrompts: 'none'`** (`lib/sdkControlQuery.ts`, `lib/claudeModels.ts`). They run no tools and install no `canUseTool`, so a prompt there could only park the control queue on a question with no surface to answer it; rules, hooks and the permission mode still decide, and anything that would prompt is denied with a message saying why.
- **Spawning resumes, and resuming rewrites the transcript** — identical bytes, new mtime, which is what `listSessions` reports as `lastModified`. Since the pool is prewarmed when a session is *selected*, merely navigating to one would jump it to the top of every list ordered by last activity. Read-only control queries dodge this with `persistSession: false` (`lib/sdkControlQuery.ts`); a pool entry cannot, because the turn it is warmed for must persist. `lib/claudeResumeTouch.ts` instead records the touch during prewarm and subtracts it in the Claude adapter's `listSessions`/`readSessionInfo`. The override is pinned to the exact post-resume mtime *and* file size, so any real write drops it on the next read — it can only hide a timestamp we caused. Codex's `thread/resume` was checked and leaves `updatedAt` alone; no other provider needs this.

#### Copilot reads must not activate the session (load-bearing)

Resuming a Copilot session to read it costs **1.4-7.8s** and appends a synthetic
`session.resume` event to the history it then hands back — so browsing a session
changed what the session was made of, and the sidebar paid a multi-second stall
per open. SDK 1.0.13's `sessions.readPersistedEvents` reads the durable journal
directly (1-7ms, no activation), and `lib/adapters/copilot.ts` uses it for the
transcript, `readSessionInfo`, and the model badge; `peekCopilotSession` returns
a pooled runtime without spawning one, so a read can *decorate* its answer from
a live session without bringing one up to find out.

- **A cold read reports no context tier, and that is not a gap to fill.** The
  journal records the model (`session.model_change` / `session.start`) but never
  the tier, which is runtime state. The composer sends its tier back on every
  send, so inventing a `default` here would silently downgrade a long-context
  session on its next turn — `selectedCopilotContextTier` is therefore
  `null`-until-known in `MessageView.tsx`, and an omitted tier lets
  `sessionBackend` resolve the session's real one.
- **Diagnostics and `readComposerOptions` still activate**, deliberately: status,
  tool lists and the permission/agent mode are runtime state with no journal
  equivalent, and both are reached by an explicit user action rather than by
  selecting a session.
- Guarded by `npm run copilot:sdk:smoke`, which asserts no read leaves a runtime
  behind and that the journal maps to the same transcript as the activating
  reader (verified to fail when the persisted path is disabled).

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
  full on any state change because the root is one very large component. The harnesses here cannot
  resolve a 20-40ms difference against their own run-to-run variance, and bisecting with them
  produces contradictory answers — so use a CPU profile, below.
- **`bun --cpu-prof --cpu-prof-md` is how to attribute a frame, and `inputPerf`'s render/commit
  split is how to decide what to profile.** `INPUT_DEBUG_PROFILE=1` prints every over-budget frame
  as `actual=` (React render CPU) against `commit=` (everything after the commit: OpenTUI's apply,
  Yoga layout, paint). On a real-session `tab-switch` run the split is unambiguous — 879.6ms actual
  against 25.7ms commit on the worst frame, 55.5/0.4 on a typical one — so the switch cost is React
  rendering the root, **not** the terminal painting it. Do not read the aggregate profile the other
  way round: OpenTUI's `onLifecyclePass`, `bufferDrawBox` and `yogaNodeCalculateLayout` dominate a
  profile by sample count because they run every frame in the render loop, which says nothing about
  what makes one frame long. Two more traps in that output: rank by **sample count**, never by the
  attributed self-time (a single sample landing before a long native call is credited the whole
  gap — `readContextForConsumer` showed 1.51s from one sample), and the edge counts under
  "Called by"/"Calls" are samples, not invocations, so 645 there was 18 real `git` spawns.
- **`findDescendantById` is a full-subtree walk, and the reader used to call it on a timer.**
  OpenTUI's implementation recurses through every renderable and sorts each level's children on the
  way down; under a mounted transcript that is the interior of every card. The scroll-slide and
  tab-restore fixups call it up to `READER_FIXUP_MAX_TRIES` times on a 16ms timer, and it profiled
  at **9.7% of all CPU** during tab switching. `findReaderCard` scans to
  `READER_CARD_SEARCH_DEPTH` instead, which is where a card box actually sits, and falls back to the
  full search. `scrollChildIntoView(id)` takes only an id and does the same walk internally — it was
  a tenth the cost, so it was left alone. **This is a CPU reduction, not a measured frame win**:
  interleaved A/B on `tab-switch` and `reader-scroll` could not resolve a difference in worst frame
  or over-budget count either way, which is what you would expect from work that runs on a timer
  between commits rather than inside one. Do not re-litigate it with those harnesses; the profile is
  the measurement of record.
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

- **Save hygiene is computed on the string that is about to be written**
  (`editorSaveHygiene.ts`), never by applying edits to the live buffer and
  reading the result back — an async state update is how a save writes
  something other than what it formatted. Format-on-save, trim-trailing-
  whitespace and final-newline are all **off by default and toggled from the
  palette**: each rewrites lines the user did not touch, which turns a one-line
  change into a whole-file diff in someone else's repository.
- **A save must not adopt its own output over a newer edit.** Hygiene rewrites
  the text, so the buffer has to take it — but only when the buffer has not
  moved on since the save started. Typing during an in-flight save has to
  survive it: recovery snapshots `content`, so overwriting a newer edit discards
  unsaved work *and* its recovery copy. `editorSaveRecoverySmoke.tsx` caught
  exactly this regression when the commit was written unconditionally.
- **One `applyEditorTextEdits`, and it clamps.** The popover had its own copy
  beside the one used for saving. Its offset helper returned `null` for a column
  past the end of a line, and `slice(0, null)` then truncated the document to
  nothing without a word. The surviving implementation clamps to the line end
  and still throws on overlapping edits, because a server contradicting itself
  has no safe interpretation. LSP edits are applied last-first: in document
  order every later range is shifted by the earlier ones' length change.

- **A symbol carries two ranges and they answer different questions.** `range`
  is the jump target (the name), `enclosingRange` is the whole extent — which is
  what says whether the caret is inside a symbol, and so what drives the status
  bar's breadcrumb. A flat `SymbolInformation` has only one range and it means
  the extent, so the two collapse there. The breadcrumb is derived from the
  outline and the caret line, never asked for, so moving the caret costs
  nothing; the outline itself is re-read `OUTLINE_REFRESH_DELAY_MS` after typing
  stops, and the `@` picker reads that same state rather than fetching its own.

- **Symbol navigation lives in the quick-open picker, not its own overlay.**
  `@` is the outline of the current buffer, `@@` searches the workspace (`^⇧O`
  and `Alt+O` seed them), alongside the existing `>` commands, `#` buffers and
  `:` line. Reusing the picker means one keyboard model and one list widget.
  **`documentSymbol` has two legal response shapes** and the server picks:
  hierarchical `DocumentSymbol[]`, or flat `SymbolInformation[]` whose position
  hides under `location`. A client that reads only one gets an empty outline
  from half the table, and an empty outline is indistinguishable from a file
  with no symbols — so `editorSymbolSmoke.ts` pins both. Symbols use their
  `selectionRange`, so jumping to a class lands on its name rather than the top
  of a body hundreds of lines long, and an outline is fetched once per buffer
  and filtered locally while a workspace query is debounced per keystroke. A
  blank workspace query is never sent: several servers answer it by enumerating
  everything they know.

- **A click on a tab must select it, and only the `×` may close it.** The tab's
  box had no `flexDirection`, so it laid its children out in a *column*: the `×`
  then stretched across the full tab width (cross-axis stretch is the default),
  painted over the label's status glyph, and took every click meant for the tab
  — selecting a buffer closed it instead. Nothing about the rendered row looked
  wrong, which is why `editorTabMouseSmoke.tsx` clicks each column of the label
  and asserts the buffer survives. Any box holding a click target beside other
  content needs an explicit direction.
- **Encoding is the third silent-data-loss boundary**, alongside line endings and
  buffer capacity. `readFile(path, 'utf8')` never reports a bad byte, it
  substitutes U+FFFD — so a Latin-1 file opened looking plausible and the first
  save wrote the replacement character over its own bytes, whole-file and
  silent. `decodeEditorFileText` (`editorLineEndings.ts`) decodes strictly and
  **refuses** a file that is not valid UTF-8 or contains NUL, rather than
  mangling it; `ignoreBOM` keeps a leading U+FEFF so a BOM round-trips.
- **A save must not narrow a file's permissions.** `open(temp, 'wx', mode)` is
  masked by the process umask, so a 0o666 file was rewritten 0o644. The
  temporary file is created 0o600 and `fchmod`'d to the original mode, which is
  not masked.
- **A timestamp only proves a file unchanged once it is old enough to.** ext4
  with 128-byte inodes records whole seconds and FAT two, so an in-place
  same-size write in the same tick as the read leaves `dev:ino:size:mtime:ctime`
  identical — and identical on every later poll. `editorDiskReader.ts` refuses
  to cache against a stamp younger than `COARSE_TIMESTAMP_MS`, the same rule git
  applies to a racily-clean entry. APFS records nanoseconds, so the case is
  reached by injecting a truncating stamp source, not by writing files.
- **The tree-sitter edit and the syntax classifier were linear in file size.**
  Deriving one keystroke's edit did three full `positionAt` scans from offset 0
  (~3.4M code-unit comparisons per character at 20,000 lines), and
  `classifyEditorOffset` allocated three closures and materialized a
  one-character string *per character of the prefix*. The edit path now compares
  in 4,096-char blocks and carries a line-start table across edits; the
  classifier retires impossible characters through a cached delimiter-start
  table. Measured interleaved in-process at 20,000 lines: 5.12ms → 0.14ms per
  edit, 26.8ms → 3.0ms per classify. Neither is O(edit) — both still make one
  O(prefix) pass; the constants fell ~30x and ~9x. `editorSyntaxEditSmoke.ts`
  and `editorSyntaxContextScanSmoke.ts` are differential (609,309 offsets, 3,000
  random edits) because a wrong range fails **silently**: the tree diverges and
  later highlights decorate the wrong text with no error.

- **One language server per workspace and command, not per buffer.** The server
  process lives in `editorLspSession.ts` and is shared by every buffer that can
  use it; `EditorLspClient` is now just one document's handle on it. It used to
  be the other way round, and switching tabs killed the process and spawned a
  new one — for gopls or rust-analyzer that is the whole workspace re-indexed
  before the first completion, per Tab. A session is reaped only after
  `AGENT_VIEWER_LSP_IDLE_MS` (3 min) with nothing holding it, and both the
  session and each open document are refcounted, so the same file open in two
  panes cannot have one pane's close send a `didClose` out from under the other.
  Pooled children are killed on process exit, or they would outlive the TUI and
  keep indexing a workspace nobody has open.
- **A server that dies comes back on its own**, up to `AGENT_VIEWER_LSP_MAX_RESTARTS`
  (3) with exponential backoff, reopening the buffer **as it is now** rather than
  as it was when the server died — `liveText` is kept while nothing is running
  for exactly that. Without the cap, a server that crashes during startup
  respawns forever; `editorLspRestartSmoke.ts` pins both halves.
- **A command is resolved before it is spawned** (`editorLspCommand.ts`). On
  Windows most of these servers are `.cmd` shims that `spawn` cannot execute at
  all, so the whole table was unreachable there — a shim is run through
  `cmd.exe` with its own quoting, since the usual install path contains a space.
  Path arithmetic uses the *target* platform's API, which is what lets
  `editorLspServersSmoke.ts` drive win32 resolution from macOS; a `join` that
  used the running platform would build `C:\tools\bin/gopls` and find nothing.
  Resolution also means a missing server costs a `stat` rather than a failed
  spawn, so a fallback chain (`basedpyright` → `pyright` → `ruff` → `pylsp`)
  moves on immediately.
- **The server table lives in `editorLspServers.ts` and a project can override
  it** via `.agent-viewer/lsp.json` — `servers` (replacing the built-ins, or
  prepending when an entry sets `extend`), `disabled`, and `rootMarkers`. The
  file is parsed leniently (comments, trailing commas) because that is what
  people write in an editor config. **Bare `tsc` is not a fallback for
  TypeScript**: TypeScript 5's compiler has no `--lsp`, so it would spawn,
  reject the flags and die; the second choice is `typescript-language-server`.
- **C# needs a project opened before it is a language at all.** Roslyn will not
  compile anything until it is told which solution or project a file belongs to,
  through `solution/open` / `project/open` — Microsoft extensions, not standard
  LSP. Without them it treats C# as a loose "miscellaneous file" and *looks*
  like it is working: hover, definition and the outline all answer. But there
  are **no compiler errors**, completion omits inherited members, and
  `workspace/symbol` is empty. Measured on a real project: 1 style hint and 2
  completions before, 5 diagnostics including two genuine CS0029 errors and 6
  completions after. `editorLspStartupNotifications` sends them once per
  session, and only to Roslyn.
- **`initialize` returning is not readiness, and saying it is looks like a bug.**
  Roslyn answers `initialize` in under a second and then spends minutes loading
  a large solution — 131 seconds on dotnet/aspire — during which every
  completion and hover comes back empty. Reporting "ready" there is
  indistinguishable from a broken editor: the user types `.`, nothing appears,
  and nothing explains why. A session handed a workspace to load stays in a
  `loading` status until `workspace/projectInitializationComplete`, and the
  status bar says so.
- **Open the file's own project as well as the solution.** The one project the
  user is looking at loads in a fraction of the time the whole solution does,
  and it is enough to answer for the open buffer while the rest catches up.
  Same file on dotnet/aspire: **131s to the first completion with the solution
  alone, 32s with both.** A file with no project of its own opens only the
  solution rather than dragging in an unrelated one.

- **A server that says its answers changed must be listened to.** Loading a
  project takes seconds, so whatever was pulled at startup is stale. Roslyn
  announces readiness with `workspace/projectInitializationComplete`; the
  standard spelling is `workspace/diagnostic/refresh`. The session used to
  answer any unrecognised server request with "unsupported method", so the
  buffer kept showing the pre-load answer forever. Both now re-pull.
  `editorLspProjectSmoke.ts` pins this with a server whose state flips only when
  it sends the notification — flipping it synchronously made ignoring the
  notification accidentally harmless, and the mutation passed.

- **A server is rooted at its own project, not at the editor's cwd**
  (`resolveLspWorkspaceRoot`): gopls wants the `go.mod` module, rust-analyzer
  the Cargo workspace. The search never escapes the root the editor was opened
  at, and falls back to it, so a stray file still gets a server.
- **Root markers are tiered, and the bigger unit of work wins.** Each tier is
  searched up the whole ancestor chain before the next is tried, so `*.sln`
  outranks a `*.csproj` sitting closer to the file (likewise `go.work` over
  `go.mod`, a Gradle `settings.gradle` over a module's `build.gradle`). C# is
  why: in the standard .NET layout — solution at the top, projects under `src/`
  — the nearest marker is the project, so Roslyn was told about that project
  alone and knew nothing about the others in the solution or the references
  between them. Completion on a type from a referenced project returned
  **nothing at all**, with no error to explain it. Measured on a real
  two-project solution: 0 members before, 6 after, and four phantom
  "type not found" diagnostics collapsed to one.

- **Tab is overloaded, and its claimants are ordered.** In one key handler, in
  order: a snippet placeholder, an open completion list, a standing ghost, a
  selection or Shift (indent/outdent lines), and finally plain Tab, which
  advances to the next tab stop. That last branch had no one behind it — the
  textarea has **no Tab action at all** (`TextareaAction` has no tab or indent
  member), so the editor declining Tab left it doing *nothing*, silently, in the
  one place a Tab key is expected to work. `editorPopoverSmoke.tsx` had asserted
  the old contract, which was asserting the bug. `editorTabSmoke.tsx` now pins
  every state Tab can be pressed in, including that a claimant added too early
  swallows indenting — verified by moving the indent branch ahead of the
  suggestion branches and watching it fail.
- **Ghost text is an overlay, never buffer content.** The dim remainder of the
  selected suggestion at the caret (`editorGhostSuffix` + an absolutely
  positioned `<text>`) is painted over the terminal. OpenTUI's `ExtmarksController`
  *would* give real virtual text, but it works by putting the text in the edit
  buffer and marking the range virtual — which would put it into `plainText`,
  and from there into the tab content, the dirty flag, the language server, the
  tree-sitter buffer, and the file the moment anyone pressed save. Not worth it;
  it is also documented upstream as a simulation pending a native implementation.
  Because an overlay cannot push real text aside the way virtual text does, a
  ghost is drawn **only where the rest of the line is blank**, only when the
  suggestion is a case-exact continuation of the typed prefix, and never for a
  snippet (whose body is `${1:name}` placeholder syntax, not text).
- **The ghost outlives the completion list, on purpose.** The list is cleared on
  every keystroke and a new one costs a 160ms debounce plus a round trip, so a
  hint derived from the list blinks out for ~120ms per character — at typing
  speed it is only ever visible to someone who has stopped. A standing
  `ghostCandidate` is re-checked against the live buffer instead, so it shrinks
  as the word is typed and drops the moment the word stops matching. Because it
  outlives the list it must be retired explicitly: `closeCompletions` (Escape),
  acceptance, and a tab switch all clear it, or the hint describes a suggestion
  the user already refused. And because it is visible while no list is open,
  **Tab accepts a standing ghost** — a hint you can see but cannot act on is
  worse than no hint.
- **A ghost must describe what acceptance actually does**, so
  `editorGhostCandidate` mirrors `applyCompletion` rather than approximating it:
  a server-supplied `textEdit` decides its own replaced range, which is often
  not the word under the caret, and an edit that does not end at the caret is
  not something a ghost can describe at all.
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
- **`setText` discards the undo history; `replaceText` keeps it.** Measured
  directly on the renderable: undo after a `setText` does nothing at all, while
  undo after a `replaceText` restores exactly the prior state. Any path that
  rewrites the buffer behind the user — save hygiene, formatting, a workspace
  edit — must use `replaceText`, or the rewrite is both unundoable itself and
  takes every earlier step with it. The rest of the file already used
  `replaceText` throughout; the save-hygiene rewrite was the one exception, and
  `editorSaveOnDiskSmoke` now presses Ctrl+Z after a hygienic save to keep it
  that way.
- **A typed run undoes in one press** (`editorUndoRuns.ts`). The buffer records
  one step per character, so taking back a line cost as many presses as it had
  letters. A run is detected from its effect rather than from history metadata
  the buffer does not expose: each step removes one character from the same
  line, moving the caret back exactly one column. That test reads only
  `logicalCursor`, which is O(1) — diffing `plainText` per step would cost about
  a millisecond each on a large file, on a key that has to feel instant. A
  newline, a paste, a multi-cursor edit or a formatting rewrite all move the
  caret differently, so each stays its own step; the danger of coalescing is
  undoing more than was typed, and every boundary is pinned.
- **Quick open ranks by recency once matches tie.** An empty query scores every
  file 0, so Ctrl+P listed whatever the file walk produced first — in a
  repository of any size, files you have never opened. Recency orders the list
  when nothing is typed and breaks ties when something is, but never outranks a
  match: a typed query still finds a file you have never touched.

- **A UTF-8 BOM is a file property, not buffer content — and this was the
  Windows bug.** The terminal edit buffer silently drops a leading U+FEFF (13
  characters handed in, 12 held), and the integrity check reads any such
  shortfall as the buffer having refused the file, so it closed the tab and
  reported that the file **"did not fit the editor buffer"**. Visual Studio
  writes a BOM into most files it creates, so on Windows that was not an edge
  case: it was most files, at any size, reported as a capacity problem. The mark
  is now stripped for the buffer and restored on write, exactly like a CRLF
  ending — dropping it instead would rewrite the first bytes of every
  Windows-authored file on its first save. `editorTextFromDisk` /
  `editorTextToDisk` are the one pair every read and write goes through; the
  disk reader strips it too, or a BOM'd file reads as externally changed against
  the editor's own copy forever.
- **A file bigger than the buffer opens read-only rather than not at all.**
  Refusing it meant the one thing still worth doing — reading it — was impossible
  too. The buffer holds a prefix, the tab says which part it is showing, and
  edits and saves are both refused: saving would replace the file with whatever
  fitted. The refusal has two independent layers, because the key handler's
  depends on the host routing keys through it — `updateActiveContent` puts the
  buffer back whatever changed it.
- **The size limit is counted in characters, the unit the buffer uses.**
  Measuring bytes refused files that would have fit: UTF-8 accented or CJK text
  runs to two or three bytes per character, so a 1.4 MB file of 700,000
  characters was rejected for exceeding a limit it was nowhere near.
- **Cut a truncated buffer on a line boundary only when there is one near the
  limit.** A minified file is one enormous line after a short banner comment,
  and honouring that boundary showed **212 bytes of a real 1 MB file** — the
  only newline was at the top. Below `MIN_TRUNCATED_BUFFER_CHARS`, a hard cut
  mid-line is far better than showing almost nothing.
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

#### OpenTUI render slots (load-bearing)

`tui/opentui/slots.tsx` is a named-slot registry, taken from OpenCode's TUI plugin API
(`packages/plugin/src/tui.ts`, where every built-in surface — the context panel, changed files, LSP
and MCP status — is a plugin filling `sidebar_content`). The root declares where a surface may
appear (`SlotName` plus the props that arrive there); a surface registers what it draws.

**A slot is a structural seam, and in React it is not a performance fix by itself.** OpenCode's TUI
is `@opentui/solid`, where a slot child is its own reactive scope and isolates by construction. Ours
is `@opentui/react`: moving a surface into a slot changes which file it lives in and nothing about
when it renders. The isolation comes from the *other* half — the surface reading its own state from
a store instead of from the root's `useState`, so `memo` has stable props to compare. Do one without
the other and you have moved lines, not work.

- **The registry is deliberately not a React context.** A context provider puts every registration on
  the root's render path, which is the coupling this exists to remove. `<Slot>` subscribes with
  `useSyncExternalStore`, so registering re-renders that slot alone. `slotContributionIds` is the
  test seam.
- **`tui/opentui/coordinatorStore.ts` is the reference shape.** The coordinator rail was three
  `useState`s and a polling effect in the root, so every reconcile tick and every pushed run change
  re-rendered the whole app — mounted transcript included — to repaint a list in the left rail. The
  store owns the state and the feed; `CoordinatorSidebar` subscribes and is `memo`'d; the root's key
  handlers read `getCoordinatorState()` imperatively and so do not subscribe at all. The root keeps
  one subscription, to the header counts alone, because the rail's box title is a string prop.
- **The feed is refcounted, not per-mount.** Two subscribers must not each open their own poll and
  SSE subscription. Mounting the rail acquires it and unmounting releases it, which reproduces the
  old `sidebarView !== 'coordinator'` guard exactly.
- **`readRootRenderCount()` is the only way to assert any of this.** The frame is identical whether
  the root re-rendered or the rail did, and a `Profiler` wrapping the root cannot tell them apart
  either — a commit caused by the memoized child still fires it. `coordinatorSlotSmoke.tsx` asserts
  the count does not move on a coordinator store update; making the root's selector include
  `selectedKey` was verified to fail it.

- **Not every surface can take this treatment, and the test is whether its state is self-contained.**
  The coordinator rail qualified: its own feed, its own selection, consumed nowhere else. The fleet
  strip and the attention inbox do not. They share `waitingSessions` / `viewerAttentionNotes` /
  `attentionDone` with `sidebarSessionActivity`, which is a dep of `buildSidebarRow` — so the same
  derived state paints every sidebar session row inside the root's render — and `attentionItems` is
  derived from four other pieces of root state (`pendingPermissions`, `backgroundPrompts`,
  `sessions`, `composerTargetSession`). Moving those two behind slots would relocate JSX and isolate
  nothing, because the root would still hold and re-render the state. Separating them means
  splitting the activity registry from the reattach machinery first; that is the prerequisite, not
  an optional extra.

#### Frecency, the stash, and the supersede queue (load-bearing)

Three patterns taken from opencode in September 2026 (survey: `docs/opencode-survey-2026-09-12.md`).

- **Frecency ranks file pickers, and it breaks ties rather than winning them.**
  `lib/tuiFrecency.ts` scores a path as `frequency / (1 + ageInDays)` — frequency
  alone pins a file you have finished with, recency alone forgets the file you
  return to every day. It orders the editor's quick-open and the composer's
  `@`-mention list, and **a typed query must still find a file that has never
  been opened**: the sort is match quality first, frecency second. The mention
  worker tiers its matches (exact basename, basename prefix, basename substring,
  path substring, subsequence) precisely so frecency has a tie to break.
  **Ranking happens in the worker, before the result limit.** A bare `@` matches
  every file, so slicing to twelve first would hand back whatever the file walk
  produced and leave frecency nothing to order — which is the one case where it
  matters most. The table is JSONL, appended on use and compacted once per
  process, so a crash costs the last line rather than the history; a key is
  `frecencyKey(root, relativePath)` with separators normalized, because on
  Windows `path.resolve` and a string join disagree and the symptom would be
  every file silently scoring 0.
- **The composer stash is durable.** `composerStash` was `useState`, so a
  shelved prompt died with the process — and a prompt is shelved precisely
  because the user is not ready to send it, which outlives one session. It is
  written by `commitComposerStash` in the originating interaction and flushed
  immediately, the same rule the follow-up queue follows, because a stash that
  does not survive an immediate exit has not survived anything. Both files go
  through one `createJsonListStore` in `lib/tuiComposerState.ts`: a torn write of
  either reads back as unparseable JSON, which is indistinguishable from "nothing
  stored" and silently discards work the user believed was kept.
- **`tui/opentui/latestWorkerQueue.ts` supersedes, and only an idempotent read
  may go through it.** A newer request for the same key replaces a pending older
  one instead of queueing behind it. The shape it exists for is a surface that
  re-asks the same question on every keystroke: without superseding, a slow
  answer makes the queue grow while the user types, and every answer but the
  last is computed and discarded — the worker spends its time on questions
  nobody is waiting for any more, which is exactly when the one the user *is*
  waiting for arrives late. A superseded caller is resolved with the newer
  answer, which is sound only because it answers the same question of newer
  state. **A dispatched request is never superseded** (it has already been
  posted; a request arriving during `run` starts a new slot), and a rejecting
  `run` is reported through `onError` rather than escaping — an unhandled
  rejection is fatal under Bun, and the smoke caught exactly that.
- **`supersede` is required, because superseding *drops* a request.** Nothing
  will ever dispatch it, so an owner whose requests carry a promise must settle
  it there. Omitting it is not a missing optimization, it is a caller that waits
  forever with no error and no failing frame — the threading smoke caught it as
  a test timeout rather than an assertion. A queue whose requests are pure side
  effects passes an explicit no-op.
- **`createKeyedWorkerQueue` serializes per key and lets keys run concurrently**
  — the shape of opencode's `SessionRunCoordinator`. A single global queue would
  be the wrong trade: two sessions' reads share no state to race over, so
  serializing them would give up the overlap of their disk I/O for nothing.
  Idle instances are dropped, or the map grows with every key ever seen, and
  those keys carry a session id and a display variant.

The composer's mention filter uses the plain queue; `threadingWorkerClient.ts`
uses the keyed one for `detail`, `warm` and `format`.

- **The key is the whole question, and that is what makes superseding sound.**
  A superseded caller is handed the replacement's answer, so the key must carry
  everything that would make the two answers different: the session *and* the
  display variant for a detail or a warm, plus the threaded array's identity for
  a format. Answering a `balanced` read with `dense` cards, or a format with
  another transcript's cards, would render a different number of cards than the
  caller has messages. The threaded identity is minted per array in a `WeakMap`
  rather than derived from contents — this runs on every density toggle and the
  arrays are the transcript.
- **The delta baseline is captured inside `run`, at the moment of posting.**
  Capturing it when the caller enqueued would reintroduce exactly the staleness
  the queue removes: the baseline maps are updated on *response*, so a request
  that waited behind another would carry a baseline the worker had already
  superseded.
- **What this is worth:** the worker handles each message in its own async task,
  so two reads for one session interleaved there. Both sides guard their
  baselines with tokens, so an overlap was never *wrong* — it fell back to
  shipping the whole transcript. On the 10,000-message benchmark in
  `transcriptDeliverySmoke.ts` that fallback is **42.6MB and a 49.3ms clone**
  against **5.1KB and 0.007ms** for the suffix it should have sent. The reachable
  case is a foreground detail landing while a background refresh for the same
  session is in flight: `refreshSelectedSessionDetail` guards foreground loads
  against each other and background polls per key, but not one against the other.
- **`App.tsx` keeps its own coalescing, deliberately.**
  `foregroundLoadInFlightRef` / `pendingForegroundLoadRef` are the same
  serialize-and-supersede shape hand-rolled one layer up, and the neighbour
  prefetch already yields to a foreground open between warms — so prefetch
  starvation is bounded to one in-flight warm (~6ms), not worth a priority
  queue. The client-side queue is a backstop for the paths that slip past those
  guards, not a replacement for them.

#### Chord help is derived from the chord table (load-bearing)

`tui/opentui/chordHelp.ts` builds every description of a prefix chord — the
pending-chord hint in the status bar, the unknown-key notice, and the overlay —
from one table per prefix. Taken from opencode's which-key panel, which renders
from the binding registry rather than from a maintained list.

The problem is drift, not effort. ⌃B was described in two places and ⌃K in two
more, each a hand-written string, so a chord could be added to the dispatcher and
stay out of some of its own help — or, worse, a removed chord could go on being
advertised. `SPLIT_CHORD_HELP` had a partial guard; ⌃K had none, and its command
ids and labels lived apart, so a renamed command kept its old label.
`chordHelpSmoke.ts` now asserts both directions for ⌃K against
`PORTABLE_COMMAND_CHORDS`, which is the dispatcher's own table.

- **A self-revealed panel must not consume the keystroke it is advertising.**
  Hesitating on a prefix reveals its keys after `CHORD_HELP_REVEAL_MS`; the
  overlay's dismiss branch sits *above* the chord dispatcher, so a panel that
  absorbed the next key would mean hesitating changed what that key does. Only a
  panel the user opened on purpose (`⌃B ?`, the palette) sets `dismissOnKey`, and
  that is the one that closes on any key — a reference card the user asked for
  should not leave them hunting for the key that dismisses it.
  `chordHelpRevealSmoke.tsx` presses an *unbound* key while a revealed panel is
  up and asserts the dispatcher's notice appears: the panel and the pending chord
  are both on screen, and which of them owns the next key is invisible in the
  frame until you press one. Widening the branch to `if (chordHelp)` was verified
  to fail it.
- **The hint lists only what the next keystroke can do.** ⌃B's table also
  documents the keys a *focused pane* takes, which need no prefix; those belong
  in the overlay as reference and never in the hint.
- **The hint is one line, and what truncation costs is the escape hatch.** It
  shows one key per entry (an entry may bind aliases — `% · v` — and spelling all
  of them out costs more width than the rest of the entry), uses `short` wording,
  and an entry may opt out with `hint: false`. Entries are **included by
  default**, so a new chord cannot go silently unadvertised; opting one out is a
  deliberate decision that it refines a listed key. The smoke pins the rendered
  width against a 120-column bar and asserts `cancel` and `all keys` survive.
- **The overlay is budgeted against the composer dock, which draws over it.**
  The old `height - 8` ignored the dock and clipped the footer — which is where
  the panel says how to dismiss it, so an overflow note the reader never sees.

#### Streaming markdown renders a block at a time (load-bearing)

`lib/markdownStream.ts` splits a document into top-level blocks so a streaming
answer re-renders only its tail: `MarkdownBlockView` in `components/MessageItem.tsx`
is memoized per block, and react-markdown re-parses whatever it is handed, so
handing it the whole document per delta makes the cost of one token grow with
everything already written. Measured over 120 deltas: **191ms → 36ms at 1.5KB,
374ms → 54ms at 4.7KB, 837ms → 104ms at 11.9KB** (5.3x / 6.9x / 8.0x). The
saving growing with the document is the point.

- **Splitting is only safe where a block means the same thing alone as it does
  in the document**, and two constructs are document-scoped: a link reference
  definition (`[1]: https://…`) and a GFM footnote definition both resolve
  references anywhere in the document. Split apart, the paragraph loses its
  definition and renders literal bracket text — a silent downgrade from a link,
  with no error and a result that still looks like markdown. Both bail out to
  whole-document rendering. Merely *mentioning* `[^` in prose (a regex, say)
  must not: that would disable the optimization for the whole answer.
- **The blocks must reassemble into exactly the input.** A `space` token is
  attached to the preceding block rather than dropped, and the projection
  verifies the total length before splitting — a lexer that rewrote a `raw`
  would lose content from the middle of an answer and nothing else would notice.
- **A finished block's `raw` must be byte-identical across deltas** or nothing
  memoizes, and keys are positional for the same reason: keying by content would
  remount the tail on every delta, which is the work this exists to avoid.
- **The tail block is never marked complete**, even when it currently parses as
  a finished construct — the next delta may extend it.
- `scripts/markdownStreamSmoke.ts` compares per-block rendering against
  whole-document rendering across a corpus, because both outputs look like
  plausible markdown and only a differential test can tell them apart. Dropping
  the reference-definition bail-out and dropping the `space` tokens were both
  verified to fail it.

#### The composer's git indicator is spawn-bound, not CPU-bound (load-bearing)

`fetchGitSummary` runs three `git` commands (`rev-parse`, `status --porcelain -u`, `rev-list
--walk-reflogs`) behind the composer's branch/dirty indicator. **Measure it in process spawns, not
milliseconds.** On this repo one poll costs ~26ms wall but only **~4ms of main-thread CPU and under
1ms of event-loop lag** — the work is in the child processes, on other cores. A CPU profile makes
this look far worse than it is: `lib/gitNodeProvider.ts`'s node was credited 929.7ms, 562.8ms of
which came from a *single* sample inside `node:child_process`, and its "645 calls" were 645 samples
against 18 real spawns. Do not go looking for a render-thread stall here; there isn't one.

What is real is the spawn rate. `tui/opentui/gitSummaryCache.ts` keys by **cwd rather than by
session**, which is what collapses the waste: the composer effect fires immediately whenever
`composerWorkingDirectory` changes, so switching between two sessions in the same repository — the
common case, and the point of tabs — used to re-spawn all three commands per switch against an
answer milliseconds old. The cache also single-flights, so concurrent readers share one spawn rather
than thirty. Its TTL is deliberately **shorter than the poll interval**: this deduplicates
back-to-back readers, it does not slow the poll, and a cache outliving the interval would make the
working-tree indicator stale on purpose. `peekGitSummaryCached` is not TTL-gated for the opposite
reason — a stale branch name for the moment before a refresh lands beats a blank one.
`gitSummaryCacheSmoke.ts` asserts the reuse by timing (a cached read must be far under a real ~26ms
one), because spawn count has no other observable.

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
| `tui/opentui/App.tsx` | ~22730 | OpenTUI root; entire reader, composer, key handling, `cardDisplayData` memo, scrollbox layout |
| `components/MessageView.tsx` | ~10460 | Web virtual-scroll timeline, top bar, session controls, `VirtualTimelineRow`, `handleTimelineRowMeasure` |
| `components/MessageItem.tsx` | ~6750 | Renderer for every threaded block — all tool cards (bash/edit/read/grep/glob/agent/etc.) live here |
| `tui/App.tsx` | ~2450 | Legacy Ink TUI root |
| `lib/sessionBackend.ts` | ~6900 | Send/turn path per-provider switch, plus the router that dispatches read ops to `lib/adapters/` |
| `components/SessionList.tsx` | ~2330 | Sidebar: project grouping, search, tag filters, collapsible groups |
| `lib/sessionPersistence.ts` | ~1570 | SQLite mirror of sessions+messages; powers `/api/session-index/*` search/rebuild/stats |
| `components/GitPopover.tsx` | ~1370 | Git diff/branch popover |
| `tui/opentui/EditorPopover.tsx` | ~5510 | Project editor: explorer, buffers, LSP, completion, search, highlighting, key handling |
| `tui/opentui/AnalyticsPopover.tsx` | ~1150 | OpenTUI analytics overlay (separate impl from the web one) |
| `components/AnalyticsPopover.tsx` | ~1050 | Recharts analytics |
| `components/CommandPalette.tsx` | ~1010 | Web cmd-K palette: provider switch, theme, session actions, navigation — single registry of user-facing commands |
| `app/globals.css` | ~1000 | All ~30 themes' CSS vars + base styles (each `[data-theme="…"]` block is contiguous) |
| `tui/format.ts` | ~2915 | `formatTranscriptCards` / `formatMessageExpanded` (shared by both TUIs) |
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
