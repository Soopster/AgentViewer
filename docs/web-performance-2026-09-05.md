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
| Scroll, jump, follow-tail, resize, density, tool expansion | Headless 2,000-event search/view/scroll matrix passes; wheel-to-follow race fixed; resize/expansion coverage pending |
| Live tokens, tool updates, persisted handoff, idle polling | Stream preview helper live-update benchmark passes; full pipeline pending |
| Composer typing, drafts, queue, attachments, commands | Synthetic typing passes with no long tasks; queue/attachments/commands browser coverage pending |
| Transcript search, bookmarks, filters, project feed | Preview filter/reorder correctness checked; browser workloads pending |
| Large markdown, code, diffs, images, nested subagents | 10,000-line tool-output browser workload passes; bounded height counting implemented; broader renderer/expansion coverage pending |
| Git, file/editor, terminal/browser side panels, split views | Browser baseline pending |
| Analytics, command palette, coordinator and fleet surfaces | Browser baseline pending |
| API/session polling and search across all providers | Provider-specific harnesses exist; web end-to-end and concurrent request measurements pending |
| Memory after long streams, scrolling, switching sessions | 12 alternating-session GC snapshots recorded; extended streaming/panel memory and DOM drift investigation pending |

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
and the documented discovery returned an empty list. The interactive browser remains unavailable. Isolated headless Chromium was
subsequently available for synthetic production-UI tests; no user browser
profile or real session data is used. Builds and helper measurements also remain available.

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

## Production browser matrix and wheel fix (2026-09-06)

`node scripts/webBrowserPerf.mjs` now runs an isolated Chromium context against
a local production build. All API calls receive synthetic responses; non-local
network requests are blocked and no live provider sessions are touched. Set
`PLAYWRIGHT_CHROMIUM_EXECUTABLE` to an installed headless Chromium executable,
`WEB_PERF_ORIGIN` to the local server (default `http://127.0.0.1:3107`),
`WEB_PERF_ROWS=500`, `WEB_PERF_MESSAGES=2000`, and `WEB_PERF_CONTENT=text` or
`mixed`. Mixed fixtures include Bash tool-use/result pairs and Markdown/code.
The messages endpoint honors offset/limit/tail, so larger configured histories
still open the same bounded tail that production requests. This is not a test
of loading the entire larger history.

The harness checks startup, sidebar filtering, transcript open, composer input,
transcript search/clear, and Stream/Agents/Continue/Full mode changes. It sends
12 real wheel inputs per view and asserts both departure from the tail and
readable content intersecting the viewport. rAF intervals measure browser frame
cadence; typing timing deliberately includes two frames and automation overhead
and is not an INP measurement. Long tasks are collected with PerformanceObserver.

Repeated runs exposed a real race after a view change: upward wheel input could
remain at the tail (72 px bottom gutter) while row-height settlement repeatedly
aligned it. Scroll-event suppression delayed auto-follow cancellation. The wheel
handler now clears programmatic suppression and cancels auto-follow immediately
on upward input. This prevents layout work from taking control back from the
user's gesture. Absolute scrollTop is not a correctness gate because row-height
compensation legitimately changes it; tail distance and visible content are.

After the fix, all six complete runs passed (three per content type, 84 workload
observations, 24 scroll cases). Every upward gesture left the tail by at least
8,396 px. No scrolling long tasks occurred. There were three transcript-opening
long tasks of 52, 54, and 63 ms; opening performance remains an explicit open item.

| Content | View | Runs | rAF p95 ms | Maximum ms |
| --- | --- | ---: | ---: | ---: |
| text | stream | 3 | 17.4 | 34.1 |
| text | agents | 3 | 17.3 | 33.5 |
| text | cont | 3 | 17.3 | 17.7 |
| text | full | 3 | 17.4 | 17.7 |
| mixed | stream | 3 | 17.3 | 17.5 |
| mixed | agents | 3 | 17.2 | 17.7 |
| mixed | cont | 3 | 17.4 | 17.7 |
| mixed | full | 3 | 17.1 | 17.6 |

These results establish a focused Chromium synthetic workload, not all-browser
or all-workload completion. Two text scrolling cases included a roughly 33–34 ms
frame; no claim of a strict 16.67 ms frame gate is made. Real provider streaming,
large-history loads, resize, expansion, side panels, retained memory and other
matrix gaps above still need measurement. Production build, OpenTUI type check,
virtualizer correctness and diff hygiene passed. React Doctor reported the same
three MessageView complexity warnings, with no errors or remote score.

## Bounded tool-height work and memory sampling (2026-09-06)

The browser harness supports `WEB_PERF_PROFILE=/tmp/open.cpuprofile` to sample
opening CPU work. One mixed-content opening profile attributed about 11.4 ms
of sampled self time to `estimateGenericToolResultHeight`; much of the total
automation duration was idle, so it must not be treated as CPU time. The
estimator split full outputs into arrays just to determine whether collapsed
previews exceeded 20 or 25 lines.

`countLinesUpTo` now scans only enough newline boundaries for that decision.
Generic results only compute the one-nonempty-line special case for strings
shorter than 140 characters, where that case can apply. The height and hidden
line decisions are unchanged, including empty text and trailing newlines.
`node --import tsx scripts/webLineCountPerf.ts` checks CRLF, Unicode text,
preview boundaries and 1,000 deterministic randomized inputs against the
original split behavior. The timing below uses five warmups and 20 samples;
it measures this helper, not end-to-end opening.

| Output lines | Before p95 ms | After p95 ms |
| ---: | ---: | ---: |
| 100 | 0.001625 | 0.000417 |
| 10,000 | 0.230083 | 0.000375 |
| 1,000,000 | 35.308459 | 0.000334 |

The production browser run with `WEB_PERF_MESSAGES=200`,
`WEB_PERF_CONTENT=mixed`, and `WEB_PERF_TOOL_LINES=10000` passed all 14 stages
with no long tasks. It includes 50 tool results (about 8 MB of output), search,
view changes and visible-content wheel assertions. Opening was about 451 ms,
search 60 ms and clearing search 64 ms including automation overhead. There
is no before/after browser latency claim for that fixture.

`WEB_PERF_MEMORY=1` adds 12 alternating selections of two distinct synthetic
sessions, waits for the expected session's transcript, runs V8 garbage collection,
and records heap plus DOM counters. The final-source 2,000-event mixed run used
15,590,596–17,213,412 bytes of collected JS heap. The last first-session snapshot
was 16,062,420 bytes versus 16,265,148 on its first return; documents remained
at one. This short run shows no sustained heap rise, not absence of every leak.
DOM counters vary with mounted rows and show a small drift across returns;
longer runs with settled-layout snapshots remain necessary. The measurement
does not cover process RSS, uncollected peaks, provider runtimes, streams or
other panels.

Production build, web and OpenTUI type checks, helper parity and browser checks
passed. React Doctor still reports three MessageView complexity warnings, with
no errors or remote score. The full workload objective remains incomplete.
