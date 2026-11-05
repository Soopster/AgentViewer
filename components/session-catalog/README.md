# Session catalog

`useSessionCatalog` owns the list resource: messages are handled separately by
`session-reader`. It exposes stable actions to load a query, refresh the current
query, apply an optimistic update, and cancel an obsolete request.

`useSessionCatalogQuery` binds that resource to provider, provider instance,
project scope, and worktree settings. Keeping binding separate lets the page
derive the active project from a selected catalog session without making the
resource depend on navigation. Provider bootstrap enables this binding once;
project navigation must not rerun provider restoration.

Query changes cancel the old request. Repeated requests for an in-flight query
share one promise. Background polling runs every five seconds while visible and
keeps the existing list on transient errors. A successful refresh clears a prior
load error. Explicit `refresh(false)` requests report errors and loading state;
automatic polling and ordinary `refresh()` calls remain silent. Optimistic updates invalidate requests started before the edit.
Request identity and abort guards reject late responses even when cancellation
arrives after a response is already available.

Plugin and mutation callbacks call `refresh`, which reads the current query at
execution time. They must not capture a past query and call `load` after
navigation. Actions become inert after unmount.

The model compares complete immutable session metadata and identifies sessions
by provider, provider instance, and native session ID. It retains object identity
on unchanged polls while respecting incoming list order. Open-tab synchronization
preserves tab order and tabs absent from the current catalog query.

`actions` defines the shared rename, tag, and delete completion contracts. Every
callback carries a full session identity rather than a native session ID alone.
Metadata patches preserve unrelated objects and are applied to catalog, tab,
project, and dashboard copies by the page. Targeted catalog mutations for another
provider instance leave the active query alone.

Delete completion removes the source identity and checks current navigation at
completion time. The page supplies a committed-selection ref to that check so a
request started on one tab cannot close a subsequently selected tab. The HTTP
delete action lives in `message-view/actions/deleteSession`, separately from
unrelated transcript actions.

Checks:

```sh
node --import tsx scripts/webSessionCatalogSmoke.ts
node --import tsx scripts/webSessionIdentityActionsSmoke.ts
node scripts/webSessionCatalogBrowserSmoke.mjs
npx tsc --noEmit
```

The Chrome fixture runs real hooks under StrictMode with mocked HTTP responses,
including responses that deliberately ignore abort signals. It is not live
provider validation.

`selectionKey` preserves the shared web selection-key contract for the sidebar,
command palette, tab bar, dashboard, and navigation model. Configured instances
must retain their own selected row and close target even when native session IDs
match. Domain mutation matching still uses the canonical session identity helper.

```sh
node --import tsx scripts/webSessionSelectionSmoke.tsx
```
