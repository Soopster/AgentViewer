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

Window chrome stores belong to a workspace runtime. They can retain native
styles and render closures, so they must never be process-global.

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

Large diffs virtualize individual rows. Large Markdown is parsed in a worker
into complete top-level blocks before virtualization. Fences, lists, tables and
quotes remain atomic, and documents with reference definitions retain the native
whole-document path. The existing 80,000-character syntax limit still applies.
The worker shares concurrent identical parses and removes obsolete queued work
when its last consumer aborts. An already active parse finishes off-thread.

## Memory

`SessionCacheBudget` coordinates eviction across main-thread cache owners with
a 128 MiB estimated payload budget. The threading worker independently uses a
96 MiB budget. The workspace loader also limits warm entries to eight and
estimated payloads to 64 MiB. Visible observers pin source baselines until release.

These are warm-cache limits, not hard process RSS limits: visible data can exceed
them, and native allocations are separate. Payload estimates travel from the
worker and avoid invoking lazy card getters. Missing delta baselines must recover
through full delivery. Cache identities currently use provider and session ID;
provider-instance namespacing remains follow-up work.

## Focused verification

Run `npx tsc --noEmit`, `npm run tui:check` and `git diff --check`.
Run the Bun smokes for row heights, cache budgets, transcript broker, Markdown
queue/parity, window activity, virtual rows, live tail, tab reader position,
window parity and large diff/Markdown rendering after touching these contracts.

Large-content benchmarks must distinguish mounted native nodes, renderer-loop
timing, JS heap and RSS. Renderer-loop samples do not prove physical terminal
paint time. Tail and restoration correctness must pass before interpreting a
smaller mounted working set as a performance improvement.
