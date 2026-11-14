# Dynamic island

Enabled by default in Web and OpenTUI. The top-center capsule appears when there
is activity. Click it or invoke **Toggle activity island** from the palette to
inspect the list. New arrivals never take focus. Escape closes the expanded list.
In the terminal, use arrows and Enter to open a session, or `d` to dismiss a row.

The shared model combines observed session activity, Pi startup, provider startup,
observed background tasks and notifications. Background-task summaries use the
reader's existing data, with computation in a worker on OpenTUI. They do not scan
unopened transcripts. Progress appears only when supplied by a producer. Leaving
the running registry says "Turn ended", without claiming a successful outcome.

The **Toast notifications** plugin independently presents the same TUI
notifications. Enable either plugin or both in Plugins. Disabling presentation
never stops agents, startup operations or notification producers. Web uses its
notification fallback when the island is unavailable. OS notifications retain
their existing settings and permission handling.

## Publishing notifications from another plugin

Declare `notifications` in a surface's or executable command's `services`, or in
an application observer's `application.services`. Both hosts supply the same
`PluginNotifications` contract from `lib/plugins/notifications.ts`:

```ts
const id = services.notifications!.show('success', 'Checks passed', {
  title: 'Build',
  target: { provider: 'codex', providerInstanceId: 'work', sessionId: 'thread-id' },
  durationMs: 6000,
})
services.notifications!.dismiss(id)
```

Kinds are `info`, `success`, `warning` and `error`. A title, captured session
target, message UUID and duration are optional. The default duration is six
seconds; errors remain until dismissed. Set `durationMs: 0` for an explicit
persistent notification. Multiple identical publications remain distinct.
Notification callbacks supplied to commands, observers and surfaces are revoked
when their owning lifetime ends. Legacy observer `notice` and `desktop` methods
remain available; `show` is the shared in-app publishing API.

Widget props also offer `services.notifications`. Presentation adapters subscribe
to their platform notification center; producers do not import an island or toast
component, and publishing never requests desktop-notification permission.

Other progress sources can publish through the application `activity` capability
using stable IDs, a source, title, status and optional progress/details/qualified
target. Source owners must remove stale entries and clean up their source on
disposal. Notification records and activity records are temporary host state.

Validation: `scripts/activityIslandSmoke.ts`,
`scripts/webActivityIslandBrowserSmoke.mjs`,
`tui/opentui/activityIslandSmoke.tsx`, both application typechecks, plugin boundary
and application smokes, and the worker-entrypoint smoke.
