# Agent Viewer

Agent Viewer is a local tool for browsing, searching, and continuing coding-agent conversations. It presents the same underlying session data in two frontends:

- a Next.js web app
- an OpenTUI terminal app

It is designed for a single local developer machine. The app reads provider sessions from local SDKs and CLIs, keeps viewer-specific state under `.agent-viewer-data/`, and avoids direct browser access to provider runtimes.

## Current Shape

The project currently centers on a shared provider backend plus two UIs:

- `app/` and `components/` power the browser UI.
- `tui/opentui/` is the primary terminal UI.
- `tui/` still contains the legacy Ink terminal UI for fallback and comparison.
- `lib/sessionBackend.ts` is the main orchestration layer that adapts each provider into one shared session model.
- `lib/sessionPersistence.ts` mirrors sessions and messages into a local SQLite index for search and stats.
- `lib/codex-schema/` is generated Codex protocol code, not hand-maintained application logic.

Supported providers today are:

- Claude
- Codex
- OpenCode
- GitHub Copilot
- Pi
- Claude (ACP) and Codex (ACP), alternate transports that drive `claude-agent-acp`/`codex-acp` over the Agent Client Protocol instead of the native SDK/app-server
- `all`, which merges sessions across providers

## Quick Start

Install dependencies:

```bash
npm install
```

Run the web app:

```bash
npm run dev
```

Open `http://localhost:3000`.

Run the primary terminal app:

```bash
npm run tui
```

`npm run tui` uses OpenTUI and requires Bun on `PATH`.

## What You Can Do

- Browse sessions by provider or across all providers.
- Search session titles, tags, working directories, and indexed message text.
- Open multiple session tabs and inspect live-updating transcripts.
- Send messages, interrupt active turns, and keep per-session drafts.
- Rename sessions, manage tags, and use provider-specific actions when supported.
- Switch models, reasoning settings, themes, density, and focus modes where the provider or UI supports them.
- Inspect diagnostics, context usage, analytics, Git state, and exports.
- Rebuild the local search index from the command palette or the API.

The UI is capability-driven. If a provider cannot do something, the action is hidden or disabled for that session instead of failing late.

## Architecture

The repository is organized around a few stable boundaries:

- `app/api/` contains the browser-facing API routes.
- `components/` contains the React UI for the web app.
- `lib/*Client.ts` handles provider-specific SDK or CLI access.
- `lib/*Mapper.ts` converts provider-native data into the shared view model.
- `lib/provider.ts` defines per-provider capabilities.
- `lib/providerComposer.ts` defines provider-specific composer copy and prompts.
- `lib/sessionBackend.ts` is the central facade used by API routes and shared services.
- `lib/sessionPersistence.ts` manages the SQLite-backed local index.
- `tui/opentui/` contains the current terminal runtime.
- `tui/App.tsx` remains as the legacy Ink runtime.
- `bin/agent-viewer.mjs` is the packaged `npx agent-viewer` entrypoint.

Some implementation choices matter:

- Browser components should call API routes, not provider SDKs directly.
- Provider SDKs and CLIs stay server-side because they rely on Node APIs like filesystem and process access.
- Session identity should always include the provider, because IDs can overlap across runtimes.
- New provider work usually touches the provider type, capability table, client, mapper, `sessionBackend.ts`, and the provider selection lists in the web and TUI layers.

## Provider Setup

You can choose the startup provider with:

```bash
AGENT_VIEWER_PROVIDER=claude npm run dev
```

Valid values are `claude`, `codex`, `opencode`, `copilot`, `pi`, `claude-acp`, `codex-acp`, and `all`. The in-app provider picker persists the choice to `.agent-viewer-data/provider.json`.

### Claude

Claude sessions are read through `@anthropic-ai/claude-agent-sdk`.

Supported viewer operations include listing, reading messages, sending, renaming, tagging, deleting, forking, resuming from a message, file rewind, diagnostics, models, context usage, and subagent messages where the SDK exposes them.

Coordinator-dispatched Claude tasks carry native Agent SDK role policy (tools, skills, model/effort, permission mode, sandbox, per-agent MCP servers, initial prompt, turn cap, memory, background/observer configuration, and critical reminders) plus remaining token and USD budgets. The USD remainder is enforced by the SDK's `maxBudgetUsd`, while observed SDK usage remains the durable run-level accounting source.

Claude diagnostics can add or remove dynamic session MCP servers, surface connection and authentication-required states, reload plugins/skills, and search the durable hook timeline. Lifecycle, tool, permission, compaction, subagent, configuration, worktree, and file hooks are redacted, size-rotated, and removed with the session. File previews use the SDK control channel's `readFile()` when a Claude session is selected, so hosted workers do not require a shared local filesystem for file contents.

Claude transcript mirroring can optionally use Agent Viewer's durable SQLite-backed Agent SDK `SessionStore`:

```bash
AGENT_VIEWER_CLAUDE_SESSION_STORE=sqlite \
AGENT_VIEWER_CLAUDE_SESSION_STORE_PATH=/path/to/claude-sessions.sqlite \
npm run dev
```

The path defaults to `.agent-viewer-data/claude-session-store/index.sqlite`. The SDK requires local transcript persistence alongside the mirror and currently rejects file checkpointing with a `SessionStore`, so store-backed sessions retain durable transcript resume but not file rewind. Cross-project session listing continues to use the SDK's local index because the alpha store API can list only one project key at a time.

Custom Claude process transports can register a `spawnClaudeCodeProcess` adapter with `registerClaudeProcessSpawner` from `lib/claudeProcessSpawner.ts` before creating or pre-warming queries. The adapter must return the complete SDK `SpawnedProcess` interface (live stdin/stdout streams and exit/error lifecycle methods) and forward `SpawnOptions.signal`. Explicit registration overrides the built-in opt-in SSH transport.

For a concrete hosted worker, set `AGENT_VIEWER_CLAUDE_SSH_HOST` and `AGENT_VIEWER_CLAUDE_SSH_COMMAND`. The SSH adapter uses batch authentication, strict host-key verification (the default known-hosts file unless `AGENT_VIEWER_CLAUDE_SSH_KNOWN_HOSTS_FILE` is supplied), keepalives, abort propagation, and transport health reporting. Optional settings are `AGENT_VIEWER_CLAUDE_SSH_USER`, `AGENT_VIEWER_CLAUDE_SSH_PORT`, `AGENT_VIEWER_CLAUDE_SSH_IDENTITY_FILE`, and local/remote root mapping via `AGENT_VIEWER_CLAUDE_SSH_LOCAL_ROOT` plus `AGENT_VIEWER_CLAUDE_SSH_REMOTE_ROOT`. Claude/Anthropic secret environment variables are not forwarded in the SSH command by default; provision credentials on the worker, or explicitly opt in with `AGENT_VIEWER_CLAUDE_SSH_FORWARD_SECRETS=1` after accepting process-list exposure on the remote host.

#### Claude and Codex CLI MCP bridge

Agent Viewer can expose cross-provider session search and transcripts, message bookmarks, and the human-attention inbox to standalone Claude and Codex CLIs over stdio. Start the web daemon first so the bridge and any attached TUI share one runtime:

```bash
npx agent-viewer web --port 3000
```

Register the packaged bridge with Claude Code:

```bash
claude mcp add agent-viewer -- npx -y agent-viewer mcp --attach 3000
```

Or register it with Codex:

```bash
codex mcp add agent-viewer \
  --env AGENT_VIEWER_ATTACH=http://127.0.0.1:3000 \
  -- npx -y agent-viewer mcp
```

The CLI then sees session tools (`search_sessions`, `list_sessions`, `message_session`, `get_session_transcript`, `set_bookmark`, and `post_attention`) plus the full `coord_*` tool surface for Coordinator mode under the `agent-viewer` MCP server. Transcript reads support provider selection plus offset/limit or tail pagination, and return Agent Viewer's canonical messages without discarding tool calls, tool results, reasoning, or system events. Search needs no session context. Transcript, bookmark, and attention calls must supply `session_id`, unless the MCP configuration sets `AGENT_VIEWER_SESSION_ID`. The bridge defaults to `http://127.0.0.1:3000`; `--attach`, `AGENT_VIEWER_ATTACH`, or `AGENT_VIEWER_MCP_URL` can point it at another local daemon.

The bridge uses the MCP TypeScript SDK v2 and serves the `2026-07-28` protocol through `server/discover` and per-request capability envelopes. Its stdio entry also serves older initialize-based clients, so existing Claude/Codex registrations continue to work while modern clients can pin or auto-negotiate the new revision. Tool results include both a text fallback and `structuredContent` for hosts that can render richer output.

Three optional MCP extensions make Coordinator workflows easier to discover, inspect, and resume:

- MCP Apps (`io.modelcontextprotocol/ui`): `coord_status` links to the self-contained `ui://agent-viewer/coordinator-dashboard.html` resource. Apps-capable hosts render the current run, open-task, inbox, lock, task, and agent state; text-only hosts keep receiving the normal JSON result.
- Skills over MCP (`io.modelcontextprotocol/skills`, experimental SEP-2640): `skill://index.json` advertises `skill://coordinate-agents/SKILL.md`, served directly from the canonical `.agents/skills/coordinate-agents/SKILL.md`, and the `coordinate_agents` prompt points compatible clients at that progressively disclosed workflow guidance.
- Push supervision: after `coord_create_run`, `coord_join_run`, or `coord_resume`, the result identifies the private `coord://agent-viewer/current-run` resource. MCP 2026 clients can subscribe once through `subscriptions/listen`; another participant's AHP board action then emits `notifications/resources/updated`. Re-read the zero-TTL private resource for the authoritative board and `actionable` digest. Bursts are coalesced and liveness-clock-only refreshes are suppressed.
- Tasks (`io.modelcontextprotocol/tasks`, experimental): a Tasks-capable request to `coord_wait` with a non-zero timeout receives a durable asynchronous handle instead of holding the MCP request open. `coord_await_run` creates a whole-run monitor for independently supervised or unattended runs and surfaces pending lead plan reviews as `input_required` elicitations. Clients retrieve state and final tool results through `tasks/get`, submit those reviews through `tasks/update`, and cooperatively cancel the wait/monitor through `tasks/cancel`. The handle survives bridge restarts in a mode-0600 ledger next to the Coordinator identity file; `AGENT_VIEWER_MCP_TASK_FILE` overrides that path.

MCP Tasks wrap long-running protocol operations; they do not replace Coordinator board tasks. Ownership, dependencies, path locks, mailboxes, findings, completion gates, and synthesis remain under the `coord_*` tools. Cancelling an MCP Task stops its wait or monitor, not the underlying multi-agent run. Resource subscriptions are the preferred MCP 2026 push path; `coord_wait` and `tasks/get` remain compatibility fallbacks for hosts that do not subscribe. The bridge carries a small compatibility adapter because the stable MCP TypeScript SDK v2 does not yet ship the experimental Tasks server runtime, and the smoke suite pins the published draft shapes to catch SDK drift.

Coordinator operations—including run discovery—use a persistent AHP WebSocket by default. `agent-viewer web`, `npm run dev`, and `npm start` start that host automatically on the web port plus one (`ws://127.0.0.1:3001` for the default web port). MCP bridges and workers reconnect with the same AHP client identity and run subscriptions; reads and idempotent mutations get one safe transport retry, and the bridge supplies an idempotency key when a tool call omits one. Use `--ahp-port` or `AGENT_VIEWER_AHP_PORT` to choose another sidecar port, and set the matching `AGENT_VIEWER_AHP_URL` on remote MCP bridges or workers. `--no-ahp` disables the sidecar; `AGENT_VIEWER_COORD_TRANSPORT=http` keeps the previous HTTP Coordinator transport as an explicit compatibility mode.

These internal transports do not become public when A2A is enabled. CLI hosts retain the `coord_*` MCP surface, and the app and bridges retain persistent AHP connections to the same SQLite-backed Coordinator ledger. A2A 1.0 is a separate, default-off external facade over that core:

```bash
AGENT_VIEWER_A2A_ENABLED=1 \
AGENT_VIEWER_A2A_TOKEN='replace-with-a-long-random-token' \
npm run dev
```

When enabled, `/.well-known/agent-card.json` advertises the JSON-RPC interface at `/api/a2a`. Operation requests require `Authorization: Bearer ...`, `Content-Type: application/json`, and `A2A-Version: 1.0`. The facade implements the A2A 1.0 PascalCase task methods, streaming over SSE, cursor-style task listing, and persisted push configurations for task status updates while intentionally refusing to create runs or launch CLI processes. `SendMessage` therefore requires `message.contextId` for an existing Coordinator run; set `configuration.returnImmediately` when the caller wants the submitted task immediately. Continuing an existing task through `SendMessage` is not currently supported and returns A2A’s unsupported-operation error. The legacy A2A 0.3 method names are not accepted.

This follows the protocols’ complementary roles: a remote autonomous peer uses A2A for the high-level, stateful task, while each hosted CLI agent uses MCP tools internally to claim it, coordinate with teammates, access locks and mail, and report completion. MCP hosts can discover the enabled facade by reading the live `a2a://agent-viewer/coordinator/agent-card.json` resource, which proxies the daemon’s public Agent Card. Agent Viewer deliberately does not wrap A2A conversational operations as stateless MCP tools or duplicate an A2A task as an MCP Task.

For interactive collaboration, one client calls `coord_create_run` and shares only the returned run ID. Additional clients call `coord_join_run`. The bridge persists each capability in a mode-0600 identity file and authenticates later `coord_*` calls without exposing the token to the model. Prefer one subscription to the returned `pushResource`; on each invalidation, read it and act on the current `actionable` digest. Use `coord_wait` when the MCP host cannot subscribe.

External clients negotiate the Coordinator protocol when they create, join, or resume a run. Current MCP bridges advertise protocol v2, session resume, tool families, and concurrency; managed workers additionally advertise unattended execution plus filesystem/git access. Omitted negotiation remains compatible as legacy v1. The negotiated version and capabilities appear on the participant roster so leads can make provider-aware assignments, while clients newer than the server fail early with an upgrade instruction instead of silently drifting.

Coordinator mail is typed and durable. `coord_send_message` requires the message body in `message` and accepts `kind` (`request`, `response`, `status`, `finding`, `handoff`, `review_request`, or `review_result`), `priority` (`urgent`, `normal`, or `status`), `reply_required`, `correlation_id`, and `in_reply_to`. Status messages are held until three updates accumulate or 15 seconds elapse, then delivered as one summary. Reply-required requests stay in the recipient's actionable digest until a correlated response resolves them.

Agent Viewer also exposes Coordinator runs directly through the Microsoft Agent Host Protocol. The standalone commands are useful when the Next.js UI is not running:

```bash
# Reliable ordered JSON-RPC frames on stdin/stdout
agent-viewer ahp

# The same newline-framed protocol on a local TCP socket
agent-viewer ahp --listen 127.0.0.1:8765

# WebSocket transport used by the official AHP clients
agent-viewer ahp --ws 127.0.0.1:8765
```

The host negotiates the protocol versions exported by the installed AHP reference SDK (currently AHP `0.7.0`, with its supported compatibility fallbacks) rather than maintaining a second hard-coded version list. A Coordinator run is an `ahp-session:` channel, its lead and teammates are `ahp-chat:` channels, and external participants appear as session `activeClients`. The task board, path locks, durable mailbox, plan approvals, and completion gates are preserved under the namespaced `dev.agent-viewer.coordinator` session metadata key. Standard snapshots, ordered and version-filtered `action` envelopes, write-ahead rejection reconciliation, and reconnect replay/snapshot fallback keep multiple AHP clients converged. See `docs/ahp-coordinator.md` for the mapping.

For unattended work, use the bounded supervisor. It resumes the same provider session for one useful tick, heartbeats while the CLI works, waits for the next Coordinator event, retries crashes with backoff, and exits when the run is terminal:

```bash
agent-viewer coord worker --start "Implement the release" --playbook release --name codex-lead --provider codex --max-agents 4 --attach 3000
agent-viewer coord worker --join <run-id> --name claude-api --provider claude --attach 3000
```

For multi-agent startup, seed the full board with `--playbook` before teammates join; an unseeded `--start` is intended only for a lead planning turn. Start-time controls also include `--max-agents 2..16`, `--gate-command <cmd>`, and `--require-plan-approval`. Joined workers create isolated git worktrees by default; pass `--shared` only when that is intentional. Claim-time baselines keep pre-existing dirty files out of completion checks while still detecting participant edits and commits. Mutating MCP tools accept a stable `request_id`, so a resumed CLI can safely repeat a request after losing its response. Stale participants are detected from heartbeat leases and have their locks and tasks released for reassignment.

Restart a supervisor with `agent-viewer coord worker --identity <file>`. A bridge can also load that file with `agent-viewer mcp --identity <file>` or `AGENT_VIEWER_COORD_IDENTITY_FILE`. The older run ID, agent ID, and token environment variables remain supported for compatibility. Treat identity files as secrets.

Workers register their PID, provider session, status, last classified failure, and log path outside the secret identity file. Inspect or recover the fleet with:

```bash
agent-viewer coord doctor --json --attach 3000
agent-viewer coord workers --json
agent-viewer coord workers --status stale --limit 20
agent-viewer coord logs <agent-name|agent-id|identity-file> -n 200
agent-viewer coord logs <agent-name|agent-id|identity-file> -f
agent-viewer coord restart <agent-name|agent-id|identity-file>
```

`coord doctor` is read-only and checks daemon reachability, protocol compatibility, provider CLI availability, identity validity/mode, and registered worker liveness. Provider probes run concurrently, and worker detail is bounded by `--limit` while the summary still covers the full registry. `coord workers --status stale` selects dead supervisors whose last persisted lifecycle state was active; `--status running` returns only live supervisors. Worker logs and registry records default to `~/.agent-viewer/coordinator/workers/`; set `AGENT_VIEWER_COORD_HOME` to relocate them.

Provider exits are classified as rate limit, authentication, context exhaustion, approval blockage, missing CLI, transient transport, or generic provider failure. A durable classified failure while a worker owns a task calls `coord_handoff_task`: it records a checkpoint, releases locks, returns the task to pending, marks the worker blocked, and sends the lead an urgent durable handoff. Transient transport failures retain bounded exponential retry behavior; an unclassified failure is handed off after three consecutive attempts.

### Codex

Codex uses the local `codex` CLI by spawning:

```bash
codex app-server --listen stdio://
```

The `codex` binary must be on `PATH`. The viewer uses the app-server protocol for thread listing, reading, sending, model selection, diagnostics, fork or continuation APIs where available, and rollback. Codex titles are written through the app-server; tags are stored locally by Agent Viewer.

### OpenCode

OpenCode uses `@opencode-ai/sdk`.

If a server is already running, the viewer tries these URLs in order:

1. `OPENCODE_BASE_URL`
2. `OPENCODE_SERVER_URL`
3. `http://127.0.0.1:4096`

If none is reachable, it attempts to start a managed OpenCode server. Optional settings:

```bash
OPENCODE_PORT=4096
OPENCODE_START_TIMEOUT_MS=15000
```

If managed startup fails because provider or model resolution blocks startup, run `opencode serve` yourself and set `OPENCODE_BASE_URL`.

### GitHub Copilot

Copilot uses `@github/copilot-sdk`.

By default the SDK auto-starts the Copilot CLI over stdio. Optional settings:

```bash
COPILOT_CLI_URL=http://localhost:3000
COPILOT_CLI_PATH=/path/to/copilot
```

If the CLI is not available, install `@github/copilot` globally or point `COPILOT_CLI_PATH` at the binary. Copilot title and tag overrides are stored locally because the viewer does not mutate Copilot session metadata on disk.

### Pi

Pi uses `@mariozechner/pi-coding-agent` and its session manager.

Use this when Pi sessions live outside the default location:

```bash
PI_SESSION_DIR=/path/to/pi/sessions
```

Pi title and tag overrides are stored locally. Forking uses Pi session branches.

### ACP transport (Claude, Codex)

`claude-acp` and `codex-acp` are alternate transports for the same two SDK-backed providers: instead of the native `@anthropic-ai/claude-agent-sdk` or Codex app-server integration, they drive `claude-agent-acp` / `codex-acp` as a subprocess over the [Agent Client Protocol](https://agentclientprotocol.com) (`session/new` → `session/prompt` → `session/update`). They are separate provider ids, not a flag on the native providers, and appear as their own entries in the provider picker.

These are **optional peer tools**, not npm dependencies — install them separately and make sure they resolve on `PATH`, or point directly at a binary with `CLAUDE_AGENT_ACP_PATH` / `CODEX_ACP_PATH`. A missing binary fails clearly at session-create time.

ACP-transport sessions are process-local and transient: the protocol has no session-listing, fork, rewind/rollback, delete, or model-listing RPC, so those operations are unsupported and the session list only ever shows sessions created and still pooled in this process (nothing persists across a server restart). Sending messages, permission/elicitation approval, and interrupt all work the same as the native providers.

## Local Data

Agent Viewer stores local state in:

```text
.agent-viewer-data/
```

This directory is intentionally not part of source control. It is used for:

- selected provider state
- local title or tag metadata for providers that need viewer-side storage
- the SQLite session and message index
- migrated legacy JSON index data

The session index is refreshed opportunistically when sessions and messages are read. It powers command-palette message search and aggregate stats.

Disable the local index with:

```bash
AGENT_VIEWER_DISABLE_SESSION_INDEX=1 npm run dev
```

Index APIs:

```text
GET  /api/session-index/search?q=term&provider=all
GET  /api/session-index/stats?provider=all
POST /api/session-index/rebuild
```

## Scripts

```bash
npm run dev        # Next.js development server
npm run build      # production build
npm run start      # production server
npm run tui        # OpenTUI terminal app
npm run tui:dev    # OpenTUI with watch mode
npm run tui:check  # type-check the OpenTUI surface
npm run tui:ink    # legacy Ink terminal app
npm run tui:ink:dev
npm run tui:smoke  # OpenTUI render smoke check
npm run doctor     # React diagnostics helper
```

## TUI Status

OpenTUI is the default terminal runtime. It supports provider selection, session navigation, transcript reading, tabs, search, folding, density and focus controls, theme selection, analytics, Git status, clipboard copy, refresh, and provider-backed sends where wired through the shared TUI service.

Transcript splits use a tmux-style `Ctrl+B` prefix (`Ctrl+B %` to add, `Ctrl+B o` to focus, and `Ctrl+B x` to close the focused pane). Inside tmux, tmux consumes `Ctrl+B`; use the `?` command palette for split actions, or send tmux's prefix through before the Agent Viewer chord.

### Agent Teams

Press `Ctrl+Shift+N` anywhere in the OpenTUI app to launch a coordinated workflow directly, or `Ctrl+Shift+A` to open Agent Operations first and press `n` from there. The launcher creates a lead that decomposes the request, a shared task board, direct teammate messages, path locks, optional completion gates, and an optional plan-approval guard. Teammates use isolated git worktrees by default; turn off **Isolate teammates in git worktrees** in the launcher only when they should deliberately share the current checkout.

OpenTUI enables enhanced keyboard reporting for terminals that support Kitty/CSI-u. In legacy terminals that cannot distinguish `Ctrl+letter` from `Ctrl+Shift+letter`, the raw `Ctrl+A` and `Ctrl+G` sequences fall back to the coordinator and pull-request shortcuts; analytics and Git status remain available from the command palette.

The start modal defaults plan approval on: teammates submit a `task.planned` approach first, Claude teammates are dispatched in plan mode for that planning turn, and the lead must emit `plan.approved` before implementation can complete. Use `Ctrl+P` to toggle plans, `Ctrl+T` to cycle teammate count, and the `gate` field for a command such as `npx tsc --noEmit` that must pass before a teammate task completes.

On the board, use `Enter` to open a teammate transcript, `m` to message the selected teammate or lead, `Shift+M` to broadcast, `x` to interrupt a selected teammate turn, `w` to stage-merge a teammate worktree, `f` to mark a stuck task failed, and `c` to clean up completed clean worktrees.

The legacy Ink UI remains available through:

```bash
npm run tui:ink
npx agent-viewer --legacy
```

## Troubleshooting

- If the web app behaves oddly after branch changes, clear `.next/` and rebuild.
- If the default CLI fails with a Bun error, install Bun and make sure the current terminal inherited the updated `PATH`.
- If OpenCode cannot start, run `opencode serve` separately and set `OPENCODE_BASE_URL`.
- If Copilot cannot start, set `COPILOT_CLI_URL`, set `COPILOT_CLI_PATH`, or install `@github/copilot` globally.
- If Pi sessions are not found, set `PI_SESSION_DIR`.
- If indexed search looks stale, rebuild the index from the command palette or call `POST /api/session-index/rebuild`.

## Notes

- Agent Viewer is intended for one local developer environment, not hosted multi-user use.
- Some behavior is provider-specific because the underlying SDKs and CLIs expose different capabilities.
- Local viewer metadata can be deleted by removing `.agent-viewer-data/`; provider-owned session data remains in the provider's own storage.
