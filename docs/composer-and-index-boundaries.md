# Composer and session index boundaries

Web and OpenTUI compose shared behavior with their own rendering, transport, and
session-bound state. Provider-specific text decoding and submission policy should
be changed in the shared modules first.

| Responsibility | Owner |
| --- | --- |
| SSE framing, common assistant/reasoning text, append/replace interpretation | `lib/composerStream.ts` |
| Provider-gated request fields | `lib/composerSubmission.ts` |
| Retry eligibility, attempt budget, backoff decision | `lib/composerRetry.ts` |
| Session-owned state cells, subscriptions, pending-session rekeying | `lib/composerSessions.ts` |
| Web transport, optimistic state, queue claims, timers | `components/message-view/actions/sendMessage.ts` |
| Terminal transport, pane targeting, timers, live transcript projection | `tui/opentui/app/actions/sendComposerMessage.ts` |

Terminal-only Codex plan/error/realtime interpretation remains an explicit adapter
in `tui/opentui/app/liveStream.ts`. Tool-card assembly and rendering remain local to
each surface. The stream, submission, and retry modules must not import React,
either renderer, or provider SDK runtime clients.

Request preparation does not allocate request IDs or abort controllers. The caller
captures the target session and retains the request ID across retries. A retry
decision never schedules a timer or retargets a send. Output already produced,
exhausted retry budgets, cancellation, and permanent usage limits prevent retries.

Web attachment controls, history actions, and panel preferences have separate hooks
under `components/message-view/slices/`. The queue hook owns queue selection and
send notices/failure state. Persisted composer fields continue using the canonical
`ComposerSessions` contract; do not copy its structural interface into consumers.

## Persistent session index

`lib/sessionPersistence.ts` remains the public facade and owns the connection,
opening promise, serialized writes, signature cache, and legacy JSON migration.
Its existing public exports remain available.

- `lib/session-index/types.ts` holds storage records and the common Node/Bun SQLite
  interface, without runtime dependencies on the facade.
- `schema.ts` owns schema SQL, migrations, metadata operations, and transaction
  rollback. Migration cache invalidation is an explicit callback.
- `analytics.ts` accepts the existing connection and already-filtered sessions.
  It does not open another connection or import the facade at runtime.
- `search.ts`, `provenance.ts`, and `activity.ts` accept an `IndexReader` capability.
  They own query construction and result interpretation, without opening a database
  or consulting environment flags. The facade supplies worker execution with the
  existing synchronous fallback.
- `sessionQueries.ts` shares provider/project filtering, including the worktree
  matching rules. `sessionRecords.ts` decodes persisted session rows.
- `stats.ts` aggregates already-filtered sessions and their tool counts.
- `messages.ts` converts provider messages into index records and aggregates.
  It owns image-data exclusion, duplicate UUID disambiguation, tool-error
  attribution, and prompt/file-edit linkage; it performs no database writes.
- `identity.ts` supplies the provider-instance-aware storage key used by both
  metadata and transcript indexing.
- `rows.ts` holds shared row conversion and batching helpers.

Keep the eval-based dynamic SQLite imports in the facade: they avoid Turbopack
rewriting the native module import. Any future query extraction must use the same
connection and preserve the serialized write/clear boundary.

## Focused verification

```sh
npx tsc --noEmit
npm run tui:check
node --import tsx scripts/composerStreamSmoke.ts
node --import tsx scripts/composerSessionIsolationSmoke.ts
node --import tsx scripts/webComposerQueueSmoke.ts
node --import tsx scripts/sessionIndexCompositionSmoke.ts
node --import tsx scripts/sessionIndexQueriesSmoke.ts
node --import tsx scripts/sessionIndexMessagesSmoke.ts
bun scripts/sessionIndexCompositionSmoke.ts
bun scripts/sessionIndexQueriesSmoke.ts
bun scripts/sessionIndexMessagesSmoke.ts
bun tui/opentui/liveToolStreamSmoke.tsx
```

The index smoke uses disposable storage and exercises the public facade as well
as migration and rollback contracts. The stream smoke covers common provider
events, explicit surface differences, fragmented frames, request field gating,
and retry safety. Neither invokes live providers.

The query smoke covers filtered and metadata-only search, literal SQL wildcard
characters, result limits, worktree matching, provenance suffix checks, activity
ranges, and disabled-index behavior. The message smoke exercises conversion
without a database, including failed edits, image bytes, duplicate UUIDs, and
provider instance identity.
