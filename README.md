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

## How To Use

1. Select a provider from the sidebar dropdown.
2. Choose a session, or click a project group to view a consolidated project timeline.
3. Use search and tag filters in the sidebar to narrow sessions.
4. In the message view, use provider-specific controls such as fork, diagnostics, rewind, or rollback.

## Theming

The theme picker is in the top-left corner of the sidebar. Five themes are available:

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

An Ink-based terminal UI is now scaffolded as an early read-only preview.

- Browse providers
- Navigate sessions
- Inspect recent transcript output
- Refresh from the terminal without going through the browser

Current limitations:

- send/streaming is not wired yet
- project timeline mode is not in the TUI yet
- diagnostics, models, rename, tag, fork, and rewind/rollback controls are still web-only

## Notes

- This project is intended for local use against local agent runtimes.
- Some features are provider-specific because the underlying SDKs differ.
- If Next.js behaves oddly after branch changes, clear `.next/` and rebuild.
