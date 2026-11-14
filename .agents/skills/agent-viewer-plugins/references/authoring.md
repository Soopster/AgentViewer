# Authoring against the installed host

Resolve these paths relative to the Agent Viewer checkout, not to the invoking
agent's project. Start with `lib/plugins/types.ts`, `lib/plugins/behavior.ts`,
`components/shell/pluginTypes.ts` and `tui/opentui/shell/pluginTypes.ts`.

## Metadata and registration

Place metadata in `plugins/<id>/manifest.ts`. Import only
`lib/plugins/types` from a manifest. Use `as const satisfies PluginManifest`,
`PLUGIN_API_VERSION`, stable IDs and a `stateVersion`. Declare supported
renderers, required/optional services and each surface's placements, pin,
multiplicity and keyboard mode. Required services refuse activation if absent;
optional services need a working fallback. Check the renderer's service list:
being in the shared service union does not mean both hosts supply it.

Add the manifest to `lib/plugins/catalog.ts`. Add static lazy entries only for
the contributions provided:

| Contribution | Registration | Export |
| --- | --- | --- |
| Web surface | `components/shell/pluginViews.ts` | `module: PluginViewModule<WebPluginView>` |
| OpenTUI surface | `tui/opentui/shell/pluginViews.ts` | `module: PluginViewModule<TuiPluginView>` |
| Executable command | `components/shell/pluginCommands.ts` and `tui/opentui/shell/pluginCommands.ts` | `commands: PluginCommandModule` |
| Composer accessory | `components/shell/composerPlugins.ts` and `tui/opentui/shell/composerPlugins.ts` | `composer: PluginComposerModule<ComponentType<Props>>` |
| Application observer | `components/shell/applicationPlugins.ts` and `tui/opentui/shell/applicationPlugins.ts` | `application: PluginApplicationModule` |
| Shared server behavior | `lib/plugins/serverBehaviors.ts` | `behavior: PluginBehaviorModule` |

Headless plugins use empty `surfaces`; they can still provide executable
commands and application observers. No renderer view loader is needed. Metadata, commands, manager entries and panel kinds come from the
catalog. Do not add a new kind union or root rendering switch for a surface.
For a composer action, set `webComposerLabel` and optionally
`webComposerGlyph` on its command. The Web composer derives enabled buttons
from this metadata; no root JSX or callback is needed. Prompt library is the
complete example in `plugins/prompt-library/` for both renderers.

A command declares either `opens` for a surface or `handler` for an executable
action. Do not mix placements and executable handlers in one command.

## Surfaces

Use `plugins/analytics/{manifest.ts,web/index.tsx,tui/index.tsx}` for a minimal
real example and `plugins/git/` for richer mutation/service use. Put domain
logic in renderer-independent modules; keep native terminal and DOM imports
in their respective adapters. Web entries start with `'use client'`; OpenTUI
entries use `/** @jsxImportSource @opentui/react */`. Read the installed Next
guides under `node_modules/next/dist/docs/` before changing Web code.

Surface props supply `target`, `services`, named scoped `useState`, cleanup and
close operations. OpenTUI additionally supplies theme, dimensions, focus,
visibility, key registration and capture controls. Read the current types for
exact signatures. Service values are renderer-specific adapters over the same
capabilities; do not copy host implementation code to make them look identical.

For composer customization, declare `composer` and call its insertion/context
methods. For file navigation, use `open-file`; for cross-feature actions use
the host's command dispatcher rather than importing another plugin's internals.
The host owns window chrome, focus and stacking. A docked view must not draw
another outer frame or install global keyboard listeners. Register keys with
the host and gate input by visibility and focus. Use BMP-safe terminal glyphs.

State belongs to the view/workspace owner, not just its pinned session.
Use the supplied named `useState` hook for relocation state. Existing state
codecs are versioned; do not claim automatic durable disk persistence unless
the host actually wires it. Keep callbacks, workers and native handles out of
serializable state.

## Executable commands

Read `lib/plugins/commands.ts` and the real headless plugin
`plugins/composer-tools/{manifest.ts,commands.ts}`. A command declares `handler`,
`scope: 'session' | 'repository' | 'application'`, `requires` and its command
`services`, instead of `opens`. Register its `PluginCommandModule` only in the
renderer command loader lists. The same pure implementation can serve both
apps; renderer-specific code belongs in separate entries. Commands appear in
palettes and bind through the existing host dispatcher without new root cases.

Action services differ from view services. Session hosts currently provide:

- `transcript.read(signal)` for the captured source session;
- `composer.replaceText(text)` and `composer.insertText(text)` for the writing
  destination captured at invocation;
- `composer-accessories.open(id)` to request a declared inline accessory/modal;
- `notices.show(kind, text)` for user-visible results.

Application/repository hosts supply notices and immutable target context.
Request only capabilities available in that scope. Missing services refuse
before executable code loads. Targets expose session/provider-instance identity
and repository cwd; do not assume they contain the full session object. A
source pane and writing destination may differ: the host binds both before any
await. Never look up a later current selection to finish an action.

Pass the supplied signal to reads/jobs and register cleanup with `defer`.
Each invocation owns a separate scope. Disabling, unmounting, changing the
writing owner, or finishing the action ends its capability lifetime. Retained
write callbacks become inert; cancelling does not undo effects already applied.
Await work that belongs to the action. Use an application observer for ongoing
background behavior rather than returning while detached jobs retain command
capabilities. Errors stay local to the command's calling shell.

For TUI shortcuts which must not steal typed characters, set
`tuiKeyContext: 'navigation'`; Reuse last prompt retains its ⇧R navigation
binding while an active composer receives a typed R normally.

Run `bun scripts/pluginCommandSmoke.ts`. The browser command smoke renders the
real MessageView in StrictMode and defers a command import across account
navigation; the TUI plugin suite verifies the real app shortcut and input
precedence. `npm run plugins:contributor:smoke` now adds both a panel and a
headless action in an isolated copy without changing either root.

## Shared behavior

The real example is `plugins/composer-context/`. A behavior manifest declares
`behavior: { hooks: ['beforeTurn'], order: 100 }`. Lower order runs first;
equal order is resolved by plugin ID. Both Web and TUI run this pipeline before
inbox reopening, checkpoint creation or provider SDK loading.

```ts
import { PLUGIN_API_VERSION } from '../../../lib/plugins/types'
import type { PluginBehaviorModule } from '../../../lib/plugins/behavior'

export const behavior: PluginBehaviorModule = {
  apiVersion: PLUGIN_API_VERSION,
  pluginId: 'review-policy',
  beforeTurn({ body, target, signal }) {
    signal.throwIfAborted()
    if (body.message === '/review-policy') {
      return { action: 'patch', body: {
        message: 'Review the current diff. Explain correctness risks first.',
      } }
    }
  },
}
```

Return nothing to leave the request unchanged, `{ action: 'patch', body: ... }`
to shallow-merge request fields, or `{ action: 'block', reason: ... }` to refuse
submission visibly. Each hook receives a private request copy and an immutable
provider/instance/session target. No hook can redirect the host target. Hooks
run sequentially and see previous patches. An unexpected failure stops the
send; the host must not silently submit a partially transformed prompt.

Pass `signal` to asynchronous operations. Cancellation or disabling a plugin
while its hook is pending prevents its result from being submitted. Disabling
affects future submissions, not already running provider turns. Keep prompt
transformation logic independent of provider SDKs. This hook does not currently
intercept mid-turn steering, provider tool execution, or transcript rendering;
extend the shared contract explicitly for those requirements.

### afterTurn

Declare `behavior: { hooks: ['afterTurn'] }` (or both hooks) and export an
`afterTurn` function. It runs about two seconds after a turn leaves the running
registry (transcript writes land just after), for any provider and any surface,
unless another turn has started meanwhile.

```ts
afterTurn: async ({ target, readMessages, followUps, signal }) => {
  const [last] = await readMessages(1)
  if (followUps < 3 && String(last?.message?.content).includes('TODO')) {
    return { action: 'follow-up', message: 'Finish the TODOs you left.' }
  }
}
```

Every enabled hook runs in order; one hook's failure is logged and the others
still run. The first valid follow-up wins and is sent through the ordinary send
path, so every `beforeTurn` hook sees it. `followUps` counts plugin follow-ups
since the user last sent a turn; the host stops at 25 (`PLUGIN_FOLLOW_UP_LIMIT`)
whatever a plugin asks. Disabling a plugin aborts its `signal`.

## Application observers

For app behavior that must run with no view open, declare
`application: { events: ['sessionActivity'], services: ['notifications'] }` in
the manifest. Register separate static lazy entries in
`components/shell/applicationPlugins.ts` and
`tui/opentui/shell/applicationPlugins.ts`. Each exports
`application: PluginApplicationModule`; the contract is
`lib/plugins/application.ts`. `plugins/session-alerts/` is the real example.

`activate({ signal, services, defer })` creates an observer per host and returns
`onSessionActivity(snapshot)`. The callback is synchronous; use the activation
signal and `defer(cleanup)` to own any asynchronous jobs or subscriptions.
Snapshot identities include provider instances and are supplied by the host.
Do not reconstruct them from native session IDs. Notifications are capability
sinks, not permission requests; requesting browser permission belongs to an
explicit user action in the settings view.

Each observer gets a private snapshot. Pending imports retain only the newest
snapshot, so this is an observation API, not a lossless event log. Loading the
observer must not load its settings view. Enabled observers activate on the
first relevant snapshot even when no surface is open. They may own background
behavior; hiding a view does not end their lifetime. Disabling aborts their
scope, suppresses late notification calls and invalidates pending activation.
A fresh activation baselines fresh state without replaying disabled activity.
Failures stay local and are retried on a later publication.

For a Web app-wide settings view, declare `scope: 'application'` on its command.
The application host dispatches it without a page callback or selected session.
Keep per-session commands in their session/composer host and repository
commands in their repository host.

Run `bun scripts/pluginApplicationSmoke.ts` for lifecycle, capability, failure,
coalescing and provider-instance checks. `npm run plugins:web:smoke` includes
the browser observer adapter; the plugin suite includes a real TUI App alert
without opening its settings view. Browser desktop delivery uses a mocked
notification sink, so do not claim native OS delivery has been tested.

## Resources and boundaries

Use `createPluginResourceScope(pluginId)` from `lib/plugins/lifecycle` (or the
TUI SDK) when owning requests, workers or subscriptions. Register cleanups with
`scope.defer`, pass `scope.signal`, and dispose on early unmount. Use per-turn
signals for work that must stop with one send, rather than aborting every view
of the plugin. A loaded module may expose an idempotent `deactivate` for caches.
Do not allocate at module evaluation time. Hidden presentation stops its own
timers/subscriptions; running shells and agents retain their service lifetimes.

Do not import app roots, another plugin's internals, provider SDKs or
`sessionBackend` from plugins. TUI UI reaches host UI through
`tui/opentui/shell/sdk*`; Web UI through `components/shell/` or shared UI.
Server behavior entries are loaded only by their server registration list.

## Verification

Run from the checkout:

```sh
npx tsc --noEmit
npm run tui:check
npm run plugins:smoke
```

For a new surface, `npm run plugins:contributor:smoke` demonstrates that a
fixture adds only its package, manifest and loaders and compiles both apps.
For the real Prompt library migration, `npm run plugins:web:smoke` exercises
the browser host, while the plugin suite exercises the real TUI App.
For behavior changes, run `bun scripts/pluginBehaviorSmoke.ts` and the relevant
send/composer smoke. Exercise hook order, block, failure, cancellation,
disable/re-enable and simultaneous turns with duplicate native session IDs in
different provider instances. Exercise actual Web/OpenTUI interactions before
claiming visual, focus or keyboard parity. Run `git diff --check`.

## Composer accessories

Use `plugins/goals/` as the working Web/OpenTUI example. Read
`lib/plugins/composer.ts` and `composerHost.ts`. Add metadata such as:

```ts
composer: [{ id: 'feature-status', title: 'Feature status', maxRows: 1, services: ['composer'] }]
```

The `composer` module exports an `accessories` map keyed by the declared ID.
Both apps supply the same `ComposerAccessoryProps`; native adapters also receive
theme, inline width, viewport dimensions and modal stacking. No root rendering
branch is needed. Executable commands can request the accessory through the
`composer-accessories` command service.

Call `report({ rows, modal, summary })` when presentation changes. Each accessory
is capped at its declared 1–4 terminal rows; the shell subtracts visible rows
from the reader, preserving the composer input size. Native modal handlers use
`registerKeys`, return `true` for handled keys and `'input'` to leave typing to
the focused field. Keep DOM and terminal rendering in separate adapters.

Props contain immutable session identity, current draft, visibility, disabled
state and an owner-scoped AbortSignal. Pass that signal to reads and fence async
state updates. Stop presentation polling when hidden or disabled. Disabling
presentation must not stop a user-owned goal/run. The declared composer service
provides `sendDraft(text)` through the normal send path; it rejects stale owner
lifetimes. Never import a provider SDK or retain a root setter.

Run `bun scripts/pluginComposerSmoke.ts`, the real TUI plugin-host smoke and
`node scripts/webComposerPluginBrowserSmoke.mjs`. The browser check uses real
MessageView with mocked goal/send endpoints; it does not verify a live provider.
The contributor smoke adds a composer accessory using package files and static
registration lists only, then typechecks both applications.

## Session runtime diagnostics

`plugins/diagnostics/` demonstrates an unpinned session feature using the same
manifest and `lib/plugins/diagnostics.ts` service contract in both apps. The Web
shell offers `session-diagnostics` through its HTTP adapter; the native shell
offers the service facade. Pass explicit provider/instance/session identity and
the presentation lifetime signal to every read/action. A view may hold its
opening session while the reader changes. Do not infer command ownership from
surface pinning: declare the session requirement/scope on the command.

Preserve loaded scoped state across placement changes. Abort pending work on
unmount, new open requests or disable, and guard state updates after awaits;
some native SDK reads cannot actually be cancelled. Do not turn a relocated
view into automatic provider activation. The real Web diagnostics interaction
check is `node scripts/webDiagnosticsPluginBrowserSmoke.mjs`.

## Dashboard pages and standalone routes

`plugins/messaging/manifest.ts` is the working example. Add a `dashboards` entry
with a stable ID, title, glyph, command ID and surface ID. Its command declares
`scope: 'application'`, `requires: null`, `webDashboard: <dashboard-id>` and the
matching `opens` surface. The surface must support `window`; its ordinary Web
loader supplies the view. Core dashboard IDs are reserved. Dashboard ID types,
tabs, sidebar launchers and contents derive from metadata. No root union,
rendering case, feature callback or palette branch is needed.

Use `components/shell/PluginPage` for an optional standalone Next route. It
loads the same surface through the registry, offers a declared `page-location`
capability with URL/query updates, and respects plugin disablement. The
messaging `/agents` page reads its recipient query through this capability;
embedded messaging leaves the dashboard URL untouched. Keep feature routing
inside the plugin adapter. Overlay/session hosts must yield `webDashboard`
commands to the dashboard navigation owner.

`PluginMessagingService` in `lib/plugins/messaging.ts` is the shared transport
contract. Both renderer adapters receive it as the declared `messaging` service;
HTTP/native wiring remains in the shell. Discovery returns a qualified address
as well as a native ID. Use `addressableSessionKey()` for recipient selection
and sending; use `fromAddress` to exclude only the source provider instance.
Do not resolve a duplicated native ID or display name by picking the first row.

Retain the recipient and draft through the host's scoped state. Guard reads
and deliveries with a resource scope and ignore responses after disable, close
or owner changes. A cancelled presentation cannot undo an accepted agent turn.
Never automatically replay a send on re-enable.

Run `bun scripts/pluginDashboardSmoke.ts`,
`bun scripts/pluginMessagingIntegrationSmoke.ts` and
`node scripts/webMessagingWorkspaceBrowserSmoke.mjs`. The contributor smoke
adds a dashboard using its package and static registration only, then compiles
both complete roots. Actual renderer checks cover placement state, commands,
disable/re-enable and stale deliveries; backend integration uses mocked SDK
facades and does not claim live-provider validation.


## Reader contributions and task controls

`plugins/tasks/` demonstrates shared task derivation with separate Web reader
and OpenTUI adapters. Add `reader: [{ id, surface, width, order? }]` to the
manifest. Width is an integer from 160 to 800; the surface supports `panel`.
Commands declare `webReader`, `webReaderAction: 'open' | 'toggle'` and optionally
`webViewMenuLabel`. The catalog validates ownership; the Web shell dispatches
requests and renders the slot without a feature case.

Declare `reader-slot` as optional when the same view also supports other
placements. Handle its serial-numbered request once and call `report({ visible,
count })` when presentation changes. The shell owns geometry, hiding and owner
lifetime; the plugin owns when content should appear and its scoped open state.
An explicit open should show a useful empty state. Do not render another rail
or change transcript sizing from inside the plugin.

Tasks consume `session-transcript`, `live-transcript` and `task-control`.
`lib/plugins/tasks.ts` holds the shared live snapshot/control contract. Capture
the qualified target for stop/read requests and pass the presentation signal.
A project reader can provide jump-only controls; render it read-only. Do not
assume every placement supplies native stop/output services.

Run reader/domain smokes and `node scripts/webTaskPluginBrowserSmoke.mjs`.
The contributor smoke adds a reader using only package files, catalog and lazy
registration, then typechecks both apps. Its registration probe does not prove
browser effect behavior; the task browser check exercises that with MessageView.

## Bridge presentation and runtime ownership

`plugins/bridges/` demonstrates host runtime services with plugin-owned panels.
`lib/plugins/bridges.ts` provides the view and executable routing contracts.
A view acquires `acquireView()` and defers its idempotent release to the view
resource scope. The host keeps the bridge connected while presentation has a
lease or composer routing is enabled. Closing or disabling presentation releases
its lease, while enabled composer routing continues independently.

Use `bridge-routing` executable command capabilities for route toggles. Declare
provider restrictions in command metadata and check services before offering
controls. Runtime callbacks, pending sends, history and durable replay must use
account-qualified ownership even when native session IDs collide. Retain native
session IDs only for the bridge protocol target. Late results cannot update the
new owner's UI. Connection configuration and route preference have independent
lifetimes from a view's draft.

Run `pluginBridgeCommandSmoke.ts`, `channelBridgeDurabilitySmoke.ts`,
`bridgeHistoryIdentitySmoke.ts` and the Web bridge browser checks. The runtime
browser uses real MessageView/hooks and local HTTP/SSE; it does not exercise a
live Claude process. The panel browser uses fake controllers and a stubbed diff
renderer to exercise approvals, structured comments and presentation lifetimes.


## Repository playbook management

The Coordination plugin's `playbooks` surface is the Web/OpenTUI example for
repository-owned CRUD. Declare `playbooks` and `repository` services, `pin: 'cwd'`
and a repository-scoped command. `lib/plugins/playbooks.ts` supplies the shared
list/read/write/remove contract; shell adapters offer HTTP or native storage.
Capture cwd before opening or starting a request. Use scoped editor state for
placement changes and abort pending reads on repository changes, close or
disable. A completed save survives closing its presentation. The Web application
host opens repository-scoped surfaces with captured cwd even without a session.
Run launching uses the separate `run-launch` capability; playbook storage does
not create sessions or own the accepted run lifetime.


## Coordinated-run launch

The Coordination plugin's `new-workflow` surface and stable `coord-start`
command demonstrate repository-owned setup in both renderers. Form state,
validation, policy controls, nested playbook management and keys live in the
plugin. The shared `PluginRunLaunchService` in `lib/plugins/runLaunch.ts` offers
captured defaults and `start(params, signal?)`. Native services register accepted
sessions and runtime watchers independently of the presentation. UI-only reveal
or navigation happens only while the opening view lifetime remains active.

Capture provider, configured instance, repository and account-owned model/effort
before submission. Switching lead provider drops incompatible account defaults.
An already open form keeps its captured target; closing and opening a new form
uses the current target. Preserve draft state during placement moves. Return
providerInstanceId with each created session rather than rebuilding identity from
native IDs. Same-provider teammates inherit the lead account; other provider pool
entries use their defaults. The backend validates explicit instances before
creating sessions or ledger entries and refuses conflicting native IDs across
accounts instead of aliasing them.

Abort can refuse a not-yet-dispatched launch. Once dispatched, creation is an
independent runtime: closing or disabling the view must not abort its acceptance
receipt, kill the run or navigate through a late callback. Register accepted
runtime sessions/watchers without a selection-changing catalog refresh. Pass
presentation signals to reads and fence local updates after awaits.

Run `pluginRunLaunchServiceSmoke.ts`, `coordRunLaunchIdentitySmoke.ts`, the Web
run-launch browser check and native `newWorkflowPluginSmoke.tsx`. These use
mocked SDK/provider boundaries and local fixtures, not live agent execution.

### beforeSteer, permission and toolCard

- `beforeSteer({ target, message })` — a message sent into a running turn.
  Return `{ action: 'patch', message }` or `{ action: 'block', reason }`; a
  block is an error the sender sees.
- `permission({ target, request })` — a tool approval from any provider, in one
  shape: `kind` (`tool`/`command`/`file`/`network`/`other`), `toolName`,
  `command`, `paths`, `input`, `title`. Return `{ decision: 'allow' | 'deny',
  reason? }` to answer the agent, or nothing to ask the person. The first plugin
  to decide wins; a hook that throws or takes longer than 5s counts as
  undecided, so a broken policy only ever falls back to asking. Questions and
  plan approvals are never offered to this hook. Every bridge calls
  `lib/plugins/permissionBridge.ts`; a new provider's bridge should too.
- `toolCard({ target, tool })` — how a tool call reads in the transcript:
  `{ title?, lines? | text?, tone? }`. It runs on the read path (500ms budget,
  cached per call), annotates `ToolUseBlock.pluginCard`, and both renderers
  draw a generic card that still shows the call's own failure.

## Widgets

A widget is UI a plugin keeps on screen while enabled, with no opening command
(`plugins/pi-activity/` is the example). Declare it in the manifest and add one
line to each renderer's widget loader list
(`components/shell/widgetPlugins.ts`, `tui/opentui/shell/widgetPlugins.ts`):

```ts
widgets: [{ id: 'build-status', slot: 'corner' }],
```

The entry exports `widgets: PluginWidgetModule<...>`. A widget is loaded at boot,
so keep its module small, read its own state (a store or a subscription), and
return `null` when it has nothing to say: an empty `corner` slot covers no cells
and takes no clicks. Each widget has its own error boundary. Disabling the
plugin evicts the module and removes the widget at once; it must not stop the
feed behind it.

## Chords and navigation

`tuiChord: { key: 's', short: 'sum' }` on a command binds `⌃K s`. Two
contributions of one key fail at load; `keys.json` still rebinds any of them.
`session-navigation` (`open(session, messageUuid?)`) shows a session in the
reader and lands on a message once it loads, switching provider or instance
when needed — both renderers offer it to application views and dashboards.
`provenance` (`sessionFiles(session)`, `blame(file, cwd)`) reads the edit index, and
`remote-access` (`read`, `act`) drives pairing on the process that serves the
phone; both renderers offer both, so a view written against them runs in either.

## Local plugins (mods)

A mod is a directory in the user's plugin directory. `plugin.json`:

```json
{
  "id": "todo-nag",
  "title": "TODO nag",
  "description": "Asks the agent to finish TODOs it leaves behind.",
  "behavior": { "hooks": ["afterTurn"] },
  "commands": [
    { "id": "summarize", "label": "Summarize the last reply", "scope": "session",
      "services": ["notices", "composer"], "tuiChord": { "key": "y", "short": "sum" } }
  ]
}
```

and `server.mjs` (or `.js`, or `.ts` under Bun):

```js
export async function afterTurn({ readMessages, followUps }) { /* as above */ }
export const commands = {
  async summarize({ target, readMessages, sendTurn, signal }) {
    const [last] = await readMessages(1)
    return { notice: 'Summary ready', insertText: `Summarize: ${String(last.message.content).slice(0, 200)}` }
  },
}
```

- The id must not be a bundled plugin's; commands are namespaced `<id>:<command>`.
- Code runs where turns run: in the TUI's process, or the Web daemon's (the
  page calls `POST /api/plugins/local`, a write-scoped route). A command returns
  effects as data — `notice` (string or `{ kind, text }`), `insertText`,
  `replaceText` — and the renderer applies them through its command host, so
  a stale or retargeted command cannot write into another composer.
  `sendTurn(message)` sends a turn to the target session through the send path.
- `scope` is `application` (default), `session` or `repository`; `services` is a
  subset of `notices`, `composer`, `transcript` (default `notices`), all required.
- Widgets: declare `"widgets": [{ "id": "status", "refreshMs": 5000 }]` and
  export `widgets: { status: () => ({ title, text | lines, tone }) }`. The shell
  draws them in the corner slot of both renderers; one that throws, returns
  nothing or takes over 2s is skipped that round.
- All five hooks (`beforeTurn`, `afterTurn`, `beforeSteer`, `permission`,
  `toolCard`) are available to mods by listing them in `behavior.hooks`.
- Discovery runs once per process; restart after adding a mod. Both plugin
  managers list mods (they can be turned off like any plugin) and any refused,
  with the reasons.
- Views: declare `"views": [{ "id": "tally", "title": "Tally" }]` and export
  `views: { tally: ({ signal }) => ({ title, blocks }) }` plus
  `actions: { bump: ({ view, item }) => ({ notice }) }`. Blocks are
  `heading`, `text` (with a tone), `item` (label, detail, optional `action`
  and `id`) and `button` (label, `action`). The bundled Mod views plugin
  (⌃K x, palette "Mod views") draws them in both renderers: rows and buttons
  are clickable, and in the TUI ↑↓/j/k select and Enter runs. An action runs
  where the mod lives, its notice is shown, and the view re-renders. A view is
  data, not code, so it needs no build.
- Every view is also a surface of the mod's own (`<plugin>.<view>`), opened by
  its own palette command (`<plugin>:view-<view>`, labelled with the view's
  title). It goes through the same catalog, view registry and surface host as a
  built-in: overlay, window, tab, saved layout, ⌃⇧W, enablement and
  `keys.json` rebinding all apply, with nothing mod-specific in the shell.
- Components: a view declared `"component": true` is the mod's own React
  component. Ship `web.mjs` and/or `tui.mjs` beside `plugin.json` — plain ES
  modules that import nothing — exporting a factory that receives the app's
  React: `export function views({ React }) { return { gauge: Gauge } }`. Build
  elements with `React.createElement` (in the TUI the intrinsic elements are
  OpenTUI's: `box`, `text`, `span`). Props: `run(action, item)` (a server
  action; resolves to its notice), `close`, `view`, and in the TUI `theme`,
  `width`, `height` and `registerKeys` (return true from the handler to keep a
  key). No bundler is involved, the component shares the app's React, it keeps
  its state across its own actions, and an error is caught at its boundary.
- `scripts/localPluginSmoke.ts` is the worked example end to end.

### Live app data and navigation

Local mods opt in with `"appServices": ["data", "navigation"]` in `plugin.json`.
The declarations are optional; existing mods retain their previous behavior.
They describe supported host capabilities, not a sandbox for trusted mod code.
The authoritative contracts are `lib/plugins/modApp.ts`, `localManifest.ts` and
`modViews.ts`; transport/lifetime adapters belong to the shell in both apps.

- Server `views`, `actions`, `widgets` and `commands` receive `app`: an immutable
  version-1 snapshot captured for that invocation's originating renderer. It
  includes `instanceId`, `renderer`, `cwd`, `theme`, `focused` (nullable),
  `focusedSurface`, `surfaces`, `selectedKey`, `sessions` and `commands`.
- Session summaries include a canonical `key`, title, cwd, activity and a
  qualified `target` (`provider`, `providerInstanceId`, `sessionId`). Use the
  supplied keys and targets; native session IDs overlap across accounts.
  Transcript contents and credentials are not part of the app snapshot.
- Components receive an `app` service. Subscribe with
  `React.useSyncExternalStore(app.subscribe, app.getSnapshot, app.getSnapshot)`.
  Components keep their state across app updates. Data views refresh on app
  changes, coalesced by 50ms; opted-in widgets also react to app changes.
  Use existing host activity rather than adding provider polling.
- Components can `await app.openSession(target)`, `app.openFile(path, line?)`,
  or `app.commands.run(id)`. `app.commands.list()` reports IDs, labels,
  availability and refusal reasons. Commands are declarative surface opens;
  executable handlers and dashboard/reader routing are excluded. Disabled
  plugins and missing session/repository prerequisites are checked again.
- Server actions/commands return `appEffects`, for example
  `{ appEffects: [{ type: 'command', id: 'git' }] }`,
  `{ appEffects: [{ type: 'session', target }] }`, or
  `{ appEffects: [{ type: 'file', path, line }] }`. Effects require the
  `navigation` declaration and are applied by the originating renderer.
  Never call renderer state from server code or infer the active target after
  an await. Disabled/closed/cancelled/retargeted invocations cannot navigate.
- OpenTUI file navigation uses the editor. Web uses the Files preview and
  refuses requests for a specific line. Handle unavailable capability errors.
  New send/interrupt/session-management methods are outside this contract.
- Keep item IDs stable when the session list reorders; do not address rows by
  their current array index. `docs/examples/mods/live-sessions/` is a worked
  data view with stable IDs, qualified session navigation and a Git action.

### Mod checks and running-app inspection

```sh
agent-viewer mods check /path/to/mod --json
agent-viewer mods check /path/to/trusted-mod --render --json
agent-viewer app status --json
agent-viewer mods status --instance <id> --json
```

Static checks do not import the mod: they validate manifests/API compatibility,
reserved/duplicate IDs, entry files, syntax and component renderer availability.
TypeScript syntax validation does not prove Node compatibility; `server.ts`
requires Bun in the app runtime. The checker itself uses Bun.

`--render` executes trusted code in child processes, with fixture app data and
a ten-second timeout per child. It validates declared exports and initial
views/widgets, and renders supplied Web and OpenTUI components. It does not
invoke actions, behavior hooks or provider turns, but import side effects do
execute. It is not a sandbox and does not prove later asynchronous states,
keyboard behavior, focus or final layout. Verify these in the actual renderer.
Exit codes: 0 passed, 1 failed, 2 invalid usage.

App status selects published renderer instances, not an ambiguous global
selection. Each Web tab and TUI process has its own ID. Reports include
selection, focus, open plugin surfaces, mod enablement/refusals and up to fifty
recent errors, with contribution names and repeat counts. Plugin managers show
these diagnostics too. Heartbeats run every five seconds; fifteen seconds
without an update means stale/disconnected. Background browser throttling may
make an inactive tab stale. Unknown terminal focus is null. Inspection does not
load providers, resume sessions or execute mods.

The shared publisher writes private, atomic user-runtime snapshots; it rejects
older publication revisions so late requests cannot replace newer state.
`AGENT_VIEWER_INSPECTION_DIR` isolates storage in checks. A daemon without a
connected renderer does not claim focus/layout state. `--instance <id>` selects
one exact instance; a missing explicit ID exits 1.

Run `npm run mods:smoke` for contract, CLI, route and rendered OpenTUI checks,
`node scripts/webModAppBrowserSmoke.mjs` for rendered Web behavior, and relevant
plugin smokes plus both typechecks. Report initial-render, browser-fixture,
real-app and live-provider validation separately. The full guide is
`docs/mod-app-services.md` in a checkout.

## Provider mods

A mod can be an agent backend. Add `"provider": { "displayName": "Echo agent" }`
to `plugin.json` and export `provider` from the server module:

```js
export const provider = {
  listSessions: async () => [{ id, title, cwd, updatedAt }],
  readMessages: async (id) => [{ id, role: 'user' | 'assistant', text, at }],
  createSession: async ({ cwd, title }) => ({ id }),
  async *sendTurn({ sessionId, message, history, signal }) { yield 'reply text…' },
}
```

The mod owns and persists its sessions (both sides of each turn); `history` is
a copy of the conversation before this turn; `sendTurn` may also return a
string. Each provider mod is an instance of the bundled `mod` provider
(`mod-<id>`), so it appears in the provider menu, its sessions list and open
like any agent's, the composer streams its replies, and every call is routed
by the instance — two provider mods never see each other's sessions. Plugin
hooks (`beforeTurn`, `afterTurn`, …) apply to its turns too. Turning the mod off
removes the instance. `scripts/modProviderSmoke.ts` is the worked example.

An SDK-backed provider that needs native capabilities (fork, rewind,
permissions, tool streaming) is still a bundled extension:
`npm run providers:scaffold -- <id> "<Name>"`.
