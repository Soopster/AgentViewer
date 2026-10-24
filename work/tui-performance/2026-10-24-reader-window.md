Reader window performance and retention

Implemented on top of the pre-existing uncommitted Windowing Reader changes:
- Prune four reader-local WeakMaps after a window commits. Delete departing
  card keys; preserve overlapping card identities. No per-hit LRU bookkeeping.
- Reduce the default mounted window from 240 to 120 cards. All transcript
  history remains accessible through sliding. The existing environment override
  remains available for unusually tall terminals.
- Give the delivery smoke's fake worker the unref method required by the
  pre-existing worker-client change; this restores execution of the fixture.

Bun 1.4.2, real OpenTUI root and scene renderer, hermetic realistic 10k-message /
120-session workload. A CPU profile ranked by sample count put sceneFrameStep
first (1282 samples); layout still visits offscreen mounted cards.

Retention pruning alone, serial 40-second sustained SCROLLBACK traversal:
                       existing WeakMaps     prune at commit
cards crossed               2354                  2346
heap growth bytes        6429188               1863638
heap after bytes       147220598             141500925
frame p95 ms              14.061                14.045
These single runs establish a memory win, not a timing improvement. RSS did not
improve in this pair. The rejected per-read LRU experiment is documented in
2026-10-24-reader-cache.md and is absent from the implementation.

Window-size comparison: three serial pairs, order 240/120, 120/240, 240/120.
Both sizes include pruning, isolating the mounted-window change. Each scenario
runs in a fresh process. No other benchmarks/checks ran concurrently. Per run:
AGENT_VIEWER_READER_WINDOW=<240|120> INPUT_SCENARIO=scrollback-wheel-sustained INPUT_SUSTAINED_SECONDS=20 INPUT_SUSTAINED_MIN_CARDS=600 INPUT_MEMORY=1 INPUT_JSON=1 bun tui/opentui/inputPerf.tsx

Medians across three runs:
                              240 cards       120 cards
whole-frame p50 ms              3.051           2.709
whole-frame p95 ms             13.792          13.665
frames over 8.33ms               121             102
cards crossed                  1034            1196
retained JS heap MiB           134.736         127.847
RSS MiB                       542.875         531.391
React render ms / commit        3.953           4.163

Frame median improved 11.2%, budget violations fell 15.7%, and the reader crossed
15.7% more cards in the same duration. Heap fell 6.9 MiB and RSS 11.5 MiB. Per-
commit React work did not improve: slides are more frequent with the smaller
window. Slow-frame p95 remains nearly unchanged. Do not claim 120 FPS.
Raw paired results: 2026-10-24-reader-window-pairs.jsonl.

These are actual scene/render-to-buffer frame timings, not physical terminal
paint or PTY throughput. Heap is forced-GC renderer JS retention, not worker
heap. RSS includes the process as measured by the harness. Provider I/O is
mocked and has no performance claim here.

Regression validation (current candidate):
- Reader cache lifetime/identity fixture: passed across 10k live keys.
- SCROLLBACK reader-window smoke, 120 cards: passed 158 slides / 7085 rows,
  no displaced rows and zero root renders.
- Transcript loader smoke: passed.
- Transcript delivery smoke: passed with byte-identical output; 10k-message
  suffix clone 4004 bytes versus 42634477 full bytes. This validates the existing
  delivery path; it is not a new improvement attributable to pruning.
- Tab reader position: passed (600 messages; exact per-tab anchor/row offsets,
  rapid switches, wheel positions and tail follow).
- First-focus expansion: passed (tail pinned and detached viewport held).
- Window parity: passed (search/navigation, gestures, fullscreen, zoom,
  geometry, tool tabs, focus cycle and legacy layouts).
- Window state: passed with 400 cards (independent folding, background position,
  float relocation, workspace return, persistence and thinking renderer).
- Diff window: passed (background editing, note migration, session/file
  isolation and composer targeting).
- npm run tui:check, npx tsc --noEmit and git diff --check: passed.
- React Doctor attempted offline: unavailable (ENOTCACHED). No score claimed.

Additional focused timing checks:
Two-second composer and split-reader runs both passed the strict frame gate at
both sizes. The short composer comparison was noisy and suggested a slowdown,
so composer and tab switching were repeated with six-second measurement
windows, order 120/240/240/120. Two-run medians:
                              240 cards       120 cards
composer frame p50 ms            3.582           3.020
composer frame p95 ms            5.964           4.518
composer render ms/commit        1.226           1.146
tab switch frame p95 ms         30.328          29.905
tab switch render ms/commit      1.642           1.541
Tab switching remains slow at its tail; this is approximately unchanged, not
proof of a large switch improvement. Raw short runs and longer rechecks are in
2026-10-24-reader-surfaces.jsonl and
2026-10-24-reader-surface-rechecks.jsonl. Both sizes still occasionally exceeded
the strict frame budget in the longer runs. Improvements are scoped to the
measured consolidated reader workloads, with no global FPS or provider claim.

Completion audit: the requested actual rendering improvement is supported by
three serial paired scroll runs and the longer composer checks; lower retained
heap and process RSS are supported by the same paired scroll runs. Cache
lifetime, scroll geometry, tab positions, focus, split/fullscreen/zoom, diff
interaction and typechecks pass on the implemented source. Existing unrelated
worktree edits remain present. No commit or push was requested or performed.
