Reader cache retention experiment — rejected

Source: existing uncommitted Windowing Reader worktree. Bun 1.4.2,
hermetic realistic 10k-message / 120-session fixture. Existing unrelated changes
were preserved. Candidate removed after serial comparison showed slower frames.

Problem: reader-local WeakMap keys stay live while delivery caches own an entire
session. Traversal accumulates derived body/diff/display data and React variants.
Candidate: bounded weak-key LRU caches (480 entries each, two mounted windows)
for stable card data, landmarks, display data and React element variants.

Command (each run in a fresh process, serial before then after):
INPUT_SCENARIO=scrollback-wheel-sustained INPUT_MEMORY=1 INPUT_JSON=1 bun tui/opentui/inputPerf.tsx
Default sustained window: 40 seconds. 5006 visible cards, 240 mounted.

                         baseline       candidate
cards crossed              2442           2346
slides                      222            213
frame p50 ms               2.51           3.02
frame p95 ms              10.69          13.69
React render total ms      1476           1813
frames over 8.33ms          188            238
commits over 8.33ms          13            105
heap before bytes     140376294      141343914
heap after bytes      147537674      144028271
heap growth bytes       7161380        2684357
RSS after bytes       601899008      598474752

Heap growth improved but render timing regressed. An earlier overlapping pair
showed faster timing; that evidence was confounded and is not accepted. Do not
ship this implementation. Next candidate should avoid LRU mutations on every
card cache hit; consider pruning at window boundaries while preserving overlap.

Validation performed on candidate: both typechecks, git diff --check, LRU parity
(including 10k live keys), and stream reader-window smoke passed. Stream smoke:
122 slides / 6953 rows, zero displaced rows, zero root renders. React Doctor was
unavailable offline (ENOTCACHED). Timing measures test-renderer frame production,
not terminal paint. Heap is forced-GC retained renderer JS heap, not worker heap.
Strict sustained-scroll frame gate fails on both snapshots. Overall goal open.

Existing composer-window-type scenario: 53 frames, p95 4.60ms, worst 4.94ms,
zero over-budget frames/commits. This establishes a focused current-worktree
baseline, not a before/after improvement from this experiment.
