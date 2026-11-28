# Transcript performance contracts

## Ownership and refresh

`TranscriptSessionLoader` owns workspace transcript payloads and coordinates
visible observers. Views of the same session, density and tool visibility share
reads and publications. Its single refresh loop prioritizes foreground work and
yields background work during a foreground open. Revision checks skip unchanged
idle transcripts; active or revisionless transcripts continue refreshing.

`RetainedWindow` separates visibility from process lifetime. Hiding commits once
to release presentation effects, then freezes parent props until resume.
`useWindowSnapshot` suspends external-store subscriptions while hidden and reads
the latest snapshot on resume. Provider sessions, terminals and process stores
continue running. New presentation timers and subscriptions must respect
`useWindowVisible`; do not tear down backend resources merely to hide a window.
Git review polling and heartbeats also follow visibility: hiding closes that
view's review lease, and resuming reads the shared review and republishes the
current patch. Other clients and the shared review store continue running.

Window chrome stores belong to a workspace runtime. They can retain native
styles and render closures, so they must never be process-global.
`useTranscriptWindowChromeHost` publishes committed chrome and releases only its
own workspace's stores on replacement or unmount. `useTranscriptCards` and
`usePinnedSessionDetail` own source-observer and formatting lifetimes. Their
results are scoped to instance and display variant before a frame commits, so
late completions cannot expose a previous source while a new one is loading.

`transcriptWindowInput` decides the focused transcript's commands. The app
executes those commands after resolving dialogs, window controls, composer and
interactive-diff capture. Key policy is independent of state setters and provider
effects; modifier and fleet/search precedence have focused coverage.

## Rendering and position

`RowHeightIndex` maintains measured terminal heights and offset lookup.
The outer reader sizes its card working set by rows with a card-count safety
cap. A final window always includes the actual transcript tail, even when its
first card alone exceeds the row budget.

`VirtualTranscriptRows` shares the parent scrollbox and uses spacers to retain
the complete content extent. Only visible rows and overscan own native nodes.
Measured heights are keyed by source row and geometry. Changes above the visible
anchor compensate the scroll offset. Native source-block IDs allow window
restoration to find the same block after earlier heights change.

Tab/window snapshots retain follow-tail, card anchors, row offsets and optional
source-block anchors. Capture the latest committed visible state before hiding;
zero-sized hidden geometry must not overwrite it. Restoration waits for native
layout and asynchronous block parsing before releasing the anchor hold.

Large diffs virtualize individual rows. `SelectableMarkdown` delegates document
parsing to a worker and rendering to `StructuredMarkdown`. Blocks containing more
than 2,048 code lines, list items or table body rows receive inner virtualization.
Smaller structured blocks keep the native path: profiling showed that replacing
medium native blocks with many React rows could cost more than it saved.

Code captures come from a whole-source syntax parse, preserving multiline comments,
strings and injections, then partitioning captures in the Markdown worker. Native
text content is built only for mounted slices. Code syntax markers remain visible,
matching native `concealCode: false`. The serial code queue shares consumers and
removes obsolete queued versions; an already active parse finishes off-thread,
but an abandoned result never reaches a view. Completed parses belong to views,
and hide/resume reuses them when the source has not changed.

Lists retain native marker, indentation and task-checkbox rendering per item.
Tables compute global column widths from serializable inline runs, then mount
only visible rows with the same text, styles, wrapping and borders. Their
selection owner preserves native single-cell, column-lock and tab-separated grid
copying across mounted cells. It uses public selection APIs and owns no global
native resources.

Structured documents can render beyond the former 80,000-character guard.
Unstructured prose retains that guard. Quotes, very long individual physical
lines/items, and documents with reference definitions retain semantic/native
fallbacks rather than being split at arbitrary characters. Reference definitions
are intentionally kept together because the current native renderer exposes them
in its rendered source. These fallbacks are not a hard bound on all native memory.

## Memory

`SessionCacheBudget` coordinates eviction across main-thread cache owners with
a 128 MiB estimated payload budget. The threading worker independently uses a
96 MiB budget. The workspace loader also limits warm entries to eight and
estimated payloads to 64 MiB. Visible observers pin source baselines until release.

These are warm-cache limits, not hard process RSS limits: visible data can exceed
them, and native allocations are separate. Payload estimates travel from the
worker and avoid invoking lazy card getters. Missing delta baselines must recover
through full delivery. `sessionIdentityKey` includes provider instance, provider
and native session ID throughout caches, windows, activity and workspace moves.
Default connection keys retain their persisted `provider:sessionId` form;
configured connections use `provider@encodedInstance:sessionId`. Internal delivery
variant and queue keys are JSON tuples, so native ID delimiters cannot alias
variants or prefix-match a different session during eviction. Live UUIDs are
also scoped to their owning instance. Ambiguous old custom-instance keys are not
adopted into a different connection's cache.

## Focused verification

Run `npx tsc --noEmit`, `npm run tui:check` and `git diff --check`.
Run the Bun smokes for row heights, cache budgets, transcript broker, Markdown
queue/parity, window activity, virtual rows, live tail, tab reader position,
window parity and large diff/Markdown rendering after touching these contracts.

`npm run tui:architecture:check` runs both typechecks and the focused contract
suite sequentially, with each native scene in its own process. Large diff and
Markdown cases must keep fewer than 700 native nodes mounted at the top,
middle and tail while retaining their full scroll extent. The 3,000-line code
fixture also requires nonzero measured mounted source under 16 KiB. This is a
source-payload metric, not a native allocation or RSS measurement.
Hidden-window cases require
zero transcript refreshes/subscriptions and zero Git review polls/heartbeats.
The shell case covers 80, 120 and 200 columns plus a long draft at 100x24.

Use `npm run tui:architecture:check -- --report /tmp/tui-architecture.json`
to retain a machine-readable receipt with source revision, dirty status,
Bun version, check outcomes and renderer metrics. By default, timing is reported
without a machine-dependent pass/fail threshold. On an otherwise idle benchmark
machine, `TUI_ARCHITECTURE_P95_MS=8.33 npm run tui:architecture:check` additionally
requires all large-content cases to stay within that renderer-loop p95 budget.
This includes initial mount and viewport-change frames; it is not a sustained
scrolling or physical terminal paint benchmark. Do not run concurrent benchmarks
when using this timing gate.

Git fixtures must set `AGENT_VIEWER_REVIEW_DIR` to a disposable writable directory
instead of writing the user's review database. A failed review-store write must
not be mistaken for a missing virtual annotation or incorrect row geometry.

Large-content benchmarks must distinguish mounted native nodes, renderer-loop
timing, JS heap and RSS. Renderer-loop samples do not prove physical terminal
paint time. Tail and restoration correctness must pass before interpreting a
smaller mounted working set as a performance improvement.
