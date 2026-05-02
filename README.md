# Agent Viewer

Agent Viewer is a local developer tool for browsing, searching, inspecting, and continuing coding-agent conversations. It has two frontends over the same local provider backend:

- a Next.js web UI
- an OpenTUI terminal UI

The app is built for local use against local agent runtimes. It reads local session stores, starts or connects to local provider SDKs, and stores only viewer metadata under `.agent-viewer-data/`.

Supported providers:

- Claude, through `@anthropic-ai/claude-agent-sdk`
- Codex, through `codex app-server --listen stdio://`
- OpenCode, through `@opencode-ai/sdk`
- GitHub Copilot, through `@github/copilot-sdk`
- Pi, through `@mariozechner/pi-coding-agent`
- `all`, which combines sessions from every provider

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

Run the terminal app:

```bash
npm run tui
```

The terminal app uses OpenTUI and requires Bun on `PATH`.

## Requirements

- Node.js 20+
- npm
- Bun for the OpenTUI terminal UI
- At least one supported local provider runtime or session store

Provider-specific requirements are listed below. The web UI does not require Bun unless you run the TUI.

## Packaged CLI

The package exposes an `agent-viewer` binary.

```bash
npx agent-viewer
```

By default this launches the OpenTUI terminal UI through Bun.

```bash
npx agent-viewer web
```

This launches the Next.js web UI on `127.0.0.1`.

Useful options:

```bash
npx agent-viewer web --port 3001
npx agent-viewer --legacy
npx agent-viewer --help
```

`--legacy` launches the older Ink terminal UI. On Windows, the CLI can use either `bun.exe` or a PowerShell shim such as `bun.ps1`.

## What The App Does

- Browse sessions by provider or across all providers.
- Group sessions by project and view project-level timelines.
- Scope the session list to the active project and optionally include worktrees.
- Search session titles, tags, working directories, and first prompts from the sidebar.
- Open multiple session tabs in the message pane.
- Read live-updating timelines with SSE streaming and polling fallback.
- Send messages, interrupt running sends, and keep per-session composer drafts.
- Select models and reasoning effort where the provider supports it.
- Attach provider-mapped inputs such as files, directories, selections, images, mentions, skills, and blobs.
- Rename sessions and manage tags, using provider-native metadata where available and local metadata otherwise.
- Use provider-specific actions such as fork, resume from message, rewind, rollback, delete, share, summarize, unrevert, and permission response when supported.
- Inspect diagnostics, model lists, context usage, and analytics.
- Export sessions to HTML.
- Use the command palette with `Ctrl/Command+K` for sessions, projects, provider switches, themes, sidebar/message-pane toggles, Git, indexed message search, and index rebuilds.
- Switch application themes and syntax-highlighting themes independently.

Controls are capability-driven. If a provider does not support an action, the UI hides or disables that action for that session.

## Provider Setup

You can choose the startup provider with:

```bash
AGENT_VIEWER_PROVIDER=claude npm run dev
```

Valid values are `claude`, `codex`, `opencode`, `copilot`, `pi`, and `all`. The in-app provider picker persists its value to `.agent-viewer-data/provider.json`.

### Claude

Claude sessions are read through `@anthropic-ai/claude-agent-sdk`.

Supported viewer operations include listing, reading messages, sending, renaming, tagging, deleting, forking, resuming from a message, file rewind, diagnostics, models, context usage, and subagent messages where the SDK exposes them.

### Codex

Codex uses the local `codex` CLI by spawning:

```bash
codex app-server --listen stdio://
```

The `codex` binary must be on `PATH`. The viewer uses the app-server protocol for thread listing, reading, sending, model selection, diagnostics, fork/continuation APIs where available, and rollback. Codex titles are written through the app-server; tags are stored locally by Agent Viewer.

### OpenCode

OpenCode uses `@opencode-ai/sdk`.

If a server is already running, the viewer tries these URLs in order:

- `OPENCODE_BASE_URL`
- `OPENCODE_SERVER_URL`
- `http://127.0.0.1:4096`

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

## Local Data

Agent Viewer stores local state in:

```text
.agent-viewer-data/
```

This directory is intentionally not part of source control. It is used for:

- selected provider state
- local title or tag metadata for providers that need viewer-side metadata
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

The command palette can also rebuild the index.

## Architecture

The main pieces are:

- `app/`: Next.js App Router pages and API routes.
- `components/`: browser UI components, including the sidebar, session list, message view, command palette, analytics popover, Git popover, and theme controls.
- `lib/sessionBackend.ts`: the central provider orchestration layer used by API routes.
- `lib/*Client.ts`: provider connection code for Codex, OpenCode, Copilot, and Pi.
- `lib/*Mapper.ts`: provider-to-view-model normalization.
- `lib/provider.ts`: provider capability definitions.
- `lib/sessionPersistence.ts`: SQLite-backed session/message index and search.
- `lib/tui/service.ts`: TUI-facing service wrapper over the same provider backend.
- `tui/opentui/`: current terminal UI.
- `tui/`: legacy Ink UI and shared TUI formatting/theme helpers.
- `bin/agent-viewer.mjs`: packaged CLI entrypoint.

Important implementation notes:

- Browser components should call API routes instead of importing provider SDKs directly.
- Provider SDKs and CLIs stay server-side because they use Node APIs such as filesystem access and process spawning.
- Session identity should include the provider, because session IDs can collide across providers.
- New provider work usually needs updates to provider types/capabilities, a client, a mapper, `sessionBackend.ts`, provider picker lists, and TUI provider lists.

## API Overview

Primary API routes:

```text
GET/PATCH /api/provider
GET       /api/sessions
POST      /api/sessions/project/messages
GET/PATCH/DELETE /api/sessions/[sessionId]
GET/POST  /api/sessions/[sessionId]/messages
GET       /api/sessions/[sessionId]/messages/events
POST      /api/sessions/[sessionId]/interrupt
POST      /api/sessions/[sessionId]/fork
POST      /api/sessions/[sessionId]/rewind
POST      /api/sessions/[sessionId]/actions
GET       /api/sessions/[sessionId]/models
GET       /api/sessions/[sessionId]/diagnostics
GET       /api/sessions/[sessionId]/subagents/[agentId]/messages
GET       /api/session-index/search
GET       /api/session-index/stats
POST      /api/session-index/rebuild
POST      /api/git
```

Most session routes accept a `provider` query parameter or body field. Use it whenever the active provider might be `all`.

## Scripts

```bash
npm run dev
npm run build
npm run start
npm run tui
npm run tui:dev
npm run tui:check
npm run tui:ink
npm run tui:ink:dev
```

Script details:

- `dev`: start the Next.js development server.
- `build`: create a production Next.js build.
- `start`: run the production Next.js server.
- `tui`: run the OpenTUI app with Bun.
- `tui:dev`: run the OpenTUI app with Bun watch mode.
- `tui:check`: type-check the OpenTUI TypeScript config.
- `tui:ink`: run the legacy Ink UI.
- `tui:ink:dev`: run the legacy Ink UI in Node watch mode.

## TUI Status

OpenTUI is the default terminal runtime. It supports provider selection, session navigation, transcript reading, tabs, search, folding, density and focus controls, theme selection, analytics, Git status, clipboard copy, refresh, and provider-backed sends where wired by the shared TUI service.

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

- Agent Viewer is intended for a single local developer environment, not hosted multi-user use.
- Some behavior is provider-specific because the underlying SDKs and CLIs expose different capabilities.
- Local viewer metadata can be deleted by removing `.agent-viewer-data/`; provider-owned session data remains in the provider's own storage.
