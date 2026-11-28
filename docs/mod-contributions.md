# Local mod contribution points

Local mods can opt into the same panel placement used by bundled surfaces and
show server-produced widgets in the shared named slots of Web and OpenTUI.
No root callback, renderer import or project-directory discovery is needed.

## Views as panels

```json
{
  "id": "build-board",
  "views": [{
    "id": "board",
    "title": "Build board",
    "placements": ["overlay", "window", "panel"],
    "defaultPlacement": "panel",
    "panelOrder": 20
  }]
}
```

The existing server `views.board` function returns portable content; a view with
`component: true` can instead ship Web/OpenTUI components. Each declared view
still owns its stable `<mod>.<view>` surface and `<mod>:view-<view>` command.
The palette command opens the declared default placement; panel launchers derive
from the shared catalog. `panelOrder` controls ordering among panels.
The shell continues to own chrome, focus, keyboard routing, target capture,
relocation and saved layouts. The mod adapter renders content without an extra
outer frame when placed in a panel or window.

`placements` must contain unique values from `overlay`, `window` and `panel`.
`defaultPlacement` must be `overlay` or `panel` and appear in `placements`.
If omitted, it selects overlay when available, otherwise panel. A window-only
list is refused because the generated opening command needs an overlay or panel
entry point; include one of those alongside window. Non-finite `panelOrder`
values are refused. Existing declarations keep overlay/window placements and
an overlay opening command. Generated configuration views retain those defaults.

## Widgets in named slots

```json
{
  "widgets": [
    { "id": "build", "slot": "corner", "refreshMs": 5000 },
    { "id": "progress", "slot": "top-center", "order": 10 },
    { "id": "notice", "slot": "viewport" }
  ]
}
```

```js
export const widgets = {
  build: () => ({ title: 'Build', text: 'All checks passed', tone: 'success' }),
  progress: () => ({ title: 'Progress', lines: ['3 of 4 jobs complete'] }),
  notice: () => ({ title: 'Notice', text: 'Deployment is ready' }),
}
```

`corner` preserves its existing location: lower right on Web, upper right in the
terminal. `top-center` uses the existing centered overlay host. `viewport` uses
the existing viewport host; local text cards stack at its upper-right anchor.
These are small bounded informational cards, not custom overlay positioning.
Bundled viewport widgets retain their existing layout. Multiple contributions
can overlap if different slots share the same anchor; pick the slot that matches
the information rather than using several slots for the same message.

Omitting `slot` preserves corner placement. `order` is an optional finite number;
local cards sort by order, then plugin ID and widget ID within each slot.
Local cards follow bundled widgets in that host. `top-bar` is refused for local
mods: the reserved terminal row has no matching Web host and is managed by the
shell's row budget. No reserved rows or new shell state are introduced here.

All mounted local-widget slots share one poller, using the fastest enabled
widget interval. Widget content is still read where mods run and decoded through
the bounded existing content contract. A response cannot choose or spoof its
slot: only validated manifest metadata controls placement. Undeclared IDs,
disabled mods and removed mods are filtered, including late results from reads
that were active when a mod was disabled or reloaded. No local widgets means no
local widget polling; unmounting the last slot stops the poller.

Slots and placements survive the daemon-to-Web manifest round trip and catalog
refresh. Runtime-event/permission metadata and package version/host API metadata
also remain intact during that normalization. Local mod code remains trusted,
unsandboxed code; UI contribution metadata does not restrict its filesystem or
network access.

## Verification

- `bun scripts/modContributionsSmoke.ts`: declarations, catalog panel commands,
  metadata round trip, slot ownership/order, disablement and invalid declarations.
- `bun tui/opentui/modContributionsSmoke.tsx`: native panel adapter, three widget
  hosts, one poller, disable/re-enable and stale-read removal.
- `node --import tsx scripts/webModContributionsSmoke.mjs`: browser panel adapter
  without overlay chrome, named widget hosts, one poller and disable/re-enable.

Renderer checks use local fixtures. They do not exercise live provider turns or
claim full browser/terminal shell focus behavior merely from a typecheck.

Reload integration also has a focused browser check:
`node --import tsx scripts/webModReloadSmoke.mjs`. It runs the actual Web
inspection publisher and manifest revision handshake, applies refreshed manifests
through `applyWebLocalPlugins`, and uses real HTTP view adapters and blob-loaded
component modules in React StrictMode. It verifies command removal/replacement,
panel metadata changes, refresh of an already-open data view, component
reload/remount with reset component state, and suppression of pending old-action
navigation effects. The server responses are local fixtures; this does not claim
live daemon/package installation or provider validation.
