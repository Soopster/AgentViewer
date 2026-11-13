# Base shell and plugin migration audit

Inspected 13 November 2026. The target is a base shell in both Web and OpenTUI,
with app functionality composed through plugins. Existing surface extraction is
useful but does not by itself establish feature ownership.

## Shared core boundary

Keep session/provider-instance identity, provider runtime lifetimes, transcript
measurement and virtualization, focus, layout, dispatch and capability routing
in the shell. Features consume narrow services. A provider run or shell process
outlives its presentation plugin. Feature disablement must not become an
implicit interrupt or process kill.

## Current evidence and migration targets

| Family | Current implementation | Remaining migration |
| --- | --- | --- |
| Analytics, Git, Files, Terminal, Browser, Pull requests, Coordination, GitHub, Recaps | Shared manifests and separate lazy Web/TUI surface adapters in `plugins/` | Audit domain operations/state still supplied from roots; preserve runtime ownership |
| Checkpoints & review | `plugins/checkpoints/` in Web and OpenTUI over the shared `checkpoints` service (TUI: lib/checkpoints.ts in process; Web: `/api/checkpoints`, whose mutations act only on a listed checkpoint, a current hunk or a current untracked file). Restore tells the provider through the shared `restoreCheckpointForSession` | `checkpointsRouteSmoke.ts` (real repository; guards verified by mutation), the TUI checkpoint smokes, the live Web check |
| File history | `plugins/file-history/` in Web and OpenTUI over the same `checkpoints` service (`fileHistory`, `revertFileHunk`; the Web's route re-derives the history and accepts only one of its hunks). Opened on a file: the TUI from the editor and ⇧U, the Web from a changed file's History button in Checkpoints, through each host's `file-history` service. Paths resolve against the repository's real path, so a symlinked checkout is not "outside the repository" | `checkpointsRouteSmoke.ts`, `fileHistorySmoke.tsx`, the live Web check |
| Editor, desk, insights, tab manager, subagents | Bundled plugins, TUI-only by manifest. The desk and tab manager are terminal workspace chrome; the Web's subagent transcripts are inline cards and rail rows; the editor has no Web surface | Expose equivalent capabilities where applicable on Web; do not assume a TUI surface establishes Web parity |
| Composer context expansion | Now a headless `composer-context` plugin; shared ordered `beforeTurn` pipeline in `lib/sessionBackend.ts` | Context-chip presentation still belongs to the composer; disabled expansion does not remove chip controls |
| Prompt library | Migrated to `plugins/prompt-library/` in Web and OpenTUI. One manifest retains existing command IDs and TUI window ID. Search/draft/fill state belongs to plugin instances; storage stays behind the prompt API/TUI service | Browser host and real TUI App checks cover lazy activation, placement draft retention, template insertion and disable/re-enable. Web additionally checks that late reads after close cannot insert into the composer |
| Reuse last prompt | Migrated from TUI root/keys/palette into the headless `composer-tools` plugin. The same action is available on Web; no view is loaded | Shared command host checks identity/capabilities and cancels per invocation. Real TUI verifies ⇧R and typed-character precedence; real Web MessageView in StrictMode verifies account-switch cancellation, parked draft preservation and disable/re-enable |
| Session alerts | Shared application observer and domain tracker in `plugins/session-alerts/`; separate Web and TUI settings/notification adapters. Root feature effect and host-owned mode/tracker modules removed | Shared contract smoke covers disable races, account isolation, private/coalesced snapshots and cleanup. Real TUI App emits an attention notification without loading the settings view. Browser host covers view-independent alerts, stopping disabled polling, permission and long-turn delivery with a mocked desktop sink. Native OS notification appearance remains untested |
| Goals | `plugins/goals/{web,tui}` owns composer controls, polling, modal state and keys. Shared metadata, executable command and composer accessory contract; roots render generic hosts | Web interaction smoke checks StrictMode, account-switch cancellation, ordinary sending, pause/resume and disable polling. Real TUI checks palette, modal keys and disable/re-enable. Goal engine remains independent with the singular settled-turn trigger |
| Playbook management | Existing Coordination plugin now contributes the repository-scoped `playbooks` command and surface in Web and OpenTUI. Managers in `plugins/coordination/{web,tui}/` own selection, drafts, CRUD feedback and request lifetimes; `PluginPlaybookService` supplies HTTP/native storage adapters | Actual Web surface-host checks cover create/edit/rename/delete, error draft retention, pending repository switches, disable/close, placement remounts and embedded Coordination management. HTTP smoke covers payloads, invalid definitions, captured repository/signal, errors and cancellation. Real OpenTUI App checks cover lazy opening, draft retention through overlay/window relocation, stale reads, disablement and New Workflow → Manage → return with the brief retained and choices refreshed. Live filesystem/provider behavior is not established by these fixtures |
| New coordinated run | Coordination plugin `new-workflow` surface in Web and OpenTUI (`NewWorkflow.tsx`, `NewWorkflowSurface.tsx`/`WorkflowForm.tsx`) over `PluginRunLaunchService`. The root `CoordRunModal`, its key branch, pickers and actions are removed. Backend launch accepts an explicit provider-instance ID, validated before side effects | `newWorkflowPluginSmoke.tsx`, `webRunLaunchPluginBrowserSmoke.mjs`, `pluginRunLaunchServiceSmoke.ts` and `coordRunLaunchIdentitySmoke.ts` pass. Cross-account native-ID collisions remain explicitly refused |
| Diagnostics | Shared manifest and `PluginSessionDiagnosticsService`; Web presentation and MCP controls moved from the transcript into `plugins/diagnostics/web`. Both renderer views own reads, state and cancellation | Browser checks actual MessageView with configured-account targeting, controls, errors, disable/re-enable and stale reads. Real TUI checks read-on-open, relocation and stale response rejection. Web session command ownership now follows command scope independently of surface pinning |
| Messaging | Web and TUI now use `plugins/messaging/` and `PluginMessagingService`. Web dashboard/tab/sidebar/palette derive from metadata; `/agents` uses `PluginPage`. Both views own scoped drafts and cancellation | Browser checks standalone/embedded route isolation, commands, real placement remounts, disable/re-enable and stale sends. Backend integration checks configured-instance discovery and qualified steering/idle delivery; ambiguous IDs refuse. Native checks retained drafts, qualified recipients and disabled delivery responses |
| Tasks | Shared manifest, task registry domain and separate Web/OpenTUI adapters in `plugins/tasks/`. Web reader metadata replaces the direct task rail and root-owned registry/open state | Browser checks actual MessageView: automatic 360px rail, explicit empty open, close/toggle, read-only project feed, stop errors, account-switch cancellation and disable/re-enable. Domain smoke checks live/persisted reconciliation and provider task snapshots; native host smoke checks opening the task surface |
| CLI / IDE bridges | Shared manifest and typed view/routing services in `plugins/bridges/`; Web panels and route commands use lazy plugin contributions. Shell services retain transport and composer routing | Browser surface checks cover drafts/configuration, permission verdicts, errors/stale responses and diff actions with a stubbed diff renderer. Runtime browser checks actual MessageView/hooks, account-switch isolation and local HTTP/SSE routing across close/disable. Durable outbox and real history-route smokes cover colliding IDs, legacy compatibility, concurrent appends and write-failure recovery. Real provider bridge endpoints remain untested |
| Bookmarks | `plugins/bookmarks/` in Web and OpenTUI over `PluginBookmarksService`; opening one goes through the new shared `session-navigation` service (TUI: the root's open-at-message, formerly bookmark-only; Web: the page's session selection via `ApplicationPluginHost`). Marking (`b`, `[`/`]`, transcript markers) stays reader core. TUI overlay state/keys and the Web panel/palette entry are removed | `pluginHostSmoke.tsx` opens ⇧B in the real App |
| Provenance, remote access | `plugins/provenance/` and `plugins/remote-access/`, in both renderers. Each reaches the host through a service (`provenance`: in-process index reads in the TUI, `/api/provenance/*` on the Web; `remote-access`: the TUI drives the running daemon's `/api/remote-access` — the attach URL, else `AGENT_VIEWER_DAEMON_URL`, else `localhost:$PORT` — since pairing state belongs to the process serving the phone). Application-scoped commands; provenance opens sessions through `session-navigation`. Remote-access trust enforcement stays in `proxy.ts` | Plugin boundary/host smokes; `provenanceRemoteSmoke.tsx` (stand-in daemon through the real palette; a seeded index through the view); both typechecks |
| Pi activity | `plugins/pi-activity/` contributes a `corner` widget in Web and OpenTUI. New contribution point: `PluginManifest.widgets` plus per-renderer widget loader lists (`components/shell/widgetPlugins.ts`, `tui/opentui/shell/widgetPlugins.ts`) and slot hosts (`PluginWidgetHost`). Disabling evicts the module; the feed (`lib/piActivity.ts`) keeps running | `pluginWidgetSmoke.tsx` |
| Run dashboard, Agent Operations tab | Every Web dashboard tab now comes from metadata: `plugins/run-dashboard/` contributes `sessions` (the default tab) over a Web `session-fleet` service, and Coordination's `coord-board` command contributes `agents`. The reserved ids, hand-written `DashboardView`s, the coordination command special case and the sidebar's two hard-coded launchers are gone; dashboards may name a host icon (`icon`) with the glyph as fallback | `pluginDashboardSmoke.ts`, `webSidebarBoundariesSmoke.tsx` (launcher order), `webMessagingWorkspaceBrowserSmoke.mjs` |
| Daily summary | `plugins/daily-summary/` in Web and OpenTUI over `PluginDailySummaryService` (TUI: in-process read with its attention inbox; Web: `/api/daily-summary`, with the server's pending approvals/questions and viewer notes). Root state, keys, palette case, window case and built-in popover kind removed; `scrim` on the surface spec replaces the root's per-overlay scrim list | `dailySummarySmoke.tsx`, plugin host/boundary smokes |
| Handoff | `plugins/handoff/` in Web and OpenTUI over `PluginHandoffService` (git state and bookmarks). `buildHandoffBriefMarkdown` takes the shared analytics input, so the Web builds the same brief from its transcript. ⇧H is the plugin command's navigation key; the root's state, key branches, palette and window cases are removed | `pluginHostSmoke.tsx` opens ⇧H and ⌃K s in the real App and checks disablement |

## Delivered shared behavior seam

`PluginManifest.behavior` declares hooks and order without importing executable
code. `createPluginBehaviorHost` loads enabled contributors lazily, validates
identity/API, composes patches sequentially, supports explicit blocking, and
invalidates pending work on disable. A turn captures its provider, configured
instance and native session ID before any hook runs. Each hook gets its own
request copy. Hook failure/refusal occurs before checkpoint/provider submission.

Web and TUI enter the same `streamViewSessionTurn` boundary. Goal continuations
that use ordinary sending pass through it too. Three further hooks reach past
the send path: `beforeSteer` (mid-turn messages, at the shared steering entry
point), `permission` (tool approvals, through `lib/plugins/permissionBridge.ts`
on every provider bridge — Claude, ACP, Codex, Copilot, OpenCode; undecided,
failing or slow hooks fall back to the person) and `toolCard` (how a tool call
is presented, on the read path, drawn by both renderers). `localPluginSmoke`,
`pluginPermissionAcpSmoke` and `npm run plugins:permission:live` pin them.

The shared command contract now also supports `webComposerLabel` and
`webComposerGlyph`. Composer buttons come from command metadata and dispatch
through the same enabled command path as palettes. A session-required surface
that declares the composer service is owned by the Web session host even when
its window is unpinned. TUI prompt insertion uses a narrow composer service;
the root no longer owns library-open state, keys, palette or window cases.

`PluginManifest.application` now declares app-lifetime `sessionActivity`
observers and their notification capability. Renderer-specific static loader
lists load observer code separately from views; `createPluginApplicationHost`
owns activation, per-plugin resource scopes, event snapshots and failure
isolation. While an import is pending, only the newest snapshot is retained.
Disabling cancels scope-owned work and invalidates pending imports. A fresh
activation baselines the next fresh snapshot; disabled activity is not replayed.

Web's `ApplicationPluginHost` adapts the shared runtime endpoint to canonical
session identities and stops its polling when no observer wants activity. It
continues background polling for explicitly enabled app observers, independent
of hidden presentation lifetimes. TUI publishes its existing sidebar runtime
snapshot after the first successful registry read. Both expose notification
sinks with no feature policy. The runtime API route imports the read-only
activity facade, so observation does not activate the send path.

Commands marked `scope: 'application'` use the generic Web application surface
host without a selected session or another page-level feature callback.

## Executable command contributions

Commands can now declare either a surface `opens` or an executable `handler`.
Action metadata specifies its application/session/repository scope and required
command services. Browser-safe manifests do not import implementations. Each
renderer has a static command loader list; both can load the same pure module.
Shared services include transcript reads, composer writes, notices and bridge
routing. Hosts offer capabilities for their scope and immutable target context;
unsupported capabilities refuse before loading. Bridge route commands use the
same enabled command path as surface launchers, without loading a hidden view.

`createPluginCommandHost` captures only provider/instance/session identity and
repository context, validates handlers and binds capabilities once. Each call
has a resource scope; cancellation/disabling, owner changes, unmounting and
completion end its write lifetime. A delayed command cannot overwrite a new
composer or modify the parked original draft. Failure is contained by the
calling shell and does not prevent other commands from running.

`tuiKeyContext: 'navigation'` lets command shortcuts yield to active composer
input. Adding `composer-tools` removed the dedicated reuse callback, root key
case, palette branch and host implementation. The contributor smoke adds both
a panel and a headless action using only their packages and registration lists,
then typechecks both applications.

## Status, 13 November 2026

Every row in the table above is a plugin in both renderers, or a plugin that
declares one renderer explicitly. What stays in the shell is deliberate: the
attention inbox and approvals (core runtime control), marking bookmarks and the
transcript's own navigation, the engineering inspector (a view mode of the
reader), the coordinator rail, and the plugin manager itself.

Contribution points available to a plugin, each in both renderers unless noted:
surfaces (overlay/window/panel), executable commands, ⌃K chords (`tuiChord`,
TUI), composer accessories, application observers, Web dashboards and reader
slots, **widgets** (`corner` slot), and server behavior (**`beforeTurn`** and
**`afterTurn`** with plugin follow-ups). Shared services added in this pass:
`daily-summary`, `handoff`, `bookmarks`, `session-navigation`, and a Web
`session-fleet`.

**Local plugins (mods)** load from the user's config directory and contribute
behavior hooks and commands without a build (see the authoring reference): a
user changes how the app behaves on their machine without touching the checkout.

Behavior hooks now cover the turn end to end, for bundled plugins and mods:
`beforeTurn`, `beforeSteer` (mid-turn input), `permission` (every provider's
approval bridge: Claude, the ACP pool, Codex, Copilot, OpenCode), `afterTurn`,
and `toolCard` (transcript presentation on the read path, drawn by both
renderers). Mods also contribute widgets as server-computed content. Mods can also be agent backends (provider mods: instances of the bundled
`mod` provider). Mods add
interactive views as data (headings, text, selectable rows and buttons whose
actions run in the mod), and their own React components (`web.mjs` /
`tui.mjs`: plain ES modules that import nothing and are handed the app's
React), both shown by the bundled Mod views plugin in each renderer — and each view is also a catalog surface of the mod's own, opened by its own palette command and placed (overlay, window, tab) by the same host as a built-in's. No build
step is involved in either. `npm run plugins:web:live` drives the real Web
app through the migrated plugins and a fixture mod.

The permission hook is verified per bridge: Claude's `canUseTool` and the ACP
pool hermetically (`localPluginSmoke`, `pluginPermissionAcpSmoke`), and Claude,
Codex, Copilot and OpenCode against the real agents (`npm run
plugins:permission:live`: a mod denies a probe command; the hook is consulted
and the command never runs). Claude asks only when the composer requests
approvals (`manualPermissions`), as the UI does; without it there is no approval
for a person or a plugin to answer.

## Composer accessory contributions

`PluginManifest.composer` declares ordered accessory IDs, bounded terminal rows
and required services. Both renderer loader lists use the same lazy registry and
lifecycle boundary. The host captures an immutable session identity and cancels
its lifetime on owner changes, disablement and unmount. A retained send
capability refuses after that lifetime ends. Modal key routing and row budgeting
are generic shell responsibilities; feature fields and commands stay in the plugin.

Goals demonstrates inline status plus a plugin-owned modal without a hidden
surface or root goal branch. Disabling presentation stops its reads and keys,
while the server goal continues. Composer accessories are trusted bundled source
contributions, matching the existing static registration model.

Diagnostics is also a service consumer: `lib/plugins/diagnostics.ts` is the shared
read/control contract, the Web shell adapts HTTP and the TUI shell adapts its
service facade. Diagnostics selection is captured on open, independently of the
current reader selection; the feature does not start another provider as the user
browses. Disabled or closed presentation lifetimes reject late responses.

Playbook management uses `lib/plugins/playbooks.ts` for repository-explicit list,
read, write/rename and remove operations. The Web adapter preserves the existing
playbooks HTTP payloads and forwards cancellation; the native adapter fences
results before and after the TUI service call. The existing Coordination plugin
owns both manager implementations and its repository-scoped overlay/window
surface. Web application surface hosting captures repository context generically.
Closing or disabling a manager cancels its presentation requests; draft state is
scoped to its repository and survives placement remounts. These management
capabilities do not themselves start coordinated runs.

The run-launch backend separately accepts `StartProtocolRunParams.providerInstanceId`
and validates its provider before session creation or coordinator storage writes.
It binds launch to that account and persists the lead identity used by same-provider
teammate creation, tools, turns and recovery reads. Other teammate providers retain
their provider-default account semantics. Omitting the ID preserves an explicitly
bound SDK caller's context; an unbound caller uses its provider default. An explicit
ID overrides the caller's prior account context. Identical native session IDs
across accounts are refused by the existing Coordinator collision guard; a rejected
launch leaves no durable run or active controller. This is not a migration of all
ledger lookups to permit colliding IDs.

`coordRunLaunchIdentitySmoke.ts` covers these boundaries with mocked provider
operations and real isolated ledger storage; `coordProviderInstanceSmoke.ts` also
passes. The existing `coordModelInheritanceSmoke.ts` times out waiting for the
`inherited` agent to change provider to `claude` after an authentication failure.
An isolated copy using `HEAD`'s `lib/agentCoordination.ts` reproduces the timeout,
separately from the passing launch checks. Automatic cross-provider recovery is
therefore not claimed by this launch validation, and its policy remains unchanged.
The UI run-setup migration is complete (Coordination plugin `new-workflow`).

## Dashboard contributions

A Web dashboard is metadata (`PluginManifest.dashboards`) plus a command with
`webDashboard`, a matching application scope and its ordinary lazy surface.
Dashboard ID types derive from the catalog. The shell renders tabs, sidebar
launchers and contents generically; session and application overlay hosts yield
dashboard commands to the navigation owner. Disabled launchers disappear while
an already selected dashboard can display the shared disabled-plugin view.
`PluginPage` offers `page-location` for standalone query navigation without
feature route props. Messaging demonstrates these contribution paths.


## Reader contributions and task ownership

`PluginManifest.reader` declares a Web reader slot ID, a panel-capable surface
and its bounded width. Commands use `webReader` and an optional
`webReaderAction: 'toggle'`; `webViewMenuLabel` contributes a generic View-menu
entry. The host dispatches serial open/toggle requests through `reader-slot`,
reserves width only while the plugin reports visible, and fences reports to the
current owner and mounted instance. Disabling removes the contribution.
OpenTUI retains its ordinary task surface and shortcut through the same manifest;
its terminal layout uses the existing surface host rather than a Web column.

The tasks plugin owns open state, its empty state, task registry derivation and
local control feedback. A default empty rail stays hidden; explicit open shows
an empty panel. Shared domain logic merges persisted and live transcript events
by UUID, lets live snapshots replace persisted versions, and overlays OpenCode
todos and Codex plan snapshots. Host services provide immutable session identity,
transcript snapshots, navigation and available task controls. Project feeds have
no session stop capability. Stop actions capture identity, cancel with their
presentation lifetime, and display errors without a late notice in another
account or session.

## Bridge runtime and view leases

Bridge services expose configuration, snapshots, send/approval operations and
`acquireView()`, which returns a release callback. A plugin view owns this lease,
its drafts and its pending presentation work. Releasing it on close, relocation
or disablement removes that view's interest; it does not change composer routing.
The shell transport remains active while either a view lease or composer route
needs it. Turning routing off releases the route's interest independently.
Provider runtime and bridge transport ownership therefore remain separate from
the plugin's presentation lifetime. Configured provider-instance identity must
remain part of every session-targeted operation.

The focused browser fixtures use actual shell components and plugin hosts with
mocked provider APIs. The bridge runtime fixture uses local HTTP/SSE endpoints,
while the bridge panel fixture stubs the diff renderer. These checks establish
the covered lifecycle and routing behavior, not live provider interoperability,
full diff rendering, native OS terminal behavior or complete renderer parity.
The task domain smoke and OpenTUI host smoke provide additional focused coverage;
they do not exercise live task stopping against a provider.
