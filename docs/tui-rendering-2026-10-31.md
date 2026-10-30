# TUI rendering pass: Windows Terminal

The reported slow paths are streaming replies, scrolling, and resizing in Windows Terminal. This pass removes per-delta transcript commits and reduces Windows output frequency. Native Windows validation remains open; measurements below were collected on macOS and do not establish Windows input-to-visible-frame latency.

## Changes

- Coalesce cumulative assistant text snapshots by provider/session/message identity. Preserve first-seen block order; flush pending text before structural transcript updates, EOF, and error handling. Cancel the send-owned timer in `finally`. Existing immediate tool/question/permission handling remains in place.
- Use a 60 FPS on-demand cap on Windows and hosts advertising Windows Terminal through `WT_SESSION` (including WSL when the marker is passed through), retaining 120 elsewhere. Flush streaming text every 34 ms on Windows and 16 ms elsewhere by default. `AGENT_VIEWER_TUI_MAX_FPS=10..240` permits controlled comparisons and slower terminals.
- Add `terminalOutputPerf.ts` for native ANSI output/backpressure comparisons, including stream, wheel-flood-like scroll, and direct-resize stress workloads. Real terminal output is opt-in. Simulated Windows policy on macOS is explicitly labeled.
- Keep the CPU benchmark's 8.33 ms gate unchanged.

## Full-app streaming comparison

Runtime: Bun 1.4.2, OpenTUI 0.6.6, macOS. Baseline uses `sendComposerMessage.ts` from `4a83b7e7`; candidate uses the coalescing implementation. The same harness and 16 ms text pacing were used in both cases. Each run was in a fresh process with a hermetic two-session fixture, real app root, 180x44 memory renderer, and 81 text deltas on separate event-loop turns at nominal 2 ms intervals. No other performance harness ran concurrently.

| Root renders | Run 1 | Run 2 | Run 3 | Median |
| --- | ---: | ---: | ---: | ---: |
| Baseline | 179 | 177 | 178 | 178 |
| Candidate | 22 | 22 | 30 | 22 |

Median root renders fell by 87.6%. This is a React-work measurement, not a frame-rate or terminal-paint speedup. The harness checks visible text before EOF and a final text block emitted immediately before EOF. It intentionally allows React to process each event-loop turn rather than enclosing the timed producer in one `act()` batch.

## Native ANSI output simulation

Three-second workloads at 140x44, with a custom Writable accepting 250,000 bytes/second. Both profiles execute on macOS; `OUTPUT_POLICY_PLATFORM=win32` selects pacing only. Single samples, not statistically established speedups:

| Scenario | 120 FPS / 16 ms profile: bytes, frames | Windows 60 FPS / 34 ms profile: bytes, frames |
| --- | ---: | ---: |
| Streaming | 29,916 / 170 | 15,132 / 85 |
| Scroll flood | 692,306 / 200 | 618,268 / 175 |
| Direct resize stress | 686,184 / 92 | 690,473 / 93 |

Streaming output approximately halved in this fixture. Output saturation limits scroll/resize throughput; the cap does not remove that bottleneck. Direct resize stress bypasses the renderer's terminal-resize debounce and is not a reproduction of native window dragging. OpenTUI already debounces terminal resize requests by 100 ms and waits for native output delivery. No extra output queue or resize debounce was added.

`--full-repaint` remains an explicit correctness workaround and can substantially increase output volume. Leave it off unless stale fragments require it.

## Resize and row measurement follow-up

A native layout probe confirmed that the reader measured stale screen geometry inside `layout-changed`. After growing a row from 2 to 8 rows, its screen height was still 2 and the following row's screen y was still 2 during the event, while Yoga already reported height 8 and following top 8. The reader now reads current Yoga layouts once per mounted row and includes inter-row gaps. This corrects the height index during the same frame after expansion or resize and removes repeated screen-coordinate reads. It does not change the renderer's terminal-resize debounce.

`readerRowMeasurementSmoke.ts` exercises real native layout events while growing and shrinking rows, asserting current heights, card gaps, and preservation of unmounted estimates. The existing row-index smoke also covers tall cards, tail completeness, and 1,500 varied layouts.

Component tracing of a three-second stream wheel workload found one app-root render, two pane renders, and 18 transcript-window renders. Overlapping cached cards retained their element identity; newly mounted cards account for the remaining card renders. A whole-process CPU profile was dominated by test screen-capture/decoding work, so its sample totals are not presented as production hot-path percentages.

The row-measurement change was compared in three fresh-process runs per implementation with the same 10,000-message/120-session fixture, 140x44 viewport, three-second stream-wheel scenario, Bun 1.4.2, and memory sampling outside the timed window. No other performance harness ran concurrently. Baseline uses the original measurement loop; candidate uses current Yoga layouts:

| Median over three runs | Original measurements | Current-layout measurements |
| --- | ---: | ---: |
| React commits | 32 | 19 |
| Peak mounted cards | 40 | 29 |
| Total React render time | 276.20 ms | 159.09 ms |
| Renderer frame p95 | 8.49 ms | 7.99 ms |
| Retained heap growth | 2.73 MB | 2.19 MB |
| RSS growth | 30.54 MB | 28.85 MB |

All six runs still failed the strict 8.33 ms frame/commit gate. Candidate runs traversed 54–62 card indices versus 62–71 for baseline in the time-limited input driver; these figures describe the workload window and do not prove equal-distance scroll latency or a sustained FPS improvement. Fewer commits and mounted cards are consistent with eliminating stale height estimates, but native Windows responsiveness remains unverified.

Long bidirectional reader-window smokes passed with no row out of place and zero app-root renders during scrolling: stream (178 slides / 7,309 rows), conversation (612 slides / 7,747 rows), and scrollback (178 slides / 7,343 rows). The continuous-transcript and transcript-selection smokes also passed.

The broader `scrollbackTranscriptSmoke.tsx` is currently blocked by existing inline-title assumptions after the window chrome moved titles into tabs. Its first assertion fails with both old and new row measurement; exploratory fixture corrections uncovered additional obsolete title/follow-state assumptions. Those test edits were reverted rather than weakening its assertions. The focused scrollback reader-window smoke above verifies frame-by-frame scroll geometry independently.

## Verification and open gates

Passed: OpenTUI and web TypeScript checks, diff whitespace check, live-text batch identity/order/timer/cancel tests, full-app streaming/EOF smoke, existing Claude live-tool stream, Codex question stream, composer session isolation, transcript selection, and idle root-render smokes.

The existing `INPUT_SCENARIO=stream-wheel INPUT_SECONDS=3 INPUT_MEMORY=1 INPUT_JSON=1 bun tui/opentui/inputPerf.tsx` strict CPU gate failed both before and after. Baseline frame p95 was 5.06 ms with 7 total over-budget frames/commits; the later sample was 7.95 ms with 23 over-budget frames/commits. These are single samples on an unchanged navigation path; no scrolling CPU improvement or sustained 120 FPS claim is supported. Retained heap growth across those windows was about 2.75 MB and 2.72 MB respectively; RSS grew about 34 MB in each. These do not establish a memory improvement.

React Doctor could not run: npm registry resolution failed with `ENOTFOUND registry.npmjs.org`.

Still required: native Windows Terminal A/B runs at equal dimensions for streaming, scrolling, and resizing, confirming visible responsiveness and absence of stale fragments. README contains PowerShell commands for the output diagnostic. Test the actual app with default pacing, then 30/120 FPS overrides, with full repaint disabled first. Repeat with full repaint only if display correctness requires it. Record terminal/Bun versions, dimensions, cap, full-repaint setting, and the visible result alongside the diagnostic JSON. The diagnostic measures ANSI delivery, not emulator pixel presentation.

## Final local audit

The pacing resolver also covers Linux/WSL launched by Windows Terminal when `WT_SESSION` is present. Blank/absent markers leave non-Windows defaults alone, and the explicit FPS override still applies. The outer terminal marker survives the app launcher's agent-identity scrub; it is deliberately removed only for embedded terminal children. Policy smoke cases cover native Windows, macOS, Linux with and without a Windows Terminal marker, invalid caps, and explicit overrides.

No native Windows execution tool is available in this session. Native terminal painting and the reported Windows responsiveness cannot be verified on this macOS host. The Windows A/B validation remains the external gate; local simulations and frame-production results are not substitutes for it.
