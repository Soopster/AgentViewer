# Web navigation boundaries

`SessionList.tsx` composes the sidebar, collapsed panels, and scroll-to-session
behavior. `CommandPalette.tsx` composes the command registry, keyboard navigation,
and result groups. Their existing public component APIs remain unchanged.

## Session sidebar

Modules under `components/session-list/` own complete responsibilities:

| Module | Responsibility |
| --- | --- |
| `useSessionListModel.ts` | Debounced/deferred filtering, cached indexing, tags, persisted sort mode, and project/time projections |
| `useSidebarResize.ts` | Drag listeners, frame-coalesced width updates, persistence, reset, and cleanup |
| `SessionRow.tsx` | Memoized session composition, title presentation, and selection |
| `useSessionRowEditing.ts` | Title/tag editor state, keyboard handling, callbacks, and metadata requests |
| `SessionRowMetadata.tsx` | Provider, session ID, and tag presentation |
| `SessionAttentionBadge.tsx` | Teammate attention subscription and badge presentation |
| `SessionInboxControls.tsx` / `useSessionInbox.ts` | Inbox controls and optimistic action/rollback lifecycle |
| `SessionRowGroup.tsx` | Child-session disclosure and on-demand Claude subagent loading |
| `ProjectGroup.tsx` | Memoized project headers, collapse state, and row groups |
| `contexts.ts` | Shared provider-label and teammate-attention contexts |
| `presentation.ts`, `appearance.ts`, `types.ts` | Pure display helpers, static styles, and the canonical component contract |

Keep the indexer stable for the lifetime of the list. The existing shared
`lib/sessionListModel.ts` owns indexing, filtering, and grouping algorithms;
the hook composes them with input state and preferences. Filtering stays derived
from sessions and inputs rather than synchronized through another effect.

Row and project memoization remain at the existing boundaries. Attention changes
reach the badge directly, and inbox updates belong to inbox controls, so neither
needs to update the entire editable row. Editor state remains above the title
and tag fields so switching between them preserves the existing commit behavior.
Session selection continues using provider-instance-aware keys.

## Command palette

Modules under `components/command-palette/` separate search from command UI:

- `searchModel.ts` owns session conversion, identity, ranking, query terms, and
  lossless snippet highlighting.
- `useIndexedMessageSearch.ts` owns the search debounce, abort controller,
  loading/results, and index rebuild status. Closing or changing the query
  cancels both the timer and request. Scope and worktree settings remain explicit
  inputs; search results cannot change the selected session themselves.
- `presentation.ts` owns provider styles and result labels.
- `types.ts` holds component, command-item, and search-response contracts.

The command registry stays in `CommandPalette.tsx` as the single place defining
user-facing commands and keybindings. Selection and result activation also stay
there. Imports of persistence records are type-only, keeping SQLite and provider
runtime clients out of the browser bundle.

These modules use direct imports and do not import their parent components.
Contexts are created once in their owner module. Keep state grouped by feature
and lifecycle rather than building a shared hook containing unrelated controls.

## Verification

```sh
npx tsc --noEmit
npm run tui:check
node --import tsx scripts/webSidebarBoundariesSmoke.tsx
node --import tsx scripts/webSessionListPerf.ts
node scripts/webNavigationBrowserSmoke.mjs
npx react-doctor@latest --verbose --diff
```

The sidebar smoke checks pre-extraction HTML parity for expanded/collapsed,
loading, error, empty, provider-instance selection, and teammate-attention states.
It also checks palette ranking and highlighting. The existing sidebar workload
checks index cache invalidation, filtering, grouping, and time-order parity.

The browser smoke bundles a standalone fixture and serves it on an ephemeral
loopback port. It checks filtering, title/tag commits, inbox rollback, resize
and reset, project-scoped index requests, stale-request cancellation, targeted
message selection, and rebuilding. APIs are mocked and fixture CSS is minimal;
this is interaction coverage, not a full-page visual or live-provider test.
Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` when needed; on macOS it can use installed
Google Chrome.
