# Viewer navigation

`model` defines one exclusive location: empty, session, project feed, or dashboard.
Tabs and sidebar scroll requests are retained alongside that location. Message
anchors belong to session locations; dashboard context belongs to dashboard
locations. A single transition cannot leave a project selected alongside a tab.

`useViewerNavigation` adapts the pure reducer to React. Rendering consumes the
reducer snapshot. Imperative event checks consume a mirror of the latest intent,
including updates queued inside `startTransition` before React commits them.
Cleanup effects also consult the latest intent so an intermediate empty render
cannot cancel a resource already loading for a pending selection. This prevents
a delayed delete or materialization event from acting on a tab
that navigation has already left. The reducer is pure; computing an intent does
not issue requests or mutate external state.

The page continues to coordinate I/O: it adopts the selected provider, loads or
clears the transcript resource, and applies catalog mutations. Navigation actions
own tab merging, close fallback, sidebar reveal requests, dashboard context,
project metadata, and materialization. No component receives navigation setters.

Catalog synchronization preserves open tabs outside the current query. Metadata
patches and removals use full provider-instance identities. Materialization
updates pending copies and deduplicates an already-discovered destination without
stealing focus from another session. Project responses update only the matching
current project location.

The web renderer's existing row/tab key format is preserved. Domain mutation
matching uses `sessionIdentityKey`; these are separate contracts.

```sh
node --import tsx scripts/webViewerNavigationSmoke.ts
node scripts/webViewerNavigationBrowserSmoke.mjs
npx tsc --noEmit
npm run build
node scripts/webProductionCompositionBrowserSmoke.mjs
```

The focused Chrome fixture checks rendered content under StrictMode, including
several actions queued before a transition commits. The production composition
check runs actual routes with mocked APIs; neither is live-provider proof.

Long-running UI operations can capture an intent predicate. User navigation and
explicit intent invalidation make that predicate false; catalog metadata updates
do not. Session creation uses this to retain a late-created tab without stealing
focus. Intent predicates and action callbacks become inactive after unmount.
