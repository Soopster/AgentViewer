# Mod app services and inspection

Local mods can observe app context and navigate through supported shell services in Web and OpenTUI. They remain trusted code installed in the user's config directory; no project directory is searched for mods.

Declare the optional services in `plugin.json`:

```json
{ "id": "my-board", "appServices": ["data", "navigation"], "views": [{ "id": "board", "title": "My board" }] }
```

Existing mods need no changes. `data` enables app context; add `navigation` to request UI actions. These declarations describe the supported API, not an execution sandbox.

## App data

Server `views`, `actions`, `widgets` and `commands` receive `app`, an immutable version-1 snapshot captured for the invocation's originating renderer. It contains `instanceId`, `renderer`, `cwd`, `theme`, `focused` (null when unknown), `focusedSurface`, `surfaces`, `selectedKey`, `sessions`, and `commands`. Session summaries include a canonical `key`, title, cwd, activity and qualified `target` (`provider`, `providerInstanceId`, `sessionId`). Do not construct keys or drop provider-instance identity. No transcript or credentials are included.

Data views refresh on app changes, coalesced by 50ms. Widgets also refresh on relevant app changes alongside their declared timer. Unchanged snapshots retain identity. Existing runtime activity feeds are reused; mods do not need to poll providers.

Component views receive an `app` service:

```js
function Board({ React, app }) {
  const state = React.useSyncExternalStore(app.subscribe, app.getSnapshot, app.getSnapshot)
  // Render with React.createElement; use div/button on Web, box/text on OpenTUI.
}
```

Components retain their state during app updates. Their subscription follows the component lifetime. A missing renderer component is reported explicitly.

## Navigation

Components can call `await app.openSession(target)`, `await app.openFile(path, line?)`, or `await app.commands.run(id)`. `app.commands.list()` returns IDs, labels, availability and refusal reasons. Commands currently include declarative surface-opening commands, excluding executable handlers and dashboard/reader routing. Disabled plugins and missing session/repository prerequisites are reported. OpenTUI file navigation uses the editor; Web uses the Files preview (requests for a particular line return an unavailable error there).

Server code returns UI effects; it never reaches into renderer state:

```js
export const actions = {
  git: () => ({ appEffects: [{ type: 'command', id: 'git' }] }),
  session: ({ app, item }) => {
    const found = app.sessions.find(session => session.key === item)
    return found ? { appEffects: [{ type: 'session', target: found.target }] } : {}
  },
}
```

Other effects: `{ type: 'file', path, line? }`. Existing notice and composer effects still work. Navigation requires the `navigation` declaration. The host checks enablement, originating instance and target again before applying results. Closing a view or cancelling an invocation prevents late navigation. New send/interrupt/session-management APIs are not part of this service; existing APIs remain unchanged.

The [live sessions example](examples/mods/live-sessions/plugin.json) provides a working data view, qualified session navigation and a Git surface action. Copy its folder to the user's mod directory and restart the app. Its stable item IDs avoid selecting a different session when the list reorders.

## Check a mod

```sh
agent-viewer mods check /path/to/mod --json
agent-viewer mods check /path/to/trusted-mod --render --json
```

Default checks parse the manifest, detect reserved/duplicate IDs and incompatible APIs, check entry files and source syntax, and report renderer availability. They never import the mod. TypeScript syntax checks do not prove runtime compatibility; `server.ts` requires Bun in the app runtime.

`--render` executes trusted code in child processes with fixture app data and a ten-second timeout per child. It validates exports, initial data views/widgets, Web initial rendering and OpenTUI initial rendering when supplied. It does not invoke actions, hooks or provider turns. Import side effects still execute: this is not a sandbox. Async states and real focus/layout behavior require exercising the app. OpenTUI checks require Bun. Checks use the same Bun runtime required by OpenTUI; runtime status inspection needs only Node.

Exit codes: 0 passed, 1 validation/execution failure, 2 usage error.

## Inspect running apps

```sh
agent-viewer app status
agent-viewer app status --instance tui-INSTANCE --json
agent-viewer mods status --instance web-INSTANCE --json
```

Each Web tab and OpenTUI process has its own ID. Inspection includes selection, focus, open plugin surfaces, mod enablement/refusals and up to 50 recent errors. Errors identify their contribution and include a repeat count. Plugin managers show the same errors.

Snapshots publish on changes and every five seconds. After fifteen seconds without an update they are marked stale/disconnected; terminal focus stays null when unknown. Inspection does not resume sessions, load providers or execute mods. Web background throttling may make an inactive tab stale until it becomes active again.

Files are atomic, user-scoped and private under the OS runtime/temp directory. `AGENT_VIEWER_INSPECTION_DIR` selects another directory for testing. Inspection lists all published instances, including stale ones, or selects an exact ID. No matching explicit ID exits 1. A daemon without a connected renderer does not claim a renderer's focus/layout.
