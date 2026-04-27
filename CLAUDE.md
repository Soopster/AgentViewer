# CLAUDE.md

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

There is no test runner and no lint script. Type-checking is the verification step:

- Web/Next.js: `npx tsc --noEmit` (uses `tsconfig.json`)
- OpenTUI: `npm run tui:check` (uses `tsconfig.opentui.json` with `jsxImportSource: "@opentui/react"`)
- Legacy Ink TUI: `tsconfig.tui.json` covers `tui/**` + `lib/**`

`bin/agent-viewer.mjs` is the published `npx agent-viewer` entrypoint — it dispatches to OpenTUI (default), `web` (Next.js), or `--legacy` (Ink). Adding flags or modes belongs here.

## Architecture

### Multi-provider session backend

The app is a unified UI over five separate agent runtimes: **Claude** (`@anthropic-ai/claude-agent-sdk`), **Codex** (app-server), **OpenCode** (`@opencode-ai/sdk`), **GitHub Copilot** (`@github/copilot-sdk`), and **Pi** (`@mariozechner/pi-coding-agent`). Do not re-introduce direct JSONL parsing — providers are accessed only through their SDKs.

Each provider follows the same pattern in `lib/`:

- `<provider>Client.ts` — SDK wiring, server-singleton client, session listing/resume
- `<provider>Mapper.ts` — translates provider-native events into the shared `SessionMessage` shape
- `<provider>Tags.ts` / `<provider>Metadata.ts` — local-only tag/title overrides for providers that can't mutate their own metadata (stored under `.agent-viewer-data/`)

`lib/sessionBackend.ts` is the unified facade: it reads the active provider from `lib/providerState.ts` and delegates to the correct client/mapper. `lib/provider.ts` declares per-provider `SessionCapabilities` (which controls reflect in the UI: fork, rewind, rollback, delete, share, summarize, etc.). When adding a provider, wire it through both files plus `isAgentProvider`.

`lib/types.ts` defines the canonical wire format. Every provider must produce `SessionMessage { type, uuid, session_id, message: ApiMessage|SystemMessagePayload, parent_tool_use_id, timestamp?, origin?, provider? }`. `lib/threading.ts` `buildThreadedMessages()` then groups tool_use/tool_result pairs and parses XML tags into the renderer-ready blocks consumed by `MessageItem.tsx` and the TUI formatters.

### Web app (Next.js 16, React 19)

Routes live under `app/api/`:

- `provider/route.ts` — GET/POST active provider
- `sessions/route.ts` — list for active provider; `sessions/project/messages/route.ts` for cross-session project feed
- `sessions/[sessionId]/{route,messages,diagnostics,fork,interrupt,models,rewind,actions}/route.ts` — per-session reads + control actions
- `git/route.ts`

`proxy.ts` (Next 16's middleware replacement, lives at project root) blocks cross-origin mutation requests against `/api/*` to prevent drive-by CSRF — keep it.

`next.config.ts` marks Claude/Pi SDKs as `serverExternalPackages` because they rely on Node APIs and cannot be bundled. Do not import them from client components.

The page (`app/page.tsx`) drives polling: sessions list every 5s, active-session messages every 2s with an `offset` param for incremental delta. `MessageView.tsx` uses a custom absolute-positioning virtual scroll (`ResizeObserver` per-row + RAF batching), not `react-window`.

### Theming

Five themes (`dark`, `light`, `terminal`, `iMessage`, `paper`) applied as `data-theme` on `<html>`; CSS vars in `app/globals.css`. Theme is restored before first paint by an inline script in `layout.tsx`. Tool colors use semantic CSS vars (`--t-bash`, `--t-edit`, …). Code-block syntax theme is independent, controlled via `CodeThemeContext`.

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

### Local data

`.agent-viewer-data/` (gitignored) stores per-provider local-only state: tags, title overrides, selected provider. Do not commit it; do not expect it to exist on first run.

### Stack notes

- Tailwind v4 + shadcn UI (`components/ui/`); `components.json` is the registry config — use `npx shadcn add <component>` rather than hand-writing.
- React 19 with View Transitions (`experimental.viewTransition: true` in `next.config.ts`).
- Fonts: Oxanium (display), IBM Plex Sans (body), IBM Plex Mono (code).
- TypeScript path alias: `@/*` → repo root.

## Working with the large files

A handful of files dominate the codebase. **Don't `Read` these without `offset`/`limit`** — `Grep` for the symbol first to find a line number, then read a 100–200 line window around it.

| File | Lines | What lives there |
|---|---:|---|
| `tui/opentui/App.tsx` | ~4600 | OpenTUI root; entire reader, composer, key handling, `cardDisplayData` memo, scrollbox layout |
| `components/MessageView.tsx` | ~3700 | Web virtual-scroll timeline, top bar, session controls, `VirtualTimelineRow`, `handleTimelineRowMeasure` |
| `components/MessageItem.tsx` | ~3300 | Renderer for every threaded block — all tool cards (bash/edit/read/grep/glob/agent/etc.) live here |
| `tui/App.tsx` | ~2400 | Legacy Ink TUI root |
| `lib/sessionBackend.ts` | ~2200 | Per-provider switch for every backend op (list/get/messages/diagnostics/fork/rewind/models/send) |
| `components/SessionList.tsx` | ~1900 | Sidebar: project grouping, search, tag filters, collapsible groups |
| `components/GitPopover.tsx` | ~1400 | Git diff/branch popover |
| `components/AnalyticsPopover.tsx` | ~1300 | Recharts analytics |
| `app/globals.css` | ~1000 | All five themes' CSS vars + base styles |
| `tui/format.ts` | ~880 | `formatTranscriptCards` / `formatMessageExpanded` (shared by both TUIs) |
| `tui/theme.ts` | ~850 | LIGHT/DARK/CYBER palettes + `getProviderAccent` |

Recommended access patterns:

- Tool card rendering for tool `X` → `Grep "X" components/MessageItem.tsx` then read the matched range.
- Provider X behavior in the backend → `Grep "provider === 'X'" lib/sessionBackend.ts` to jump to the relevant branch.
- A theme variable → `Grep "--<var>" app/globals.css`; each theme block is contiguous.
- OpenTUI key handling, scrollbox, or memos → `Grep` for the keyword in `tui/opentui/App.tsx` (`useKeyboard`, `cardDisplayData`, `scrollbox`, `followTail`, `setSessionDetail`).
- `Explore` agent is worth it for cross-file searches that would otherwise need 3+ Greps; for a single known symbol, just Grep directly.

Also: never `Read` `package-lock.json` (~573 KB) or `bun.lock` (~248 KB) directly — `grep` them for the package name instead.
