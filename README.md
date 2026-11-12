# Agent Viewer

Agent Viewer is a local workbench for coding agents. It reads the sessions every agent CLI on your machine has already recorded — Claude Code, Codex, OpenCode, GitHub Copilot, Pi, any Agent Client Protocol agent and LM Studio — and lets you browse, search, continue, review and coordinate them from one place.

It runs as:

- a **terminal app** (OpenTUI, the default `agent-viewer` command)
- a **web app** (Next.js, `agent-viewer web`), usable from a paired phone or second browser
- an optional **desktop shell** (Tauri, `npm run desktop:dev`) around the web app

All three sit on the same backend. Sessions are always read and driven through each provider's own SDK, CLI or protocol; Agent Viewer never parses provider transcripts itself, and keeps its own state (tags, titles, inbox, search index, layouts) under `.agent-viewer-data/`. It is built for one developer's machine, not hosted multi-user use.

## Quick start

```bash
npm install
npm run tui        # terminal app (needs Bun on PATH)
npm run dev        # web app on http://localhost:3000
```

From a published package the same entry points are `npx agent-viewer` (terminal), `npx agent-viewer web` (web daemon) and `npx agent-viewer --legacy` (the older Ink terminal UI).

To keep agent turns running after the terminal closes, host them in a background daemon and attach to it:

```bash
agent-viewer --daemon              # start (or reuse) a daemon and attach the TUI to it
agent-viewer daemon status|start|stop
agent-viewer --attach 3000         # attach to an `agent-viewer web` already running
```

Choose the startup provider with `AGENT_VIEWER_PROVIDER` (`claude`, `codex`, `opencode`, `copilot`, `pi`, `claude-acp`, `codex-acp`, `acp`, `lmstudio` or `all`). The in-app picker remembers the choice in `.agent-viewer-data/provider.json`.

## Features

### Sessions and transcripts

- One session list across every provider and every configured account, grouped by project and date, with **NEEDS YOU**, **RUNNING** and **PINNED** groups lifted to the top.
- A session inbox: pin, settle, reopen, snooze, tag, rename, and link a pull request so the session settles itself when the PR merges.
- Full-text search over titles, tags, working directories and message text, backed by a local SQLite index.
- Live-updating transcripts with tool cards for every tool, diffs, reasoning, subagent conversations, Coordinator mail and raw provider frames (`RAW`) for when a card looks wrong.
- Composable **views**: 13 built-in transcript presets (stream, scrollback, engineering, …) and a View Studio for building your own. Custom views are shared between the web and terminal apps.
- About 30 themes, shared names between web and terminal; the terminal can follow the terminal emulator's light/dark mode or use its own palette.

### Composer

- Send, steer a running turn, queue follow-ups, interrupt, and keep per-session drafts and a durable stash.
- Native permission and question prompts, plan approval, model / effort / permission-mode switching where the provider supports them.
- Each CLI's own slash commands answer in place (`/model`, `/rewind`, `/fork`, `/diff`, `/mcp`, `/export`, `/plan`, …), `!command` shell mode, `@` file mentions ranked by frecency, prompt history and ⌃R search.
- Saved prompt templates, session goals that keep working until done, voice input (on-device; see [docs/voice.md](docs/voice.md)).
- Route the composer into a Claude Code session open in another terminal (channel bridge) or act as the IDE for one (IDE bridge).

### Workspace (terminal app)

- **Spaces** per project and **workspace tabs** per working set; each keeps its own windows, layout, drafts and undo history, and restores after a restart.
- Tiling windows: tmux-style `⌃B` splits, stacks, grids, tabs, floating windows, zoom, drag-and-drop with the mouse, saved layouts and undoable layout changes.
- Any tool can be a window, a tab or a docked side panel: shells, dev-server logs, files, diff, editor, pull request, browser, analytics and more.
- Broadcast one prompt to several sessions, jump to whichever window needs attention, and watch a whole agent team as a workspace.

### Code and review

- **Git**: working tree, diff review with notes and per-hunk accept/reject, commit and branch workspace, sibling worktrees and paused merges.
- **Checkpoints**: a working-tree snapshot per agent turn, restore, and per-file history you can scrub through and undo a hunk from.
- **Editor**: a real terminal editor with language servers, incremental syntax highlighting, quick open, symbol search and safe saves.
- **Pull requests and GitHub** through `gh`: PR review, inbox, issues, Actions runs and logs, releases and security alerts, with guarded merge.
- **Code provenance**: which session and prompt wrote a line.
- Agent-driven review: agents can read and annotate an open review through MCP (`review_read`, `review_apply`, `review_reload`).

### Multiple agents

- **Coordinator**: turn any chat into the lead of a team of teammates on any provider, with a shared task board, typed mailbox, path locks, isolated git worktrees, plan approval, completion gates, budgets, merge previews and durable recovery.
- Unattended workers (`agent-viewer coord worker`) that supervise a CLI session through a run and survive crashes and restarts.
- Cross-session messaging, and teams on other machines listed beside your own (`agent-viewer machines`).

### Insight

- Per-session analytics (tokens, tools, timing, health score), diagnostics (context usage, permission rules, hooks, MCP servers), task lists, file and tool insights.
- A daily summary of what every agent did, a Bloomberg-style "desk" over all sessions, recaps for sessions that went quiet, and alerts when a session needs you.

### Access from elsewhere

- Pair a phone or second browser with a QR code (`agent-viewer pair`), with per-device revocation and `full` or `read-only` scopes; Tailscale addresses are offered when available.
- Script everything: `agent-viewer session …`, `coord …`, `terminal …` and `review …` (see [Command line](#command-line)).

## Supported providers

| Provider | Accessed through | Notes |
|---|---|---|
| Claude | `@anthropic-ai/claude-agent-sdk` | Fork, rewind, file checkpoints, diagnostics, subagents, multiple accounts via provider instances |
| Codex | `codex app-server` (the `codex` CLI on `PATH`) | Rollback/revert, plan mode, sub-agents, multiple accounts |
| OpenCode | `@opencode-ai/sdk` (1.x) and `@opencode/client` (2.x) | Server version is detected; a managed server is started if none is running |
| GitHub Copilot | `@github/copilot-sdk` | Auto-starts the Copilot CLI |
| Pi | `@earendil-works/pi-coding-agent` | Session branches for forking |
| Claude (ACP), Codex (ACP) | `claude-agent-acp` / `codex-acp` over the Agent Client Protocol | Alternate transports for the same two agents |
| ACP | Any agent that speaks ACP (Gemini CLI, Goose, `opencode acp`, `copilot --acp`, …) | Configure the command; each agent can be its own instance |
| LM Studio | LM Studio's OpenAI-compatible server | Local models; `LMSTUDIO_BASE_URL` (default `http://localhost:1234/v1`) |
| All | — | Merges every provider and instance into one list |

The UI is capability-driven: an operation a provider cannot do is hidden or disabled for that session rather than failing late.

## Architecture

```text
            Web (Next.js)        OpenTUI terminal        Desktop (Tauri)
                 │                      │                      │
           app/api/* routes      lib/tui/service.ts      (wraps the web app)
                 └──────────┬───────────┘   --attach ──► web daemon over HTTP
                            ▼
       lib/sessionReads.ts (read path)   lib/sessionBackend.ts (send path)
                 │                                │
       lib/adapters/<provider>.ts        lib/extensions/providers/<id>/runtime.ts
                 └──────────────┬─────────────────┘
                                ▼
               provider SDKs, CLIs and protocols (server-side only)

   Shared: lib/types.ts (wire format) · lib/threading.ts (render blocks)
           lib/sessionPersistence.ts (SQLite index) · plugins/* (features)
```

- **Providers are extensions** under `lib/extensions/providers/<id>/`: a manifest (capabilities, composer), an adapter for reads (list, transcript, models, diagnostics…) and a runtime for sends (turns, fork, rewind, interrupt). Every provider produces the same `SessionMessage` shape, and `lib/adapters/registry.ts` checks at load time that declared capabilities and implemented methods agree. Scaffold a new one with `npm run providers:scaffold -- <id> "<Name>"` ([docs/provider-extensions.md](docs/provider-extensions.md)).
- **The read path never loads the send path.** Browsing sessions does not start provider runtimes, and provider SDKs load only when that provider is used. This keeps the terminal app's memory and startup cost low.
- **Session identity is provider + provider instance + session id**, because native ids overlap across runtimes and accounts.
- **Features are plugins** under `plugins/<id>/`: a metadata-only manifest plus a web view and/or a terminal view that reach the host only through the shell SDK. Plugins contribute surfaces (panel, window, overlay), commands, composer accessories and before-turn hooks; the host owns layout, focus and session identity. Start with the [plugin authoring skill](.agents/skills/agent-viewer-plugins/SKILL.md); [docs/plugin-shell-audit.md](docs/plugin-shell-audit.md) records what has migrated.
- **The terminal app** (`tui/opentui/`) runs under Bun, keeps heavy work (threading, formatting, metadata) in a worker isolate, and renders a bounded window of transcript cards so cost does not grow with conversation length. `tui/` still holds the legacy Ink UI.
- **Protocols**: an MCP server for Claude/Codex/other CLIs (`agent-viewer mcp`), the Microsoft Agent Host Protocol for Coordinator runs (`agent-viewer ahp`), an optional A2A 1.0 facade, and an ACP agent endpoint so editors such as Zed can drive any provider through Agent Viewer (`agent-viewer acp`).

### Bundled plugins

| Plugin | What it does |
|---|---|
| analytics | Token, tool, timing and health views over a session |
| bridges | Claude CLI channel bridge and IDE bridge panels |
| browser | A local dev server or any URL beside the transcript |
| checkpoints | Per-turn working-tree snapshots, restore, rejectable hunks |
| composer-context / composer-tools | Expand attached references before sending; reuse the last prompt |
| coordination | The agent control center and a conversation's teammates panel |
| desk | Bloomberg-style monitor over every session |
| diagnostics | Runtime status, context, permission rules, hooks, MCP servers |
| editor | Project editor with language servers and highlighting |
| file-history | Scrub a file through turn checkpoints, undo a hunk |
| files | Project tree and previews |
| git | Working tree, diff review with notes, commits and branches |
| github | Inbox, PRs, issues, Actions, releases, security, through `gh` |
| goals | A session goal that keeps working until done |
| messaging | Send from one session to another |
| prompt-library | Saved prompt templates with fill-in fields |
| pull-requests | PR diff, notes, discussion and checks |
| recaps | One-line recap and suggested next message for quiet sessions |
| session-alerts | Notify when a session needs input or finishes |
| session-insights | Files touched, tool timing, facet search, rail badges |
| subagents | Captured subagent conversations (terminal) |
| tab-manager | Pin and reorder tabs |
| tasks | A session's todos and background tasks |
| terminal | Dev-server processes with logs, and interactive shells |

### Repository map

| Path | Contents |
|---|---|
| `app/`, `components/` | Web routes, API routes (`app/api/`) and React UI |
| `tui/opentui/` | Primary terminal app; `tui/opentui/app/` holds its extracted modules |
| `tui/` | Legacy Ink terminal app and shared card formatters (`tui/format.ts`) |
| `lib/` | Provider clients and mappers, adapters, backend facades, persistence, Coordinator, remote access |
| `lib/extensions/providers/` | One extension per provider |
| `plugins/` | Bundled feature plugins |
| `bin/` | `agent-viewer` CLI, MCP/AHP/ACP entry points, Coordinator and session CLIs |
| `channels/` | Claude Code channel and IDE bridge servers |
| `src-tauri/` | Desktop shell |
| `scripts/` | Smoke tests, live checks and benchmarks |
| `docs/` | Design notes, audits and protocol mappings |
| `lib/codex-schema/` | Generated Codex protocol types (do not edit by hand) |

## Provider setup

### Provider instances

Several Claude or Codex accounts, and any number of ACP agents, can be configured in `.agent-viewer-data/provider-instances.json` (local and gitignored):

```json
{
  "version": 1,
  "instances": [
    { "id": "claude-work", "provider": "claude", "displayName": "Claude · Work", "environment": { "CLAUDE_CONFIG_DIR": "/path/to/work" } },
    { "id": "codex-personal", "provider": "codex", "displayName": "Codex · Personal", "executable": "codex" },
    { "id": "gemini", "provider": "acp", "displayName": "Gemini", "executable": "gemini --experimental-acp" }
  ]
}
```

A session is always read and prompted through the instance that listed it. Inbox state lives in `.agent-viewer-data/session-inbox.json`, so identical native ids stay distinct across instances.

### Claude

Supports listing, reading, sending, renaming, tagging, deleting, forking, resuming from a message, file rewind, diagnostics, models, context usage and subagent transcripts. Diagnostics can add or remove session MCP servers, reload plugins and skills, and search a redacted hook timeline.

- **SQLite session store** (optional): `AGENT_VIEWER_CLAUDE_SESSION_STORE=sqlite` mirrors transcripts into `.agent-viewer-data/claude-session-store/index.sqlite` (or `AGENT_VIEWER_CLAUDE_SESSION_STORE_PATH`). Store-backed sessions keep durable resume but not file rewind.
- **Remote workers over SSH**: set `AGENT_VIEWER_CLAUDE_SSH_HOST` and `AGENT_VIEWER_CLAUDE_SSH_COMMAND` (optionally `_USER`, `_PORT`, `_IDENTITY_FILE`, `_KNOWN_HOSTS_FILE`, `_LOCAL_ROOT`, `_REMOTE_ROOT`). Strict host-key checking is used, and Claude secrets are not forwarded unless `AGENT_VIEWER_CLAUDE_SSH_FORWARD_SECRETS=1`. Custom transports can register a spawner with `registerClaudeProcessSpawner` (`lib/claudeProcessSpawner.ts`).

#### Channel bridge to a running Claude Code CLI

Route the composer into a Claude Code session open in another terminal. Start the CLI from `channels/` so its `.mcp.json` loads the bridge:

```bash
cd channels
AGENTVIEWER_CHANNEL_SESSION_ID=<claude-session-id> \
  claude --resume <claude-session-id> \
  --dangerously-load-development-channels server:agentviewer
```

Then enable **Route composer through bridge** in the Channel Bridge panel. Delivery is at-least-once with duplicate suppression: unsent messages are persisted and replayed in order, and each shows queued, accepted or processed (Claude confirms processing by calling `ack_delivery`). The bridge defaults to `http://127.0.0.1:8790`; `AGENTVIEWER_CHANNEL_PORT` / `AGENTVIEWER_CHANNEL_URL` run several, `AGENTVIEWER_CHANNEL_TOKEN` enables loopback auth, and `AGENTVIEWER_CHANNEL_STATE_DIR` relocates its state.

### Codex

Spawns `codex app-server --listen stdio://`; `codex` must be on `PATH`. Titles are written through the app-server, tags are stored locally. Reads avoid loading threads, so browsing Codex sessions does not start their MCP servers.

### OpenCode

Tries `OPENCODE_BASE_URL`, then `OPENCODE_SERVER_URL`, then `http://127.0.0.1:4096`, and otherwise starts a managed server (`OPENCODE_PORT`, `OPENCODE_START_TIMEOUT_MS`). OpenCode 1.x and 2.x are both supported; the version is asked of the server. For a password-protected server set `OPENCODE_SERVER_PASSWORD` (and `OPENCODE_SERVER_USERNAME` if not `opencode`). If managed startup fails, run `opencode serve` yourself and set `OPENCODE_BASE_URL`.

### GitHub Copilot

The SDK auto-starts the Copilot CLI over stdio. Optional: `COPILOT_CLI_URL`, `COPILOT_CLI_PATH`, and `COPILOT_AUTO_TIER` (`efficiency`, `balance`, `intelligence`, `fast`) for Auto model routing. Titles and tags are stored locally.

### Pi

Uses Pi's session manager; set `PI_SESSION_DIR` if sessions live outside the default location. Titles and tags are stored locally; forking uses session branches.

### ACP agents

`claude-acp` and `codex-acp` drive `claude-agent-acp` / `codex-acp` (install separately, or point `CLAUDE_AGENT_ACP_PATH` / `CODEX_ACP_PATH` at them). The generic `acp` provider runs any ACP agent: set `AGENT_VIEWER_ACP_COMMAND` for the default instance, or add `provider: "acp"` instances. Listing, history and models are used where the agent advertises and actually supports them; operations ACP lacks (rewind, rollback) are unavailable.

### LM Studio

Start LM Studio's local server and select `lmstudio`. Set `LMSTUDIO_BASE_URL` if it is not on `http://localhost:1234/v1`.

## Coordinator

The Coordinator runs teams of agents across providers on one SQLite-backed ledger: a lead plans and delegates, teammates claim tasks, and everyone talks through a durable mailbox.

**From the apps**: press `⌃K t` in the terminal app (or open the Teammates panel on the web) to make the current chat a lead, `⌃⇧N` to launch a coordinated workflow, and `⌃⇧A` for the Agent Operations board. Teammates work in isolated git worktrees by default; plan approval, completion gates (e.g. `npx tsc --noEmit`) and teammate count are set when the run starts.

**From other CLIs** over MCP. Start the daemon, then register the bridge:

```bash
npx agent-viewer web --port 3000
claude mcp add agent-viewer -- npx -y agent-viewer mcp --attach 3000
codex mcp add agent-viewer --env AGENT_VIEWER_ATTACH=http://127.0.0.1:3000 -- npx -y agent-viewer mcp
```

The CLI then gets session tools (`search_sessions`, `list_sessions`, `message_session`, `get_session_transcript`, `set_bookmark`, `post_attention`), review tools (`review_read`, `review_apply`, `review_reload`) and the `coord_*` tool set. One client calls `coord_create_run`, others `coord_join_run`; identities are kept in mode-0600 files and never shown to the model. Leads assign work with `coord_delegate`. The bridge speaks MCP `2026-07-28` (and older initialize-based clients) and supports MCP Apps (a run dashboard), Skills over MCP, resource subscriptions for push updates, progress, and experimental Tasks for long waits.

**Unattended workers** supervise a provider session through a run, heartbeat, retry with backoff and hand work back when they fail:

```bash
agent-viewer coord worker --start "Implement the release" --playbook release --name lead --provider codex --max-agents 4 --attach 3000
agent-viewer coord worker --join <run-id> --name reviewer --provider claude --attach 3000 --detach
agent-viewer coord worker --join latest --name gemini --acp-command "gemini --experimental-acp"
agent-viewer coord workers | logs <name> -f | restart <name> | doctor
```

**Scripting** a run from a shell: `agent-viewer coord run|join|status|delegate|send|inbox|wait|runs|whoami|tools|call <tool>` prints JSON, binds to the directory it was started in, and exits 3 when a `wait` times out.

**Other transports**: Coordinator traffic uses a persistent AHP WebSocket on the web port plus one (`--ahp-port`, `AGENT_VIEWER_AHP_PORT`, `--no-ahp`); `agent-viewer ahp [--listen|--ws host:port]` serves the Agent Host Protocol standalone ([docs/ahp-coordinator.md](docs/ahp-coordinator.md)). An A2A 1.0 facade is off by default:

```bash
AGENT_VIEWER_A2A_ENABLED=1 AGENT_VIEWER_A2A_TOKEN='long-random-token' npm run dev
```

It advertises `/.well-known/agent-card.json`, serves JSON-RPC at `/api/a2a` (bearer auth, `A2A-Version: 1.0`), and works on existing runs only — it never creates runs or launches processes.

Workflow guidance for agents lives in the bundled skill, [`.agents/skills/coordinate-agents/SKILL.md`](.agents/skills/coordinate-agents/SKILL.md). User-level command hooks for run events go in `<coordinator home>/hooks.json` (default `~/.agent-viewer/coordinator/`, or `AGENT_VIEWER_COORD_HOME`).

## Command line

| Command | Purpose |
|---|---|
| `agent-viewer` | Terminal app (`--attach <port>`, `--daemon`, `--no-mouse`, `--full-repaint`, `--legacy`) |
| `agent-viewer web` | Web app and daemon (`--port`, `--host`, `--production`, `--ahp-port`, `--no-ahp`) |
| `agent-viewer daemon status\|start\|stop` | Manage a background daemon |
| `agent-viewer pair [--scope read-only]` | Pair a phone or browser via QR code |
| `agent-viewer machines list\|add\|remove` | Show other machines' Coordinator teams in the rail |
| `agent-viewer session list\|get\|read\|prompt\|wait\|interrupt\|report\|explain` | Script ordinary chats |
| `agent-viewer terminal list\|read\|send\|keys\|run\|wait` | Drive the shells a running terminal app holds |
| `agent-viewer review read\|reload\|apply` | Agent controls for an open Git or PR review |
| `agent-viewer coord …` | Coordinator runs, workers and scripting (see above) |
| `agent-viewer mcp` | MCP bridge for other CLIs |
| `agent-viewer ahp` / `agent-viewer acp` | Agent Host Protocol host / ACP agent endpoint for editors |

## Terminal app essentials

| Key | Action |
|---|---|
| `?` | Command palette |
| `/` | Search sessions; `/` in a window searches its history |
| `v` | Choose a transcript view (`n`/`e` opens the View Studio) |
| `p` | Provider and instance picker |
| `⌃B` then `?` | Window keys: `%` split, `o` focus, `x` close, `w` layouts, `m` zoom, `u` undo, `p` switcher, `b` broadcast |
| `⌃B S` | Spaces and workspaces manager |
| `⌃K` then a key | Tools: `t` teammates, `s` daily summary, `b` desk, `l` processes, `v` page the transcript in `$PAGER` |
| `⇧O` | Side panel (browser, shell, files, diff, PR, agents) |
| `⇧D` | Diagnostics; `⇧U` checkpoints |
| `⌃⇧N` / `⌃⇧A` | Launch a team / Agent Operations board |

Hesitating after `⌃B` or `⌃K` shows the available keys. `⌃K` chords and custom commands can be rebound in `~/.config/agent-viewer/keys.json` (or `$AGENT_VIEWER_KEYS_FILE`).

Rendering knobs: `AGENT_VIEWER_TUI_MAX_FPS` (10–240; default 120, 60 on Windows), `--full-repaint` for terminals that leave stale fragments, `--no-mouse` to hand selection back to the terminal (useful in tmux and over SSH), `AGENT_VIEWER_DISABLE_TERMINAL_BROWSER=1` to open URLs in the desktop browser instead of a `terminal-browser` split. Inside tmux, `⌃B` belongs to tmux — use the command palette or send the prefix through.

## Remote access

Off by default. `agent-viewer pair` (or the Remote Access panel) mints a single-use, ~10-minute pairing code shown as a QR; the paired device receives its own session credential, stored only as a hash and revocable individually. Devices are either `full` or `read-only`, and what read-only may reach is declared per API route in `lib/routeScopes.ts` (undeclared routes are write-only). Cross-origin mutations to `/api/*` are blocked.

## Local data

`.agent-viewer-data/` (gitignored) holds the selected provider, provider instances, local titles and tags, the session inbox, saved layouts, remote-access state and the search index at `.agent-viewer-data/session-index/index.sqlite`. Deleting it resets Agent Viewer; provider-owned sessions are untouched. Terminal-app preferences live in `tui.json` alongside.

The index refreshes as sessions are read. Disable it with `AGENT_VIEWER_DISABLE_SESSION_INDEX=1`, or use the API:

```text
GET  /api/session-index/search?q=term&provider=all
GET  /api/session-index/stats?provider=all
POST /api/session-index/rebuild
```

## Development

```bash
npm run dev          # Next.js dev server
npm run build        # production build (npm start serves it)
npm run tui          # OpenTUI app; tui:dev watches
npm run tui:ink      # legacy Ink app
npm run desktop:dev  # Tauri desktop shell
```

There is no unit-test runner; verification is type-checking plus smoke suites:

```bash
npx tsc --noEmit            # web and shared code
npm run tui:check           # OpenTUI
npm run composer:smoke      # fast, no network
npm run routes:smoke        # remote-access scope table covers every route
npm run adapters:smoke      # every provider's read path against your local sessions
npm run plugins:smoke       # plugin boundaries
npm run tui:smoke           # terminal app (slow)
```

Performance and memory harnesses for the terminal app include `tui:navperf`, `tui:inputperf`, `tui:editortypingperf`, `tui:memrun` and `tui:memphases`. Contributor guidance, including the load-bearing design rules, is in [CLAUDE.md](CLAUDE.md).

## Troubleshooting

- **Bun error on launch**: install Bun and open a new terminal so `PATH` is updated.
- **Web app odd after switching branches**: delete `.next/` and rebuild.
- **OpenCode won't start**: run `opencode serve` and set `OPENCODE_BASE_URL`.
- **Copilot won't start**: set `COPILOT_CLI_PATH` or `COPILOT_CLI_URL`, or install `@github/copilot` globally.
- **Pi sessions missing**: set `PI_SESSION_DIR`.
- **ACP agent missing**: check the binary resolves on `PATH`, or set its path variable / command.
- **Search looks stale**: rebuild the index from the command palette or `POST /api/session-index/rebuild`.
- **Attached TUI reports a version mismatch**: restart the daemon (`agent-viewer daemon stop && agent-viewer daemon start`).
