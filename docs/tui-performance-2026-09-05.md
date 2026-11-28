# TUI performance measurements — 5 September 2026

Measured locally on macOS arm64 with Bun 1.4.0. These are benchmark results,
not a claim that total application RSS falls by the same percentage or that
every terminal frame meets 120 FPS.

## Changes

- Bound the worker card cache for format-only sessions as well as detail reads.
  Evict associated threading and delivery baselines together. Recover from an
  evicted worker delta baseline by resending the full transcript once.
- Replace each message's single-entry density Map with one cached record.
- Reuse timestamp locale formatting across messages in both terminal UIs.
- Keep the diff-note event handler stable during sidebar navigation so moving
  the sidebar selection does not rebuild every mounted card's React variants.

## Measured results

| Workload | Before | After |
| --- | ---: | ---: |
| Worker retained JS heap after 40 distinct 2,000-message sessions | 166.4 MiB | 26.3 MiB |
| Additional retained heap from session 20 to session 40 | +77.6 MiB | approximately zero |
| Full 10,000-message worker format/delivery, median | 272.4 ms | 83.3 ms |
| Card-variant construction in a 10-second sidebar CPU profile | 1.23 s | 76.6 ms |

The memory probe collects inside the worker VM. It compares every delivered
card against synchronous formatting and revisits an evicted session. The worker
latency harness verifies initial, streaming, mutation, truncation, task-list,
and eviction-recovery output. Streaming round-trip medians remain about 14 ms;
the principal latency improvement is full-session formatting.

The transcript pipeline matrix covers 100, 1,000, and 10,000 messages with
zero, one, and two split panes. All nine workload medians improved and their
checksums matched. The observed speedups range from 1.6× to 4.6×. These local
runs include runtime and scheduling variation; they are not latency guarantees.

The sidebar profile identifies reduced CPU in card-variant construction. It
does not by itself prove lower worst-case frame latency: native layout, paint,
garbage collection, and other interactions still contribute to frame cost.

## Reproduction and correctness

```sh
npm run tui:worker-memperf
npm run tui:worker-perf
npm run tui:perf
npm run tui:inputperf
npm run tui:scrollperf
bun run tui/opentui/timestampSmoke.ts
bun run tui/opentui/transcriptSelectionSmoke.tsx
bun run tui/opentui/splitPaneSmoke.ts
bun run tui/opentui/sessionOpenSmoke.ts
bun run tui/opentui/renderSmoke.tsx
npm run tui:check
npx tsc --noEmit
git diff --check
```

Timestamp parity includes missing/invalid timestamps, midnight, and daylight
saving transitions in UTC, Melbourne, and New York under three locale
environments. Native Windows and WSL were not executed in this macOS run.

React Doctor's local changed-source scan reported no issues; external scoring
and supply-chain requests were disabled.

The 21-surface input harness uses a hermetic 10,000-message/120-session fixture
and an 8.33 ms target. Its initial full run completed every scenario but recorded
nine over-budget frames. The follow-up completed all 21 scenarios with no skips:
eight of 4,709 measured commits exceeded the target, with a 20.4 ms worst frame.
The strict input gate therefore still fails; a guaranteed 120 FPS claim is not
established. The changes address measured retention, full-format latency, and
repeated React work without treating that stricter frame target as achieved.

Checks completed: both TypeScript configurations, worker output parity and
retention, timestamp parity, transcript selection, split panes, session opening,
rendering, scroll-window correctness, the nine-workload transcript matrix,
React Doctor's changed-source scan, and `git diff --check`. Input profiles emit
React `act(...)` warnings from asynchronous work in the development harness;
all scenario preconditions and card counts were nevertheless observed.
