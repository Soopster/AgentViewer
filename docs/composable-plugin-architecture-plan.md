# Composable application core and feature plugins

Status, 25 October 2026: delivery steps 2–4's Git half are done. Every
provider SDK runtime lives in its extension ([Provider extensions](provider-extensions.md)).
The feature plugin host exists (`lib/plugins/`, `tui/opentui/shell/`,
`components/shell/`), and **Analytics, Git and Files** run through it in both
apps (`plugins/analytics/`, `plugins/git/`, `plugins/files/`), and the TUI
**editor** is a plugin (`plugins/editor/`, single, capture keys; its file
target is `PluginTarget.path/line`, and its buffers survive overlay ↔ window).
**Terminal and Browser** are plugins in both apps (`plugins/terminal/`,
`plugins/browser/`, side-panel kinds with windows): the processes and shells
stay host services (`processStore.ts`, `shellStore.ts`, reached through
`tui/opentui/shell/sdkTerminal.ts`) that outlive closing the view or turning
the plugin off; the contract gained a tri-state capture (`TuiPluginCapture`:
`'input'`, `'terminal'`), `keys: 'field'`, a command `placement: 'panel'`
(⌃K l), and `browser-location` / `window-selection` services. The Web
terminal's PTY session is still tied to its view (closing or disabling it ends
it), as it was before the move. The TUI's
new-session folder picker is the Files view asked for a directory (the
`directory-picker` service); with Files off, browsing says so and the recent
folders still work. In the TUI, **cross-session messaging, the task list, the
bridge panels and diagnostics** are plugins (`plugins/{messaging,tasks,bridges,diagnostics}/`,
TUI only): bridge routing and the bridges stay with the composer, a service the host
offers only sometimes refuses its command with the host's reason (`pluginServiceGaps`),
and diagnostics reads once per open (`PluginTarget.request`); their Web views (composer
bridge popovers on `useChannelBridge`/`useIdeBridge`, MessageView's inline diagnostics,
`TaskRail`, page-level messaging) are still host code. A **plugin manager** (TUI palette
"Plugins: turn features on or off", Web palette "Plugins") turns each plugin
off or on; the choice is `.agent-viewer-data/plugins.json`, shared by the TUI
and the web daemon (`/api/plugins`). `npm run plugins:smoke` checks the
contract, enablement, the TUI host, Git and the manager in the real App, and the
import boundaries. Next: terminal/browser, coordination and the
remaining optional features (step 5), then step 6. Plugin view state has a
versioned snapshot codec but is not yet written to disk.

## Objective

Make the Web and OpenTUI roots compose a small application shell. Optional
features contribute commands and views through a versioned, typed plugin API
instead of adding imports, state, key handlers and rendering branches to the
roots. Share domain logic and contracts across renderers; keep DOM and native
terminal components in separate adapters.

Begin with trusted, bundled plugins. Installation, third-party executable code,
hot replacement and a marketplace are separate projects. An in-process capability
interface defines dependencies; it is not a security sandbox.

## Current evidence

The inspected checkout has approximately 30,400 lines in `tui/opentui/App.tsx`,
10,700 in `components/MessageView.tsx`, and 6,900 in `components/MessageItem.tsx`.
Moving those bodies into equally large hooks would preserve their coupling.
Ownership and dependency boundaries must change alongside component extraction.

Useful existing foundations:

- `tui/opentui/popoverWindows.ts` describes pinning, instance multiplicity and
  input capture. Rendering and feature state still live in `App.tsx`.
- `lib/rightPanel.ts`, `components/RightPanel.tsx` and `useRightPanel.ts` already
  separate Web surface layout from content, but surface kinds remain closed
  unions and renderer switches.
- Web `MessageView.tsx` already dynamically imports some optional views, while
  retaining their state and orchestration in the transcript component.
- Workspace runtimes, retained-window visibility, shared transcript loading,
  window chrome ownership and transcript input policy provide reusable host
  services. Preserve their performance and lifecycle contracts.
- Provider extensions contribute browser-safe manifests, lazy read adapters and
  turn runtimes through `lib/extensions/providers/`. Features consume the core
  provider facade. Provider and feature contributions have different contracts;
  neither should import the other's renderer or SDK implementation.

## Ownership boundary

| Application core | Feature plugins |
| --- | --- |
| Session/provider-instance identity, provider facade and canonical event contracts | Provider SDK adapters and turn implementations; Analytics, insights and daily summary |
| Session selection, shared transcript subscriptions, polling and cache budgets | Git review, Git workspace, pull requests and file history |
| Transcript threading, virtualization, anchors, selection and fallback rendering | Files, editor, terminal/process UI and browser |
| Composer, send queue, approvals, interruption and attention routing | Coordination boards, teammates, desk and handoff views |
| Window geometry, focus, tabs, docking, floating, overlays and input precedence | Prompt library, playbooks, bridge panels and diagnostic views |
| Command dispatch, scoped state, persistence, theme/resources and plugin lifecycle | Feature-specific state, presentation and domain operations |

Core runtime control and the attention/approval path must work with optional
views disabled. Disabling a terminal or coordination view must not silently
terminate a running process or agent. Domain services may remain independent
modules and serve multiple plugin views without becoming root component state.

## Proposed structure

```text
lib/core/                     identity, scoped stores, domain/service contracts
lib/plugins/                  manifest types, registry, commands, lifecycle
plugins/<feature>/
  manifest.ts                 metadata only; no UI, SDK or worker imports
  domain/                     shared models and feature logic where needed
  web/                        DOM components and static lazy-load entry point
  tui/                        OpenTUI components and lazy-load entry point
  server/                     optional server-side service adapter
components/shell/             Web shell, surface/overlay/plugin hosts
tui/opentui/shell/            TUI shell, surface/overlay/plugin hosts
```

These are target responsibilities, not a requirement to move every existing
domain file immediately. Migrate one feature at a time and retain adapters for
existing imports until their callers are converted.

The shell composes `SessionRail`, `TranscriptWindowHost`, `ComposerHost`,
`SurfaceHost`, `OverlayHost` and `CommandHost`. Each gets a focused interface.
Feature-specific props such as Git key-handler refs or Analytics loading state
must not appear on the shell's public interface.

## Plugin contract

A manifest declares a stable plugin ID, API version, supported renderers,
commands, surfaces, required service capabilities and state schema version.
Surface metadata declares its title, pin target, multiplicity, supported host
placements and input mode. Keep service requirements distinct from the active
provider's session capabilities.

The host supplies a view-instance context containing workspace and view IDs,
an immutable target reference, visibility/focus state, theme, scoped state and
only the declared service interfaces. Plugins never receive the root state
object, arbitrary setters, raw provider SDK clients or the root renderer.

Commands resolve a target once and pass it explicitly to an action. Async
results retain that owner and cancellation scope when the active session,
workspace or provider instance changes. No plugin constructs session key strings.

Version one contribution points:

1. Surface views presented in the supported panel, window or overlay hosts.
2. Commands, menu entries and contextual actions through a shared dispatcher.
3. Typed feature services and scoped settings/state.

Defer arbitrary transcript-row injection. A later tool-renderer extension point
must retain core-owned measurement, virtualization, selection, anchors and an
unsupported-block fallback. It must not allow a plugin to bypass row budgets.

## Composition and lifecycle

- Use explicit view adapters for panel/window/overlay presentations rather than
  extending components with an expanding list of unrelated boolean props.
- Keep shared service references stable. Use selective subscriptions to domain
  snapshots rather than a changing global React context containing every feature.
- Plugin view state belongs to its workspace/view instance. Persist serializable
  state through a versioned codec; keep callbacks, native styles and handles out
  of saved state and global registries.
- Metadata registration performs no work. Lazy loading begins on activation.
  Merely listing commands or switching sessions must not import every feature.
- Visibility controls presentation subscriptions, animations and timers.
  Long-lived backend work has a separate, explicit service lifetime.
- Scoped tasks use cancellation, foreground priority and bounded worker queues.
  Cache owners register with shared budgets instead of creating unbounded maps.
- The host routes keys according to focus/capture priority. Features do not
  install competing global keyboard listeners.
- A failed feature gets a local Retry/Close view. The transcript and composer
  remain usable. API mismatches are rejected before activation.

Web and TUI entry points remain separate import graphs. Use statically declared
lazy imports in Web client boundaries, respecting the installed Next.js guide.
Server services and SDKs must never enter a client component bundle. Existing
API routes and mutation protections remain the boundary for backend operations.

## Delivery sequence

### 1. Define the host seams and capture baselines

Inventory root state, side effects, imports and commands by owner. Extract
focused shell/controller interfaces around the existing behavior. Establish
startup, idle, session-switch, hidden-window, large-transcript and saved-layout
fixtures for both renderers before migrating features.

Deliver: ownership map, narrow host/service types and renderer-specific shell
components. Avoid building a generic container for every future extension point.

### 2. Add the registry and a minimal host

Turn current popover/right-panel metadata into adapters for one typed registry.
Add surface instances, command registration, lazy activation, scoped state,
visibility/disposal and local failure handling. Prove the contract with a small
fixture plugin while existing features continue using compatibility adapters.

Deliver: adding a fixture plugin changes its package and the built-in registration
list, without editing app roots, command-palette internals or window-kind unions.

### 3. Migrate Analytics end to end in both apps

Move Analytics commands, open state, pinned target and worker subscription into
the plugin. Reuse the existing domain computations. Exercise overlay and window
placements, multiple pinned sessions, hide/resume and disposal.

Deliver: a real plugin with shared domain logic and separate Web/TUI views.
Opening Analytics for one instance must never read its sibling's transcript.
Closed Analytics must not load its UI or start background work at boot.

### 4. Migrate Git review and workspace

Move review/workspace presentation, commands and feature state together. Keep
annotated changes as the default review experience, with mutations adjacent.
Retain current review notes, repository targeting, conflict handling and Git
operation services. Commands call typed services through explicit targets.

Deliver: a second plugin proving mutations, persistence and richer service
requirements without feature branches returning to the roots.

### 5. Migrate the remaining feature families

Move files/editor first, then terminal/process and browser views, then
coordination/teammates/desk, followed by prompts, playbooks, summaries, bridges and
diagnostics. Validate each family's distinct lifecycle before moving the next.
In particular, editor drafts survive view transitions and running processes or
agents survive hiding or disabling their view.

Deliver each migration as a reviewable vertical slice. Do not relocate large
directories before their state and service ownership are established.

### 6. Remove compatibility code and enforce the boundaries

Delete old feature booleans, renderer switches and duplicate command metadata
only after all consumers have migrated. Add import-boundary checks preventing
plugin-to-root and plugin-to-plugin-internal dependencies, eager optional UI
imports, and client imports of server adapters.

Deliver: small composition roots, a documented plugin authoring example and a
contract suite that runs against every bundled plugin.

## Migration compatibility

Preserve existing command IDs, shortcuts, surface IDs and saved layout semantics
through adapters. Version persistent state; avoid rewriting all layouts at once.
A disabled or missing plugin restores as a recoverable placeholder with Enable
or Close actions, retaining its serialized state and layout slot.

Share logical session-reference contracts across Web and TUI without silently
changing their existing persisted key formats. Provider drivers, provider-native
plugins and application feature plugins remain distinct layers.

## Acceptance gates

- A new bundled feature adds no feature-specific state or rendering branch to an
  app root. Disabling it removes its commands and views cleanly.
- Disabled/unopened features perform no activation work or optional module load.
- Hidden views have no presentation polls/timers/subscriptions; backend lifetimes
  follow explicit service ownership. Resume reads a fresh snapshot.
- Duplicate native session/prompt IDs across provider instances remain isolated,
  including attention actions, fleet navigation and stale async completions.
- Window focus, keyboard capture, saved layouts, tab restoration, fullscreen,
  narrow-terminal recovery and composer behavior remain intact.
- Plugin failures cannot take down the transcript/composer. State codecs handle
  old versions and unknown plugin IDs without discarding user data.
- Web/OpenTUI typechecks, focused feature checks, architecture contracts and
  appropriate Web interaction checks pass. Use real rendered interactions for
  behavior claims, not just helper tests.
- Compare identical, isolated workloads against a frozen baseline. Keep initial
  bundle/import cost, JS frames, mounted content, heap and RSS as separate metrics.
  Extraction must not reintroduce eager SDK loads or global render fan-out.

The first implementation milestone is Analytics running through the same host
contract in Web and TUI, with the current application behavior preserved. That
is the point to review the API before migrating Git and the remaining families.

## API review: what Git needs that version one lacks

**Resolved** (API version stays 1; every addition is optional for existing
plugins): `panel` placement and `isPluginPanelSurfaceId` (a panel surface is a
side-panel kind derived from the metadata catalog, checked
in the smoke, and is not also a popover-window kind); `pin: 'cwd'` with
`PluginTarget.cwd`; `repository`, `composer`, `clipboard` services, plus
`optionalServices` for what a view uses only when the host has it (the Web Git
view has no composer yet); `setCapture`; `fullScreen`; and `runCommand(id)`,
which reaches another plugin's command or a named host command. **Pull requests
stayed a host surface**: Git's `p` calls `runCommand('pull-requests')`. Shared
diff rendering stays host code behind `tui/opentui/shell/sdkDiff.ts` and
`components/shell/sdkDiff.ts`, separate from the core SDK so a view that draws
no diff never loads it.

The original review:

Analytics needed one service and two placements. Git (`diff` surface) is also a
side-panel surface, is targeted by repository rather than session, mutates, and
captures keys mid-precedence. Before moving it, decide:

1. **A `panel` placement** — the surface panel (`SurfacePanel`, web `RightPanel`)
   hosts `diff` today. Its kind is the `RightPanelSurfaceKind` union shared by
   both apps and saved layouts, so the plugin surface id must stay `diff`.
2. **A repository target** — `pin: 'cwd'`, matching `windowSurfaceMeta[id].cwd`,
   with the session id as an optional second field (Git's review notes use it).
3. **Services**: `repository` (cwd, session id), `composer` (append a diff note,
   ask an agent about a selection — both target the composer the user is
   writing in, resolved by the host), `clipboard`.
4. **Dynamic key capture** — Git reports when its own text input has the keys
   (`onKeyCaptureChange`); the root routes those ahead of global shortcuts. The
   view context needs `setCapture(boolean)` with that meaning.
5. **Full-screen overlays** — Git's overlay hides the navigation bars
   (`fullScreenPopoverOpen`); a surface flag `fullScreen` replaces the root's list.
6. **Cross-surface commands** — `p` in Git switches to pull requests. Either PR
   joins the Git plugin, or plugins may dispatch another plugin's command id
   through the shared dispatcher (never import it).

## Host hardening after the architecture audit

Provider runtime control keys include provider kind, configured instance and native
session ID, including waiting observations, queued interrupts and steering receipts.
Unscoped legacy calls may resolve a unique session; ambiguous IDs require instance
context instead of choosing an account implicitly.

TUI plugin state is owned by the workspace runtime and the existing view namespace.
Separate windows and panel tabs do not share state just because their targets match.
Layout relocation explicitly copies values into the destination owner; resource
cleanups are never copied. Web hosts allocate a local owner, with an optional stable
`ownerId` for an intentional handoff. Surface changes remount the active host so a
cached component or error cannot belong to the previous plugin.

Disposal cancels its timer, and release callbacks and timers check instance generation.
Object and array defaults in scoped hooks remain stable across renders. Required
services are checked against the values supplied to each view before loading or
mounting it; both renderers filter out undeclared services. Optional services remain
optional.

Panel contributions are derived from manifests. Labels, descriptions, availability
and fallback icons no longer require a new entry in a core kind union. Optional
`panelOrder` preserves existing launcher order. A contributor
adds the manifest and renderer loaders; renderer-specific services remain explicit.
The source-only `npm run plugins:contributor:smoke` fixture adds a new panel
manifest and loaders and type-checks both apps without editing their roots.
Run `npm run plugins:smoke`, `npm run tui:check` and `npx tsc --noEmit` after changes.

## Plugin deactivation and memory ownership

Disabling a feature unmounts its views, disposes active and parked scoped state,
and evicts its view module from the host registry. Pending imports are invalidated;
a completion from an older activation cannot repopulate a newer activation's cache.
The JavaScript engine still caches imported code, so disabling is not full code
unloading and does not promise an immediate reduction in process RSS.

A lazy entry may export an optional, synchronous, idempotent `module.deactivate()`
to clear module-owned caches. It runs only for a loaded plugin, never by importing
an unused plugin just to clean it up. Analytics terminates its worker and rejects
outstanding computations; Editor terminates project search and releases its LSP
configuration and cell measurement caches. Re-enabling lazily creates new resources.

Contributors should create a `createPluginResourceScope(pluginId)` when starting
background work (available from the TUI SDK or `lib/plugins/lifecycle` on Web).
Pass `scope.signal` to fetch/search operations and register worker termination,
timer clearing and unsubscribe functions with `scope.defer(cleanup)`. Return
`scope.dispose` from the owning effect for early cleanup on unmount. Disabling
aborts and disposes the scope even if its view has already been parked. A scope
created while disabled is already aborted and immediately disposes registered work.
Do not allocate workers or start requests as import-time side effects.

User-owned host services, including TUI shells and managed processes, keep their
own lifetime: disabling their presentation plugin does not kill commands. User
editor drafts and saved layout data are not treated as disposable worker caches.
Run `npm run plugins:smoke` for the deactivation, load-race and worker restart checks.

## Concurrent composers and transcript handoff

Web and OpenTUI share `lib/composerSessions.ts`: stream state, controllers,
request IDs, retries and live buffers belong to a provider-instance/session key.
Callbacks retain that owner when focus changes. Pending-to-native ID changes
rekey the existing cells rather than creating a second owner. A follow-up queues
or steers within its session; another session can start immediately. Background
queue continuation uses its captured target and request payload. Cancelling one
session never uses another session's controller or account configuration.

Web keeps the reader mounted when session tabs change, instead of remounting it
through the transition key. The state store preserves inactive sends without
mounting a hidden transcript per session. TUI background completion cannot clear
the active textarea; failed background sends restore their own saved draft.

`lib/composerTranscript.ts` reconciles optimistic user echoes with provider and
persisted rows. IDs are scoped to the owning provider instance. Text matching is
limited to optimistic echoes and newly persisted users, so two real identical
prompts stay separate. Persisted indexes are rebuilt on transcript/turn changes,
not per token, and background transcript panes use the same filtering.

Regression commands: `npm run composer:concurrency:smoke` (real terminal input,
overlapping held streams, per-session followups, draft isolation and targeted
cancellation) and `npm run composer:web:smoke` against the local Web app (Chrome,
scripted streams, tab changes, persisted handoff, background queue and cancellation).
The Web fixture accepts `WEB_COMPOSER_ORIGIN` and `PLAYWRIGHT_CHROMIUM_EXECUTABLE`.
