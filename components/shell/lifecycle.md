# Shell lifecycle ownership

The application composes these hooks once at the shell boundary. They do not
own sessions, transcript data, or navigation.

- `useReaderPresentation` owns the collapsed-pane preference, application focus
  mode, and native fullscreen synchronization. It restores browser preferences
  after hydration, keeps focus mode when native fullscreen is denied, respects
  consumed Escape events, and gates focus/fullscreen actions on reader eligibility.
- `useShellShortcuts` installs one global listener for shell commands. Repository
  commands require an active repository. Nested surfaces can prevent a shortcut
  before it reaches the shell. Feature-level listeners belong to their surfaces.
- `useDocumentVisible` adapts document visibility through `useSyncExternalStore`.
  Its server snapshot is visible, including the first hydration render of a hidden
  browser tab; the browser snapshot then controls background work.
- `useTeamAttention` polls the durable attention summary while visible. It reads
  the same local reviewed-result markers as the Coordinator, retains object
  identity when marks are unchanged, prevents overlapping polls, and aborts and
  fences obsolete responses on visibility changes or unmount.

The browser fixture hydrates server-rendered markup and exercises the real hooks
under StrictMode. HTTP, document visibility, and the browser fullscreen API are
controlled by the fixture; the checks do not prove native fullscreen behavior in
every browser or live Coordinator behavior.

```sh
node scripts/webShellLifecycleBrowserSmoke.mjs
npx tsc --noEmit
```
