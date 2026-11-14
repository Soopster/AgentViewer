# Session creation

`useSessionCreation` owns creation I/O, duplicate-request protection, errors,
request cancellation, and the provider-startup loading receipt. It returns the
created session; it does not choose a tab or alter provider selection.

`sessionCreationTarget` resolves a concrete provider and configured instance from
the current provider selection and navigation context. In all-provider mode it
uses the current session's runtime, with Claude as the empty-context fallback.
The target is captured once per request. Server metadata can refine the created
tab; missing instance or project fields retain the requested context.

The page captures a navigation intent before creating. A current result opens the
new session; a result after navigation is retained as a background tab. Starting
an explicit provider switch invalidates that intent before waiting for the server.
Metadata refreshes do not invalidate it. Late errors for an abandoned intent are
silent, and navigation clears an already displayed creation error.

Requests remain serialized until they settle. A synchronous request guard protects
against repeated events before React commits the loading state. Unmount aborts the
request, fences its result, and releases the startup receipt immediately. Aborting
HTTP does not imply that a provider-side session was undone.

```sh
node scripts/webSessionCreationBrowserSmoke.mjs
node scripts/webViewerNavigationBrowserSmoke.mjs
npx tsc --noEmit
npm run build
node scripts/webProductionCompositionBrowserSmoke.mjs
```

The focused Chrome check uses real hooks under StrictMode with mocked HTTP. The
production check visits the real app, completes creation after a newer selection,
and verifies that opening the resulting pending tab does not read an unavailable
transcript. These checks do not create live provider sessions.
