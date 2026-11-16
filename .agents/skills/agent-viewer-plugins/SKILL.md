---
name: agent-viewer-plugins
description: Add or customize Agent Viewer functionality through feature plugins, local mods, shared behavior hooks, widgets and Web/OpenTUI plugin surfaces. Use when extending the Agent Viewer app, writing a mod in the user's plugin directory, or migrating built-in features into its base-shell plugin architecture.
---

# Agent Viewer plugins

Build app functionality as a plugin. Keep Web and OpenTUI aligned on manifest,
identity, enablement and domain behavior; supply separate renderer adapters.
Two kinds of plugin exist. **Bundled plugins** live in `plugins/<id>/` of an
Agent Viewer checkout and are reached through static loader lists; they can
contribute anything below. **Local plugins (mods)** live in the user's own
config directory (`$AGENT_VIEWER_PLUGINS_DIR`, else
`~/.config/agent-viewer/plugins/<id>/`) and need no build: a `plugin.json` plus
a server module contributing behavior hooks and commands. A mod is never read
from a project or workspace directory. For a user who wants to change how the
app behaves on their machine, write a mod; for a feature of the app, write a
bundled plugin in the checkout.

## Design plugin surfaces

For new or redesigned Web/OpenTUI UI, read
[references/design-guidelines.md](references/design-guidelines.md). It covers
Agent Viewer's workspace metaphors, pane and tab hierarchy, contextual actions,
responsive navigation, theme usage and bounded help. Keep behavior and terminology
aligned across renderers while using their native controls.

## Choose the contribution

- For a feature UI, declare a surface with overlay, window and/or panel
  placements, plus commands that open it. Use declared host services to
  customize the composer, navigate, open files or operate on the target session.
- For a Web dashboard page, declare `dashboards` metadata and an application
  command with `webDashboard`. The shell supplies its tab, launcher and page
  host; no dashboard ID union or root callback needs editing.
- For a Web reader rail, declare `reader` metadata, a panel surface and
  `webReader` commands. Use the optional `reader-slot` service for visibility
  and badge reports; the host owns width and transcript layout.
- For an action without a view, declare an executable command with a handler,
  explicit scope and required command services. Use the shared command host for
  target capture and cancellation.
- For changing what is sent to an agent, use the server `beforeTurn` behavior
  hook. It applies to both apps through the shared send path. It can patch the
  request or block it with a reason; no feature branch belongs in either root.
- For reacting when a turn finishes (logging, auto-continuing, chaining work),
  use the `afterTurn` hook. It runs off the runtime's turn-settled event for
  every provider, can read the transcript, and can ask for one follow-up turn.
- For persistent UI that is not opened by a command (a status badge, progress
  in a corner), declare a `widgets` entry for a shell slot.
- For a ⌃K shortcut, give the command a `tuiChord`; the chord table, hint and
  help overlay pick it up. To show a session at a message, use the
  `session-navigation` service rather than any selection callback.
- For inline composer controls or a composer-owned modal, declare a composer
  accessory. Share its contract across Web and OpenTUI; keep its state, reads and
  native keys in the plugin. Use the scoped send capability.
- For behavior that runs without an open view, declare an application observer.
  Web and TUI share the observer contract and event identity; notification sinks
  and settings remain platform adapters.
- For local mods that need live app context, declare `appServices: ["data"]`.
  Server views/actions/widgets/commands receive an immutable app snapshot;
  components receive `app.getSnapshot()` and `app.subscribe()`. Use the host's
  qualified session identities and activity rather than polling providers.
- For local mod UI navigation, add `"navigation"` to `appServices`. Components
  use `app.openSession`, `app.openFile` and `app.commands.list/run`; server
  code returns `appEffects` for the originating renderer. Command access is
  limited to supported surface-opening commands, not arbitrary handlers or
  new send/interrupt operations. Preserve cancellation and captured targets.
- For a colour scheme, declare `themes` (Web CSS variables and/or a terminal
  palette); it is data, so a mod can ship it with no server module. Read the
  `agent-viewer-themes` skill. Plugins that only add themes appear under
  **Themes** in the plugin managers; any plugin may set `group` to choose its
  heading.
- To advertise a key in the terminal's status bar, declare `hints` for the pane
  it applies to; to list a repository command in a session's context menu, set
  `sessionMenu: true` on it.
- For a terminal transcript preset, declare `transcriptViews` (a built-in `base`
  plus ViewSpec overrides); they show read-only beside the user's own views.
- To recognise something in message text and draw it as a card on every
  renderer, declare `blocks` (a bounded regex plus a title and lines with
  `{0}`/`{1}` placeholders), or register a `BlockRegionParser` from bundled code.
  A block is a `plugin_block`, drawn from card data by Web, terminal and HTML
  export; a faulty parser contributes nothing.
- To draw a tool call yourself: Web `registerToolCard(names, Component)` from
  `components/shell/sdk` (newest wins, unregistering restores the native card);
  terminal `registerTuiToolFormatter(names, { preview, expanded })`
  (`tui/format/registry.ts`, null defers to the built-ins); HTML export
  `registerExportToolCard` (`lib/exportRegistry.ts`). A mod's own tools use
  `toolCard` hooks and card templates instead.
- To place a surface in the side panel, windows and launcher, give the surface
  `windowTitle`, `shortcut`, `summary`, `multiWindow` and `fullScreen` metadata;
  the host keeps no hand-written table of kinds.
- A plugin can provide surfaces, server behavior and application observers
  together, or be headless.
- To add an agent backend without touching the checkout, write a provider
  mod (a mod with a `provider` export). Full SDK integrations use
  `lib/extensions/providers/` (`npm run providers:scaffold`), a separate
  contract. Do not import provider runtimes into feature plugins.

Read [references/extension-points.md](references/extension-points.md) for the
registries above (contracts, limits, which isolates need which installer). Read
[references/authoring.md](references/authoring.md) for source locations,
registration, concrete examples, lifecycle and verification. Treat the installed
source types as authoritative when the API changes.

## Preserve the shell boundary

The shell owns session/provider-instance identity, runtime lifetimes, layout,
focus, dispatch and transcript measurement. A plugin owns feature state,
presentation and behavior. New functionality should use plugin contributions
instead of adding root imports, feature booleans, key-routing cases or palette
callbacks. If a required capability is missing, add a narrow typed host service
or shared contribution point, then implement the feature through it in both
apps. Do not pass the root state object or arbitrary setters into a plugin.

Manifests are metadata only. Lazy entries perform no work at import time.
Capture immutable targets before asynchronous work, including provider instance
identity; never reconstruct session keys or read the current selection after an
await. Use host-scoped state and resource scopes. Hiding or disabling a view
must not terminate user-owned processes or agent runs.

## Deliver a usable customization

Retain existing command and surface IDs when migrating built-ins so shortcuts
and saved layouts survive. Remove the old feature path once its callers use
the plugin. Exercise adding the feature without root edits, disabling and
re-enabling it, switching targets during async work, and moving its view between
placements. Verify both application typechecks and relevant plugin smokes.
Report which renderer interactions were actually exercised; typechecks alone
do not prove focus, keyboard or layout behavior.

## Check and inspect local mods

Run `agent-viewer mods check <path> --json` after changing a mod. This parses
manifests, checks entries/source syntax and reports renderer availability
without importing the mod. For trusted code, also run
`agent-viewer mods check <path> --render --json`: bounded child processes check
exports and initial data/widget/component rendering. Import side effects do
execute; this is not a sandbox or proof of later asynchronous UI behavior.
Checks require Bun. Exercise the real app before claiming focus/layout parity.

Use `agent-viewer app status --json` to inspect published Web/OpenTUI instances
and `agent-viewer mods status --instance <id> --json` for mod enablement,
refusals and recent failures. Each browser tab and TUI process has its own ID;
select one explicitly when several exist. Snapshots heartbeat every five
seconds and become stale after fifteen; unknown focus is null. Inspection does
not run mods, load providers or resume sessions. The plugin managers show the
same bounded diagnostics.

For this host contract, run `npm run mods:smoke` and
`node scripts/webModAppBrowserSmoke.mjs` alongside relevant plugin smokes and
both typechecks. Full API details and a worked example live in
`docs/mod-app-services.md` and `docs/examples/mods/live-sessions/` in a checkout.

## Mod SDK and configuration

Use `agent-viewer mods create <id> [--path <new-directory>]` for scaffolding and
`agent-viewer mods test <path>` for author fixtures. Declare `config` for validated
server values and generated settings surfaces in both renderers. Portable views
also support input/select/progress/table/code. Read
[references/mod-sdk.md](references/mod-sdk.md) for contracts, limits and checks.

## Extended mod framework

Read the installed references before extending these contracts:

- [Contribution placements and widget slots](references/mod-contributions.md)
- [Runtime observations and provider capabilities](references/mod-runtime-events.md)
- [Permission policy composition and receipts](references/mod-permissions.md)
- [Explicit reload and source snapshots](references/mod-reload.md)
- [Pinned local package distribution](references/mod-distribution.md)

Do not claim universal tool interception or organization-managed policy enforcement.
Package operations do not execute mod code; runtime snapshots do. Preserve qualified
identities and do not interrupt user-owned turns/processes when reloading.
