# TUI performance pass — 6 September 2026

Measured on macOS arm64, Bun 1.4.0. This pass targets OpenTUI's shared
transcript worker/client path, used by the reader and split panes.

## Change and measured benefit

Changed detail reads previously cloned all raw messages, threaded messages,
and cards back to the UI, even when the UI then discarded an unchanged prefix.
The worker now transfers only each array's changed suffix when the request's
captured delivery token and card variant match its baseline. The client rebuilds
the arrays using its original prefix objects. Missing baselines and variant
changes retain full delivery; unchanged polling retains the existing no-op path.

The new `transcriptDeliverySmoke.ts` exercises the actual worker handler and
client with mocked provider reads and structured cloning at the transport
boundary. Its 10,000-message append compares the new packet with an equivalent
full packet in the same process:

| Transfer measurement | Full packet | Suffix packet |
| --- | ---: | ---: |
| JSON-encoded payload size | 42,634,477 bytes | 5,142 bytes |
| Live cloned JS heap after forced GC | 34,478,290 bytes | 5,439 bytes |
| Median structured-clone time | 44.30 ms | 0.0069 ms |

This eliminates roughly 33 MiB of temporary cloned objects in this fixture.
These are transport measurements, not end-to-end polling latency or a claim of
an equivalent reduction in total application RSS. Initial reads, early edits,
and cache misses can still require full transfers. Existing resident cache
limits and reader window sizes are unchanged.

## Core workflow audit

- Worker formatting: all initial, append, mutation, truncation, TaskList, and
  eviction-recovery checks remain byte-identical. Final 10,000-message medians:
  full round trip 74.5 ms; append 14.85 ms; mutation 14.86 ms; truncation 13.12 ms;
  TaskList-dependent update 17.85 ms; main-thread cache hit 0.0009 ms. This format
  API already used deltas and is unchanged by the detail-delivery optimization;
  differences from the initial run are not attributed to this patch.
- Worker retention: rotating through 40 sessions of 2,000 messages still
  plateaus. Heap at session 20 was 28,938,527 bytes and at session 40 was
  28,903,601 bytes. Evicted-session revisits and density changes preserve output.
- Scroll reliability: the 12,000-message fixture completed 400 wheel ticks and
  78 slides with window bounds, monotonic movement, recentering, and no-livelock
  checks passing. Its state-transition timings do not prove native frame cost.
- Navigation audit: all 21 surfaces ran with 10,000 messages and 120 sessions,
  including search, typing, tabs, editor navigation, and both split layouts.
  35 of 4,593 commits exceeded the existing 8.33 ms gate; worst frame was 20.4 ms
  during composer typing. Some development checks overlapped this observational
  run, so do not treat its frame counts as an isolated before/after comparison.
  The strict 120 FPS gate remains unproven.

Full threading/formatting pipeline matrix, isolated processes, default runs:

| Messages | Split panes | Median | p95 |
| ---: | ---: | ---: | ---: |
| 100 | 0 | 0.45 ms | 0.58 ms |
| 100 | 1 | 0.70 ms | 0.93 ms |
| 100 | 2 | 1.00 ms | 1.29 ms |
| 1,000 | 0 | 3.38 ms | 4.05 ms |
| 1,000 | 1 | 5.99 ms | 7.31 ms |
| 1,000 | 2 | 9.58 ms | 10.99 ms |
| 10,000 | 0 | 32.12 ms | 39.31 ms |
| 10,000 | 1 | 40.49 ms | 46.50 ms |
| 10,000 | 2 | 49.54 ms | 53.66 ms |

These pipeline figures measure computation, not interactive frame times; heavy
threading and formatting remain in the worker. The remaining useful profiling
areas are occasional native/React commit spikes and full large-session reads.

## Verification

```sh
bun run tui/opentui/transcriptDeliverySmoke.ts
npm run tui:worker-perf
npm run tui:worker-memperf
npm run tui:scrollperf
npm run tui:perf
npm run tui:inputperf
bun run tui/opentui/sessionOpenSmoke.ts
bun run tui/opentui/splitPaneSmoke.ts
bun run tui/opentui/liveToolStreamSmoke.tsx
bun run tui/opentui/transcriptSelectionSmoke.tsx
bun run tui/opentui/renderSmoke.tsx
npm run tui:check
npx tsc --noEmit
git diff --check
```

The delivery regression is included in `tui:smoke:run`. It checks output and
identity for idle polling, appends, edits, truncations, empty transcripts,
restarts, density/tool-visibility changes, missing request tokens, simultaneous
reads, and reversed response delivery. The native live-tool smoke emits React
`act(...)` warnings. Windows/WSL and live provider latency were not measured.
