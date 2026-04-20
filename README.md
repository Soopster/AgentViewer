# Agent Viewer

Agent Viewer is a Next.js dashboard for browsing and inspecting local agent conversations across multiple providers:

- Claude Agent SDK
- Codex CLI
- OpenCode
- GitHub Copilot

It provides a single UI for session browsing, project-level views, message inspection, model/provider switching, tagging, rewind or rollback controls, and diagnostics.

## Features

- Browse sessions by provider or across all providers
- Group conversations by project
- View single-session timelines or consolidated project timelines
- Rename sessions and manage tags
- Stream live replies in the message view
- Switch between five UI themes; choice persists across sessions
- Fork sessions and provider-native continuation controls
- Rewind or rollback where supported by the underlying provider
- Inspect provider diagnostics and available models

## Requirements

- Node.js 20+
- npm
- Bun for the OpenTUI terminal UI on the `opentui-migration` branch
- At least one supported provider installed and usable locally

## Providers

### Claude

Uses `@anthropic-ai/claude-agent-sdk` on the server side.

### Codex

Uses the official Codex app-server integration. The viewer can connect to the configured local Codex environment through the backend adapter.

### OpenCode

Uses `@opencode-ai/sdk`.

If you already run an OpenCode server, the app can reuse it through:

- `OPENCODE_BASE_URL`
- `OPENCODE_SERVER_URL`

If not, the backend will attempt managed startup where supported.

### GitHub Copilot

Uses the official `@github/copilot-sdk`.

The Copilot provider expects a working local Copilot CLI environment. The viewer uses the SDK for:

- session listing
- session resume/history
- live streaming sends
- models
- diagnostics

Local title and tag edits for Copilot are stored in `.agent-viewer-data/` because the viewer does not mutate Copilot session metadata on disk.

Optional environment variables:

- `COPILOT_CLI_URL` to connect to an existing Copilot SDK server
- `COPILOT_CLI_PATH` to point at a specific Copilot CLI binary

## Getting Started

Install dependencies:

```bash
npm install
```

Run the development server:

```bash
npm run dev
```

Then open `http://localhost:3000`.

Run the terminal app directly with `npx`:

```bash
npx agent-viewer
```

This launches the OpenTUI entrypoint in `tui/opentui/main.tsx` and requires Bun
to be available on `PATH`.

On Windows, `agent-viewer` also works when Bun is exposed as a PowerShell shim
such as `bun.ps1`, not only as `bun.exe`.

If that still fails, open a fresh terminal session so the updated PATH is
visible, and confirm PowerShell can run the shim directly.

Run the web app instead:

```bash
npx agent-viewer web
```

This starts the Next.js dev server for the browser UI.

You can choose a different port:

```bash
npx agent-viewer web --port 3001
```

If you want the legacy Ink terminal UI:

```bash
npx agent-viewer --legacy
```

## How To Use

1. Select a provider from the sidebar dropdown.
2. Choose a session, or click a project group to view a consolidated project timeline.
3. Use search and tag filters in the sidebar to narrow sessions.
4. In the message view, use provider-specific controls such as fork, diagnostics, rewind, or rollback.

## Theming

The theme picker is in the top-left corner of the sidebar. Themes are grouped into dark and light categories:

| Theme | Description |
|-------|-------------|
| ☾ Dark | Deep navy dark mode (default) |
| ☀ Light | Clean light mode |
| ⌨ Terminal | Green-on-black terminal aesthetic |
| ✦ Paper | Soft off-white Material-inspired light theme |
| 💬 iMessage | iOS-style blue/grey message bubbles |

The selection is stored in `localStorage` and restored automatically on reload. The theme is applied via a `data-theme` attribute on `<html>`, so all CSS custom properties update instantly without a page reload.

Code blocks in the message view have a separate syntax-highlighting theme picker accessible from the message view toolbar.

## Local Data

The app stores local UI/provider metadata in:

```text
.agent-viewer-data/
```

This directory is intentionally ignored from git. It is used for state such as:

- selected provider
- locally stored tags or title overrides for providers that do not support native metadata edits

## Scripts

```bash
npm run dev
npm run build
npm run start
npm run tui
```

## TUI Preview

The terminal UI is being migrated from Ink to OpenTUI on the `opentui-migration` branch.

Primary runtime on this branch:

```bash
bun run tui
```

Legacy Ink runtime during migration:

```bash
npm run tui:ink
```

The OpenTUI reader on this branch is the primary terminal UI and ports the Ink reader onto the existing TUI service layer.

- Browse providers
- Navigate sessions
- Read full long-form transcripts with keyboard navigation, search, folding, and live-follow controls
- Refresh from the terminal without going through the browser
- Keep the previous Ink implementation available while the remaining non-reader TUI surfaces are migrated

Current limitations:

- send/streaming is not wired yet
- project timeline mode is not in the TUI yet
- diagnostics, models, rename, tag, fork, and rewind/rollback controls are still web-only

## Notes

- This project is intended for local use against local agent runtimes.
- Some features are provider-specific because the underlying SDKs differ.
- If Next.js behaves oddly after branch changes, clear `.next/` and rebuild.
