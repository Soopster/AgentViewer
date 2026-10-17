# TUI performance work — 7 September 2026

## Preview formatting

`compactLines` now scans the text without splitting and retaining a normalized
copy of every hidden preview line. Card compaction retains only visible rows
and reuses unchanged line objects. Hidden rows still receive the same
normalization, preserving exact hidden-line counts. Expanded output is intact.

`formatCompactionSmoke.ts` compares the complete serialized cards against a
SHA-256 oracle generated with the previous formatter, for all three densities,
long text, whitespace, ANSI, thinking, code fences and Bash output.

Full transcript pipeline benchmark (`npm run tui:perf`, Bun 1.4.0, macOS arm64),
median total milliseconds:

| Messages | Split panes | Before | After |
| --- | --- | --- | --- |
| 100 | 0 | 0.92 | 0.86 |
| 100 | 1 | 1.65 | 1.64 |
| 100 | 2 | 1.81 | 1.81 |
| 1,000 | 0 | 6.29 | 6.13 |
| 1,000 | 1 | 12.38 | 12.68 |
| 1,000 | 2 | 27.82 | 26.47 |
| 10,000 | 0 | 73.97 | 59.86 |
| 10,000 | 1 | 96.73 | 74.61 |
| 10,000 | 2 | 118.54 | 91.70 |

At 10,000 messages, median peak heap-total deltas changed from
22.56/23.41/26.94 MB to 21.58/23.46/24.71 MB. This is allocation evidence,
not proof of lower process RSS or reduced retention across every workload.
Input profiling was running concurrently, so timing differences need isolated
confirmation before treating them as precise speedup estimates. A long-text
probe also showed lower sampled heap pressure, but its GC timing makes it
unsuitable as a retained-memory claim.

Validation passed: web and OpenTUI type checks, full card compaction oracle,
worker initial/append/mutation/truncation/TaskList/eviction output parity,
and scroll state/window correctness. The scroll harness measures state work;
it does not prove rendered frame latency.

The worker retention test plateaued: 27,290,754 bytes after 10 sessions,
27,186,127 after 20, and 27,224,029 after 40 (2,000 messages per session).
This confirms bounded retention for this fixture, not a before/after reduction.

## Remaining responsiveness work

The full input matrix was started before the formatting edit; later isolated
scenario processes can see the edit. Treat this as diagnosis, not a clean
before/after comparison. Observed outliers include reader expansion (92 ms),
expanded composer typing (43.3 ms), sidebar scrolling (24 ms), and reader
end jumps (16.4 ms). Several other surfaces exceeded 8.33 ms occasionally.
The broad goal remains active; no claim of 120 FPS or across-the-board memory
reduction is justified.

Next: profile expansion invalidation in `App.tsx` (`resolvedExpandedKeys`,
`cardDisplayData`, `transcriptCardVariants`) and expanded composer typing;
repeat the complete input matrix after any fixes. Keep Windows/WSL portability
and rendered transcript/scroll behavior intact.

A concurrent workspace commit (`2c0b474`) included the formatter change,
regression check, and two temporary baseline files during measurement. The
baseline files are removed in the worktree; they are not production artifacts.

## Lazy selection elements

The complete diagnostic matrix finished: 95 commits exceeded 8.33 ms, with no
skipped scenarios. Stacked split readers had 61 over-budget frames (95.1 ms
worst). An isolated CPU profile showed root React work and element/prop
construction alongside native layout costs.

Cards previously allocated idle, selected and focused React elements eagerly.
`CardSelectionVariants` now creates each element on first use, retaining stable
identity on revisits. Both the primary reader and split panes use this path.
The card props, native nodes, layout and cursor semantics remain identical.

`bun tui/opentui/cardSelectionVariantsPerf.ts` compares the old eager behavior
and new lazy behavior in separate processes. With 10,000 card-shaped entries,
45 shared props and a single focused card:

| Measurement | Eager | Lazy |
| --- | ---: | ---: |
| Elements created | 30,000 | 10,000 |
| Retained JS heap, forced GC | 26,229,813 bytes | 11,380,953 bytes |
| Construction and initial selection | 65.53 ms | 22.38 ms |

This models selection-cache allocation, not whole-application RSS. The actual
reader window is bounded; cache retention depends on how many cards a user has
visited. Additional states allocate only when visited, and remain cached.

Matched eight-second reader-expansion runs with Bun CPU profiling enabled:
before 27/277 commits over budget, worst 53.31 ms; after 0/304, worst 8.24 ms.
An unprofiled after run also passed (0/304, worst 7.59 ms). Timing remains
machine/load-sensitive; the complete matrix is being repeated and the broad
responsiveness goal remains unproven.

Web/OpenTUI type checks and the enhanced selection smoke pass. The smoke checks
lazy initial allocation, state transitions, cursor/focus identity and revisits.
The installed React Doctor scan reports no selection-module diagnostics, but
reports existing App complexity and unrelated concurrent Coordinator warnings;
its maintainability phase is incomplete. Fetching latest React Doctor failed
with registry DNS resolution, so the installed version was used offline.

## Reader-position capture

Sidebar selection also captures the outgoing reader position. That path now
reuses the scrollbox child array and recognizes card nodes by their existing
`card:` id prefix, avoiding a per-key `Set` of all mounted cards and the
intermediate reversed-array copy. It preserves the same topmost visible-card
anchor and offset. OpenTUI type checking and the transcript selection smoke
pass after this change.

An isolated one-second stacked-split probe stayed within the frame budget
(63 commits, 0 over, 6.7 ms worst). Forced-GC memory snapshots for that mounted
fixture were 43.97 MB heap / 252.8 MB RSS before the timed input and 46.70 MB
heap / 281.8 MB RSS after; this is a diagnostic baseline for future comparison,
not evidence of a reduction by itself.

The latest worker retention run remains bounded and byte-identical: 27,286,503
bytes after 10 sessions, 27,598,639 after 20, and 27,563,621 after 40, with
reported growth of -35,018 bytes from the 20-session checkpoint to the final
checkpoint.
