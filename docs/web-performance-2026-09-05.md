# Web performance work

The goal remains performance improvement across all meaningful web workloads.
This is an in-progress evidence ledger, not a claim that the goal is complete.

## Workload coverage

Measure a production browser build, keeping transcript contents and UI behavior
equivalent. Record cold and warm latency, p50/p95 interaction duration, long
tasks, mounted DOM size, and retained heap after repeated session switches.
Use empty, small (100), medium (1,000), and large (10,000) datasets where relevant.

| Workload | Current evidence / remaining work |
| --- | --- |
| Initial load and hydration, initial JavaScript | Production build passes; initial JavaScript reduced by 89,689 bytes (26,340 gzip); browser hydration baseline pending |
| Session list, projects, tags, search, session switching | Indexing and time-order helpers measured at 100/1,000/10,000 sessions; mounted sidebar/browser baseline pending |
| Conversation, Full, Stream, Agents transcript views | Stream preview helper measured; other derivations and actual rendering pending |
| Scroll, jump, follow-tail, resize, density, tool expansion | Existing virtualizer correctness smoke passes; browser latency/geometry pending |
| Live tokens, tool updates, persisted handoff, idle polling | Stream preview helper live-update benchmark passes; full pipeline pending |
| Composer typing, drafts, queue, attachments, commands | Existing composer harness available; browser measurement pending |
| Transcript search, bookmarks, filters, project feed | Preview filter/reorder correctness checked; browser workloads pending |
| Large markdown, code, diffs, images, nested subagents | Large tool-output previews measured; renderer and expansion workloads pending |
| Git, file/editor, terminal/browser side panels, split views | Browser baseline pending |
| Analytics, command palette, coordinator and fleet surfaces | Browser baseline pending |
| API/session polling and search across all providers | Provider-specific harnesses exist; web end-to-end and concurrent request measurements pending |
| Memory after long streams, scrolling, switching sessions | Preview cache uses weak keys and bounded strings; retained-heap measurement pending |

For interactive browser work, use 16.67 ms as a frame-work diagnostic threshold
and report end-to-end input latency separately. A helper passing that threshold
does not establish smooth browser rendering. Cold loading needs separate latency
measurement and should not monopolize the main thread.

## Implemented: Stream history preview reuse

Stream history previously formatted and normalized every historical message
when the live suffix changed. The new builder caches a small preview per
immutable threaded message. Replaced messages are refreshed even when their UUID
is unchanged. Row keys, badges, positions and turn labels remain derived from
the current rows. Weak keys allow discarded sessions to be collected.

Normalization now reads a bounded prefix, expanding only when whitespace makes
the prefix insufficient. Cached strings are copied to avoid retaining full tool
output backing storage. The copy-text formatter was moved unchanged from
MessageView into `lib/threadedMessageText.ts`, so the benchmark uses production
formatting. Copy and search behavior are unchanged.

Run `node --import tsx scripts/webStreamHistoryPerf.ts`. It compares the previous
production derivation with the current helper over text/tool fixtures at
100/1,000/10,000 rows, for cold construction, unchanged prefixes, and fresh live
messages. Each timing uses five warmups and 30 samples. Assertions cover exact
output equality, same-UUID replacement, filter/reorder, badge changes, empty
messages, Unicode whitespace, surrogate pairs and preview boundaries. These
are synthetic Node measurements, not browser frame rates.

The first bounded-normalization attempt regressed cold text construction. The
current chunked approach replaced it after measurement. Large cold histories
still exceed a frame budget; making initial previews progressive remains open.

## Validation

- Timeline virtualizer correctness and `git diff --check` passed.
- Web/OpenTUI type checks now pass. Added an explicit `assert.ok(info)` to
  the concurrently added Copilot smoke, checking its required session-info
  assumption and resolving the nullable-value type error.
- Registry-based latest React Doctor invocation failed with `ENOTFOUND`.
  Installed Doctor completed without remote scoring: three complexity warnings
  on the selected MessageView/helper files; changed-scope scan reported one
  complexity warning in MessageView. No clean score is claimed.
- Concurrent Copilot changes exist, including in MessageView. This work does
  not commit or revert them.

## Measured helper timings

p95 milliseconds from the completed local run (2026-09-05).

| Workload | Content | Rows | Before | After |
| --- | --- | ---: | ---: | ---: |
| stable-prefix | text | 100 | 0.557 | 0.010 |
| cold | text | 100 | 0.557 | 0.370 |
| live-update | text | 100 | 0.642 | 0.005 |
| stable-prefix | tool | 100 | 3.014 | 0.015 |
| cold | tool | 100 | 3.014 | 0.657 |
| live-update | tool | 100 | 2.908 | 0.002 |
| stable-prefix | text | 1,000 | 6.023 | 0.033 |
| cold | text | 1,000 | 6.023 | 3.530 |
| live-update | text | 1,000 | 5.630 | 0.034 |
| stable-prefix | tool | 1,000 | 31.212 | 0.059 |
| cold | tool | 1,000 | 31.212 | 4.741 |
| live-update | tool | 1,000 | 31.426 | 0.068 |
| stable-prefix | text | 10,000 | 56.456 | 0.491 |
| cold | text | 10,000 | 56.456 | 40.164 |
| live-update | text | 10,000 | 94.252 | 0.491 |
| stable-prefix | tool | 10,000 | 317.350 | 0.390 |
| cold | tool | 10,000 | 317.350 | 48.564 |
| live-update | tool | 10,000 | 306.682 | 0.246 |

## Implemented: Sidebar indexing and time sorting

Moved existing data derivations unchanged into `lib/sessionListModel.ts`, then
added reuse of indexed metadata for immutable session objects. Cache population
is deferred until the first list update, preserving the original cold project
indexing path. Time sorting parses each timestamp once per row instead of twice
per comparator call. Timestamp parsing happens only when time mode is requested.
Project grouping and child nesting behavior remain unchanged.

Run `node --import tsx scripts/webSessionListPerf.ts`. It retains the original
indexing/sort code as its baseline and verifies exact order, project-run headers,
keys, invalid dates, timestamp precedence, cache replacement, search/tag filters
and child grouping. Five warmups and 30 samples per timing; Node helper timings
only. The initial eager timestamp/cache design regressed cold project indexing
and was replaced with deferred timestamp/cache work after measurement.

| Workload | Sessions | Before p95 ms | After p95 ms |
| --- | ---: | ---: | ---: |
| poll-index | 100 | 0.153 | 0.013 |
| time-order | 100 | 0.196 | 0.053 |
| cold-index-and-time | 100 | 0.258 | 0.153 |
| cold-index-project-mode | 100 | 0.126 | 0.112 |
| poll-index | 1,000 | 0.830 | 0.013 |
| time-order | 1,000 | 2.457 | 0.874 |
| cold-index-and-time | 1,000 | 4.873 | 1.429 |
| cold-index-project-mode | 1,000 | 0.840 | 1.293 |
| poll-index | 10,000 | 7.528 | 0.156 |
| time-order | 10,000 | 29.661 | 8.023 |
| cold-index-and-time | 10,000 | 42.379 | 15.105 |
| cold-index-project-mode | 10,000 | 7.478 | 7.564 |

Installed React Doctor reports two complexity warnings in SessionList and no
errors in the extracted helper. No remote score was requested.

## Browser availability

The browser runtime initialized, but selection returned `No browser is available`
and the documented discovery returned an empty list. Browser performance work
remains unverified; a request to connect the browser is pending. This does not
block builds or pure data-processing measurement.

## Implemented: Deferred HTML export renderer

The main page eagerly imported the HTML renderer, Markdown parser and export
styles only to reach its download helper. Normal exports already run in a
worker. `downloadHtml` now lives in a small standalone module (re-exported from
the original API for compatibility), and the no-worker fallback dynamically
imports the renderer when an export is requested. That fallback shows export
progress and handles import/render errors. Worker rendering remains unchanged.

Two successful production builds provide the before/after measurements below.
`node scripts/webBuildStats.mjs` reads script references from the emitted index
HTML, deduplicates them and excludes `nomodule` scripts from modern totals.
Gzip sizes are computed locally; these are emitted sizes, not measured browser
network transfers or hydration timings.

| Modern initial scripts | Before | After | Reduction |
| --- | ---: | ---: | ---: |
| Files | 11 | 10 | 1 |
| Bytes | 1,405,120 | 1,315,431 | 89,689 (6.4%) |
| Gzip bytes | 391,907 | 365,567 | 26,340 (6.7%) |

Validation on the final source: production build, web/OpenTUI type checks and
`git diff --check` pass. `node --import tsx scripts/webExportSmoke.ts` verifies
HTML formatting/escaping, the existing download export API, exact Blob contents,
filename, click and object-URL cleanup. This does not replace browser testing of
the asynchronous fallback. React Doctor continues to report the same three
MessageView complexity warnings, with no errors or remote score.
