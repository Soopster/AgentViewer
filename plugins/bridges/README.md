# Bridge plugin

The CLI channel and IDE bridge share one manifest and renderer-specific views.
Web views receive `ChannelBridgeViewService` or `IdeBridgeViewService` from
`lib/plugins/bridges.ts`. These are controller snapshots, plus theme accent and
an `acquireView()` lease. Keep the lease function stable across snapshots.

The host owns each transport, durable delivery and composer routing. A view
retains presentation interest only while mounted. Disabling or closing it
releases that interest; it does not change `routeComposer`, reject outstanding
approvals or terminate an external agent. A routed transport stays active.

Drafts, connection-settings visibility and IDE review selection use the host's
scoped view state, so moving a view preserves them. Each activation owns a
resource scope. Late send/approval callbacks cannot mutate a replacement view.
The IDE review prefers the composer's `attachContext` capability for structured
diff comments and falls back to `insertText` when attachment is unavailable.

Routing toggles are executable plugin commands through the shared
`bridge-routing` command service. The same handlers serve Web and OpenTUI;
missing capabilities and unsupported providers refuse locally. Turning the
plugin back on never replays a send or toggles a route by itself.

Verification:

- `bun scripts/pluginBridgeCommandSmoke.ts` checks the shared command handlers.
- `node scripts/webBridgePluginBrowserSmoke.mjs` renders the actual plugin host
  and views against a controlled transport. It checks presentation leases,
  relocation state, provider-instance changes, pending-send cleanup, routing
  survival, permission responses and structured diff comments. The low-level
  diff renderer is stubbed; this is not a live bridge/provider test.
