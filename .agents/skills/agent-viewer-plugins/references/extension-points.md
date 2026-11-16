# Registries and data contributions

These are the contribution points that replaced hand-kept tables in the host.
Each one is data in a manifest, or a registration that returns an unregister
function; a later registration for a key wins and unregistering restores the
previous one. Keep a registration's lifetime tied to the plugin being enabled.

## Data in the manifest (mods may use all of these; no server module needed)

A mod that declares only `themes`, `transcriptViews` and/or `blocks` has nothing
to run, so `plugin.json` needs no `server.mjs` (`localManifestNeedsServer`).

| Field | What it is | Where it is applied |
|---|---|---|
| `themes[]` | `{ id, label, category, icon?, css?, rules?, tui? }` | `lib/plugins/themeContributions.ts` (Web), `tui/opentui/shell/pluginThemes.ts` (TUI) |
| `transcriptViews[]` | `{ id, name, base, overrides }` | `tui/opentui/shell/pluginTranscriptViews.ts` → `tui/viewSpec.ts` |
| `blocks[]` | `{ kind, pattern, flags?, title, lines?, tone? }` | `lib/plugins/blockContributions*.ts` → `lib/blockRegistry.ts` |
| `group` | plugin-manager heading | `lib/plugins/managerCategories.ts` |
| `hints[]` | `{ context: rail \| transcript \| composer, key, label, order? }` — a key hint in the terminal status bar | `lib/plugins/footerHints.ts` → `tui/opentui/app/derived/footer.ts` |

- **Themes**: see the `agent-viewer-themes` skill. `css` is bare declarations
  (a mod's is refused if it has `{ } < > @`, backslashes or `url(`); `rules` is
  bundled-only; ids from a mod are prefixed `<mod>-`. Menus sort by label.
- **Transcript views**: `base` must be a built-in view other than `engineering`;
  ids appear as `<plugin>.<id>`; unknown fields and values are dropped.
- **Blocks**: `pattern` is at most 200 characters, flags only `i m s u`, no
  nested quantifiers, text over 200,000 characters is skipped, at most 50
  matches per text. The card (`title`, `lines`, `tone`) is the same data a tool
  card uses, so every renderer draws it. Parsers are registered where threading
  runs: the Web page and TUI process through `installPluginBlocks()`
  (`blockContributionsHost.ts`, uses the catalog) and the TUI transcript worker
  through `installLocalPluginBlocks()` (mods only; the worker holds no catalog,
  so a bundled plugin's blocks need a bundled-code registration there).
  Threaded-transcript caches are not invalidated when a parser changes; a
  parser change takes effect for transcripts read afterwards.

- **Hints** advertise a key the plugin already handles (a `tuiKey`, a ⌃K chord, a
  surface's own keys); they bind nothing. They sit after the host's groups, so a
  narrow bar drops them first. Key at most 8 characters, label at most 24.
  Terminal only: the Web has no status bar.
- **Session menu**: every session-scoped command is offered in the terminal's
  session context menu; a repository-scoped command joins it with
  `sessionMenu: true` (shown when the session has a folder). The Web's rail
  menu does not list plugin commands yet.

## Registrations (bundled code)

| Registry | Register | Notes |
|---|---|---|
| Web tool cards | `registerToolCard(names \| predicate, Component)` from `components/shell/sdk` (`components/message-view/toolCardRegistry.ts`) | exact names outrank predicates; the host's native cards register the same way; cards already on screen update on their next render |
| Terminal tool formatters | `registerTuiToolFormatter(names, { preview?, expanded? })` (`tui/format/registry.ts`) | return `{ text, tone }` lines; `null` (or a throw) defers to the next, then to the built-in formatting; the OpenTUI worker is a separate isolate, so register where `tui/format.ts` runs |
| HTML export | `registerExportToolCard(names, render)`, `registerExportBlock(types, render)` (`lib/exportRegistry.ts`) | `render` returns HTML; escape everything |
| Block parsers | `registerBlockParser({ id, find(text) })` (`lib/blockRegistry.ts`) | `find` must be pure and cheap: it runs on every text block of every transcript read; bad regions are discarded |

## Metadata the host reads instead of listing

- **Surfaces** (`PluginSurfaceSpec`): `windowTitle` (glyph + short name for tabs,
  windows and the launcher; defaults to `title`), `shortcut` (launcher letter),
  `summary` (launcher card line), `multiWindow` (several windows at once),
  `fullScreen` (also a full-screen popover). Pinned by
  `scripts/surfaceMetadataSmoke.ts`.
- **Providers** (`ProviderManifest`): `coordinatorTeammate: true` lets a provider
  be staffed as a Coordinator teammate and named in rules and playbooks
  (`COORDINATOR_PROVIDER_IDS`, `isCoordinatorProvider`). `LEGACY_SESSION_PROVIDER`
  is the one place the "session with no provider is Claude's" assumption lives.

## Verify

`bun run scripts/themeRegistrySmoke.ts`, `surfaceMetadataSmoke.ts`,
`toolCardRegistrySmoke.ts`, `blockRegistrySmoke.ts`; for a mod,
`agent-viewer mods check <path> --json`. Smokes prove the registries and the
data paths; look at the real Web and terminal transcripts before claiming a card
or block looks right.
