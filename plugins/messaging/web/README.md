# Cross-session messaging

The standalone `/agents` route and the dashboard embed compose the same
`MessagingWorkspace` presentation and `useCrossSessionMessaging` state owner.
The workspace consumes a typed model and does not depend on route files or URL
APIs. Client-safe wire types live in `lib/crossSessionMessagingTypes`; the server
transport retains its existing type exports for compatibility.

`StandaloneMessaging` adds the full-page navigation and owns manual recipient
changes in the URL. Its initial recipient and query updates come from the
declared `page-location` capability. `CrossSessionMessaging` is the embedded
variant: it adds
no page navigation or main landmark and leaves the host route query untouched.

The data hook owns discovery, recipient selection, the draft, and delivery:

- Discovery polls every five seconds while visible and deduplicates overlapping
  refreshes. Visibility changes and unmount abort requests and fence late results.
- Delivery is serialized with a synchronous request guard. Changing recipients
  while a send is pending prevents that result from clearing the current draft
  or publishing feedback for the previous destination.
- Draft revisions protect newer text from an earlier successful send. Failures
  retain the draft. Discovery errors are separate from delivery feedback.
- A nonempty draft installs the unload warning; empty drafts release it. Aborting
  on unmount fences UI updates but does not imply a server-side send was undone.

The browser fixture exercises real standalone and embedded components under
StrictMode with mocked discovery/delivery responses:

```sh
node scripts/webMessagingWorkspaceBrowserSmoke.mjs
node --import tsx scripts/crossSessionMessagingSmoke.ts
npx tsc --noEmit
npm run tui:check
```

These checks cover UI lifecycle and transport contracts, not live-provider delivery.

The production composition check starts the built Next.js app on a temporary
loopback port, intercepts its API calls, and visits the standalone route,
embedded dashboard messaging, dashboard navigation, and a session transcript:

```sh
npm run build
node scripts/webProductionCompositionBrowserSmoke.mjs
```

It verifies the real route/client boundary with mocked providers and closes the
browser and server when finished.

The feature lives in `plugins/messaging/` and exports a shared manifest. Its Web
entry is loaded by `components/shell/pluginViews.ts`. The dashboard tab, sidebar
launcher and palette command derive from `dashboards` and `webDashboard` metadata.
The `/agents` route uses the generic `PluginPage` host; no feature component is
imported into the route or the main page.

Both renderer adapters consume `PluginMessagingService`. The Web shell supplies
HTTP and the TUI shell supplies the service facade. Recipient selection and the
draft use host-scoped state so moving the view retains them. Closing/disabling
cancels presentation-owned requests; a delivered agent turn remains runtime-owned.

Discovery supplies a qualified `address` in addition to the native `sessionId`.
Use `addressableSessionKey()` to select and deliver, and include `fromAddress`
when excluding a sender. Native IDs and display names may be ambiguous across
providers or configured accounts. The server refuses ambiguous legacy IDs.
