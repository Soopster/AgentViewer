# Transcript data ownership

The page owns navigation, open tabs, project selection, and layout. It consumes
`useSessionTranscript` and `useProjectTranscript` without reading or changing
transcript cursors, cancellation controllers, or message arrays directly.

- Session navigation calls `load(session, optionalMessageId)` and clears the
  project transcript. Pending sessions remain empty without reading the provider.
  A message target loads full history; ordinary navigation loads a bounded tail.
- Project navigation calls `load(dir)` and clears the session transcript. Only a
  current load returns session metadata to the page; cancelled loads return null.
- Closing the last tab, deleting the active session, and switching providers clear
  both resources. Opening a dashboard clears project requests while preserving
  the session transcript used by the dashboard's session context.
- Visibility suspends background streaming and project polling. Each hook releases
  its requests on unmount. Project polling receives primitive query fields, so
  updating the project's session metadata does not restart its timer.

`sessionTranscriptWindow` owns the pure single-session window transition: absolute
server offsets, cursor UUIDs, rewrite recovery, identity reuse, deep-link history,
and the live-tail memory limit. `messageMerge` owns timestamp merging and bounded
retention for the cross-session project feed. Provider order takes precedence over
timestamps within a single transcript.

`transcriptApi` owns HTTP shapes. `messageStream` owns one SSE connection, its
fallback polling, and capped reconnect backoff. `useSessionMessageStream` adapts
that lifecycle to React and keeps streamed plans/todos under the complete provider,
provider-instance, and session identity. No provider runtime SDK is imported by
these client modules.

Cancellation has two layers: abort the I/O and reject obsolete results even when
an already-completed request ignores its abort signal. A previous request's
`finally` block must never reset the loading state of its successor.

Focused checks:

```sh
node --import tsx scripts/webTranscriptDataSmoke.ts
node --import tsx scripts/webSessionMessageStreamSmoke.ts
node scripts/webSessionMessageStreamBrowserSmoke.mjs
node scripts/webTranscriptDataBrowserSmoke.mjs
npx tsc --noEmit
```

Browser fixtures run the real hooks in React StrictMode with mocked transports;
they do not prove live-provider behavior.
