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
- A plugin can provide surfaces, server behavior and application observers
  together, or be headless.
- Provider SDK integrations use `lib/extensions/providers/`, a separate
  contract. Do not import provider runtimes into feature plugins.

Read [references/authoring.md](references/authoring.md) for source locations,
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
