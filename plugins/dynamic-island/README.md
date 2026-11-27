# Dynamic island

Enabled by default in Web and OpenTUI. The top-center capsule appears when there
is activity. Click it or invoke **Toggle activity island** from the palette to
inspect the list. New arrivals never take focus. Escape closes the expanded list.
In the terminal, arrows select a row and show its buttons (clickable, or by key); Enter opens the session and `d` dismisses.

The shared model combines observed session activity, Pi startup, provider startup,
observed background tasks and notifications. Background-task summaries use the
reader's existing data, with computation in a worker on OpenTUI. They do not scan
unopened transcripts. Progress appears only when supplied by a producer. Leaving
the running registry says "Turn ended", without claiming a successful outcome.

## Insights and actions

Beyond activity, the island raises rows a person can act on. A row has a `kind`
and optional `actions`; within one status, approvals sort first, then team,
checks, repo, health and tasks.

| Row | Raised when | Actions (terminal key) |
|---|---|---|
| Approval | A session has an unanswered permission ask. One row per ask. | Reject `r`, Approve `a`, Always `A` (confirm). No Always on a `defaultToDeny` ask, where Reject leads. |
| Question | One single-choice question with up to four options. | Each option, `1`-`4`. |
| Longer question, plan, elicitation | Needs the transcript's picker. | Answer in session / Review plan. |
| Running turn | | Message `m`, Stop turn `s` (confirm). |
| Needs input / waiting | | Reply or Message `m`; Stop turn `s` when it needs input. |
| Turn ended | | Reply `m`, Review changes `v`. |
| Long turn (20m+) | | Ask for status `p`, Stop turn `s` (confirm). |
| Team | Teammates are waiting on the lead. | Open Teammates `t`. |
| Failing checks | Latest finished Proof run. | Draft fix `f`, Rerun failed `c`, Open Proof `v`. |
| Stale checks | | Rerun checks `c`, Open Proof `v`. |
| Uncommitted changes | No turn is running in the project. | Review diff `v`, Draft commit `m`. |
| Background task | Running or failed. | Stop task `s` (confirm, Claude only); Investigate `f` when failed. |
| Other error | A notification or startup failure. | Ask agent `f`. |

Every row with a session can also be opened, and any row can be dismissed.

Web and OpenTUI share one model: `actions.ts` decides what each row offers and
`useActivityActions.ts` owns confirm, busy, errors and open/dismiss. A renderer
only draws the buttons and gives the host's `activity-control` service
(`lib/plugins/activityControl.ts`).

Enter and `o` only ever open a session, so one stray key cannot approve.
**Nothing here sends a prompt**: draft actions open the session and add the text
to its composer once that composer is on screen, or give up after a few seconds.
Actions that end work or widen permissions need a second press. Replies go
through the `permissions` application service, which sends the same actions the
transcript's cards send. Project state (`repository` service) is read at most
every 30 seconds, only while the app is focused and only for the selected
conversation's directory.

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
