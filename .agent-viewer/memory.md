# Coordinator project memory

Durable facts, decisions, and gotchas coordinator agents have recorded for this project. Persists across every run — edit freely.

## 2026-08-09T09:43:39.982Z — lead
OpenTUI performance: combine split-pane mtime/activity poll gating, tokenized unchanged worker deliveries, and single-pass formatter analysis.

Measured in run 6ca9c763-1e3d-47e5-bb6a-2ad4cc6b54a8: full 9-scenario transcript pipeline medians improved about 89-92%; unchanged split-pane clone peak heap fell 90.9%; tokenized worker delivery transfer fell 95.0% and peak heap 88.7%. Preserve mutation/truncation and card-variant fallbacks, delivery-token baseline binding, 80-card split-pane window/scroll state, and exact transcript checksums. Full pipeline RSS/peak heap can be allocator-noisy, so use focused steady-state clone/transport benchmarks plus post-GC heap and exact-output checks for memory claims.

## 2026-08-15T00:07:17.495Z — lead-luke
OpenTUI 60fps/scroll perf run (1bb4c20f): three concrete wins, disjoint-lane pattern held cleanly through octopus merge.

1) App.tsx live-stream tail-follow was eagerly building a full transcript key Map + duplicate keys array on every delta — fix: lazily materialize the index only for detached cursor/bookmark/search lookups, replace the reconciliation effect's per-delta full-key array with compact {length,lastKey} metadata, and make AGENT_VIEWER_PERF summary writes async (sync appendFileSync was itself injecting periodic frame spikes). Modeled 10k-card/1000-delta cost: 163.8ms -> 0.138ms total.
2) Worker pipeline (threadingWorker.ts/threadingWorkerClient.ts) streaming-append round trip cut ~73% (57.2ms -> 15.4ms median @ 10k messages) via token-bound append-only suffix delivery — only the new suffix transfers when the format token confirms nothing upstream changed; mutation/truncation/TaskList-dependent paths still take the full path and remain byte-identical. New benchmark: npm run tui:worker-perf (workerLatencyPerf.ts).
3) No scroll-specific frame-timing benchmark existed before this run (only App.tsx's general render canary + transcriptPerf.tsx memory bench). Added tui/opentui/scrollPerfSmoke.ts: wheel-flood + keyboard-velocity scroll burst against a 12k-message session, asserts frame-budget adherence AND window/recenter correctness (bounds, monotonic slides, no stationary-cursor livelock, jumped-cursor recenter containment). Main was already at 0% frames-over-budget on scroll — the win here is having a repeatable regression benchmark, not a scroll fix.
Coordination note: splitting the 3-agent run into disjoint-path lanes (App.tsx / worker+format.ts / new scroll-bench+AnalyticsPopover files) let all three land in parallel with zero merge conflicts on octopus merge — worth repeating this split for future App.tsx-adjacent perf work. Integration branch left at agent-viewer/coord/1bb4c20f/integration (not merged to main — user's call).

## 2026-08-15T01:55:58.210Z — fleet-strip-lead
Fleet overflow uses one-row nine-cell paging with Shift+[ and Shift+] navigation

Implemented in run eaaab992: `FLEET n/N` with `{ } pages`, page-local 1-9 selection, wraparound, and page clamping while preserving focus/empty hiding and status priority. For isolated Coordinator lanes, keep coverage task gates baseline-compatible when the assertions depend on a separate product commit; run cross-lane assertions only in the merged lead integration task.

## 2026-08-15T03:06:03.379Z — ahp-compat-lead
AHP 0.7 compatibility audit: do not claim 100% until workingDirectories and reconnect snapshot cursor are fixed

Run 9b189e24 found two confirmed divergences. Agent Viewer advertises AHP 0.7 but lib/ahpHost.ts createSession reads removed params.workingDirectory and lib/ahpCoordinator.ts emits singular workingDirectory; AHP 0.7 requires workingDirectories arrays, and a negotiated-0.7 runtime probe proved valid cwd input is ignored. bin/agent-viewer-ahp-client.mjs reconnect handling reads snapshot.serverSeq, but normative Snapshot exposes fromSeq; official TS/Rust/Swift runtimes advance to max fromSeq. Fix both and add official 0.7/schema plus consecutive snapshot-reconnect tests before claiming 0.7 conformance. Separate tagged 0.7 compatibility from optional/unreleased main 0.8 feature adoption.

## 2026-08-15T03:37:00.174Z — web-perf-lead
Web transcript performance: avoid unchanged backfill copies, per-card hydration effects, and virtual-window wrapper arrays

Run ec5d0753 measured three semantics-neutral Web optimizations. In app/page.tsx, lazily allocate the retained-message copy only after the first real replacement; unchanged 20-message backfills against a 3,000-message cap went from 60m temporary slots/514.2ms to 0/463.7ms over 20k synthetic ticks, with 5,000 randomized equivalence cases. In MessageItem, move timestamp hydration state/effect to MessageDensityProvider so N mounted cards share one lifecycle owner while preserving stable SSR UTC then client-local display. In MessageView, skip Stream-history metadata outside Stream mode and keep only virtual start/end indices, reading rowLayout arrays directly; preserve geometry, anchors, follow-tail, and row props. Verify with tsc, checkTimelineVirtualizer, diff-check, and React Doctor changed scope.

## 2026-08-15T06:37:19.686Z — lead-claude
Round-2 OpenTUI perf run (dbc7a71b): two more concrete wins on top of 1bb4c20f, run auto-failed post-completion on a lead heartbeat gap (infra artifact, not a work-quality issue) — verify board status before assuming a stale run means bad results.

1) Worker/formatter (tui/opentui/threadingWorker.ts, threadingWorkerClient.ts, tui/format.ts, commit e414b79): replaced the append-only-suffix protocol's full-path fallback for mutation/truncation/TaskList-dependent updates with token-bound {prefix, deleteCount, patch} middle-patch deltas. 10k-message fixed-seed medians: mutation 57.27->16.35ms (-71.5%), truncation 52.16->24.85ms (-52.4%), TaskList-dependent 48.57->29.27ms (-39.7%). Byte-identical, checksums verified.

2) App.tsx (commit cec5e6b): detached browse/search readers were still rematerializing a full transcript-key Map on every streamed token even after 1bb4c20f's tail-follow fix, because paused/browsing calls hit the eager path. Now memoizes a lazy index and, when the visible-cards array is a verified stable-prefix + live-suffix, indexes only the suffix. 2000x15001-card synthetic frames: 555.67ms->165.63ms (3.35x). Split-pane CardDisplayData now WeakMap-cached by every output-affecting input so live appends only recompute changed/latest rows instead of all 80 mounted rows.

Integration (octopus merge of both branches into agent-viewer/coord/dbc7a71b/integration, zero conflicts again — confirms the disjoint-path lane pattern is reliable for App.tsx/worker-file splits): npm run tui:check clean; tui:worker-perf on merged tree confirms task-1 numbers hold (mutation 18.98ms/truncation 17.76ms/TaskList 29.49ms median, all checksums match); scrollPerfSmoke at 15k messages: 0/99 slides over 16.67ms budget, avg 7.38ms max 12.3ms; splitPaneSmoke passes; full appSmoke renders correctly (one pre-existing unrelated hermetic fixture assertion about saved-playbook count fails in a fresh temp workspace — not a regression, both lanes hit the same thing independently).

Infra note: the Coordinator run auto-failed ~6 hours after my last heartbeat during a long idle gap between conversation turns, even though task-1 and task-2 were already completed and durable. coord_claim_task/coord_create_task both reject on a terminal "failed" run — there's no in-band way to reopen it once terminal. The actual work (both lane commits, integration verification) was unaffected and remained valid; only the run's bookkeeping status was lost. Treat a "failed" run status as possibly meaning "the lead's heartbeat lapsed," not necessarily "the work failed" — check task receipts before assuming a redo is needed.

## 2026-08-15T06:57:01.643Z — claude-lead
AHP protocol coverage audit (2026-08-15, coord run 56a41aa0): agentViewer pins @microsoft/agent-host-protocol ^0.7.0 (exactly 0.7.0 installed); full gap report lives at .agent-viewer/ahp-gap-audit.md.

Shipped (commit a8ad82a, merged to main): AgentCapabilities.multipleWorkingDirectories (immutablePrimary: true) now advertised in coordinatorRootState; session-level workingDirectories is now the union of run.baseCwd (primary) + each agent's distinct worktreePath via new sessionWorkingDirectories() helper in lib/ahpCoordinator.ts, wired through all 3 SessionSummary call sites in lib/ahpHost.ts (root/sessionAdded, root/sessionSummaryChanged, listSessions); the 4 client-dispatchable session/chat workingDirectorySet/Removed actions are now explicitly rejected with a spec-correct reason (directories here are 100% server-derived from run/worktree assignment, never client-mutable) instead of falling through to the generic "not writable" rejection.

Investigated but NOT implemented: ToolResultTerminalContent.result/isPty (0.6.0/0.7.0) has no construction site anywhere in this codebase — agentViewer's terminals are standalone ahp-terminal: resources never linked to a chat turn's tool-call content, so adding the fields would be dead code without first building that terminal-to-tool-call linkage (a separate, larger feature).

Explicitly deferred pending user sign-off (all "large" new subsystems with no natural home in this Coordinator-projection host, which represents run/task state as synthetic AHP chats rather than running a live LLM turn loop): side chats/createChat (0.7.0), tool-call auth-required flow (0.6.0, needs MCP server modeling first), changeset review capability (0.5.2/0.6.0 — changesets aren't implemented AT ALL, zero grep hits, so this is N/A until that foundation exists), async tool-call risk assessments (0.6.0). Also noted low-priority: SessionState.inputNeeded (0.5.1, agentViewer already has its own plan-approval flow outside AHP) and root/progress (0.5.0), both absent but small/n/a.

Gotcha: 0.8.0 is unreleased upstream with zero Added changelog entries — nothing to implement for it yet, and no dependency bump needed for any of the 0.6.0/0.7.0 gaps (already in the installed 0.7.0 type defs). When 0.8.0 does ship, remember a client offering only '0.8.0' will fail negotiation against this host's SUPPORTED_PROTOCOL_VERSIONS=['0.7.0','0.6.0','0.5.2','0.5.1'] until the dependency is bumped.

Verified: npx tsc --noEmit clean on merged main. scripts/ahpSmoke.ts fails with a MODULE_NOT_FOUND for a spawned `run` script — confirmed pre-existing/unrelated to these changes (reproduces identically on main before the AHP merge).
