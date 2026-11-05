# Interactive Coordinator acceptance audit

Current inspection: October 10, 2026. Herdr checkout `2563803d`; installed client
and running server both report 0.9.3/protocol 22 and compatible endpoints. This
read did not restart or change Herdr. The automation, connecting-machines, and
session-state guides are unchanged since the earlier `9dc3a1df` review. The
current source also strengthens connection-worker failure handling and exposes
Codex full lifecycle state; those are separate from the five interactive gaps.

This audit retains the original requirements in
[the comparison roadmap](coordinator-herdr-next-features.md). It separates source
implementation, executed fixtures, browser interaction, and live provider
comparisons. A fixture result does not prove general superiority over Herdr.

| Requirement | Current implementation | Executed evidence | Remaining proof |
| --- | --- | --- | --- |
| 1. Act on a remote teammate from the current window | Owning-daemon transcript, reply, plan/decision, interrupt, follow-up, recovery, and native provider requests; machine/run/agent/session/provider binding; full-prompt confirmation; immutable keyed retry | `coord:remote:smoke`: separate auth/route/ledger daemons, colliding identifiers, read-only/revoked access, independent outage, lost responses, terminal-team receipt recovery; 110x36 and 44x28 root keyboard paths; real Codex pending map with scripted RPC | Physical-network and real-provider remote interaction |
| 2. Start a reusable workflow from ordinary chat | Frozen typed preview, existing planner/ledger, human-owned lead, mixed provider lanes, dependencies, gates, exact startup recovery; web and TUI controls | `coord:workflow:smoke`: atomic tasks/seats, failed startup retry, barriers and gates; wide/narrow TUI. Extended browser fixture: invalid arguments, previewed dependencies, recipe edit after preview, lost acknowledgement, identical retry, preserved draft | Real-provider workflow job and comparison with Herdr |
| 3. Review a result as a change package | Real branch/base/files/diff, receipt versus executed verification, revision-bound freshness, findings/decisions, explicit gated staging into target; reviewed/verified/integrated states remain distinct | `coordResultReviewSmoke`: real Git, missing/failed/unbound/stale evidence, dirty/moved target, out-of-scope files, explicit staging and same-key replay. `mergePreviewSmoke`: conflicts and no target mutation. Browser: review alone does not stage or mark reviewed; confirmation carries inspected token | Representative live delegate/review comparison |
| 4. Understand restart recovery at team level | Retained identities/directories/tasks; live/foreign/uncertain/paused states; bounded metadata inspection; explicit same-task resume and terminal-result acknowledgement | `coord:recovery:smoke`: actual SIGKILL of execution host, fresh-process observation without replay, retained tasks/results, missing native session/directory and canonical aliases, host ownership, keyed resume. Browser: missing directory/session disables resume, refresh is read-only, cancellation and confirmation, acknowledgement without resume | Real-provider daemon disconnect/reconnect comparison |
| 5. Put resource controls beside continuation | Agent capacity and supported token/cost/duration budgets; raw reported usage with missing-data labels; scheduling pause retains owned work; explicit limit update resumes eligible work once | `coord:resources:smoke`: competing capacity, pre-allocation budget checks, persisted pause across process restart, ownership, provider remaining budget, keyed resume and human gates. Browser: unavailable usage stays unavailable, invalid capacity sends nothing, scoped limits reach existing team | Live-provider reported usage and limit behavior |

## Browser run

The current `scripts/coordInteractiveBrowserSmoke.mjs` passes against the actual
Next.js UI in Google Chrome at 1440x1100. All provider API calls are intercepted
by the fixture; it does not launch model turns. It covers enablement, bounded
continuation preference, embedded native approval, named follow-up, outages,
foreign-host controls, blur-only notifications and notification settings,
result review and staging confirmation, frozen workflow retry, resource limits,
and recovery. The lead draft survives these interactions. Screenshots are local
artifacts under `/tmp/coordinator-*.png`, not committed product assets.

OpenTUI type-check passes. Full TypeScript still reports the four existing
legacy Ink `WritableStream.rows/columns` errors. No completion claim follows
from this audit: the comparative live jobs listed above remain unverified.

## Next comparison jobs

Use the same small isolated project and comparable provider/model in both apps.
Run delegate/review, clarify/resume, interrupt/follow-up, disconnect/reconnect,
and remote answer. Record actionable result, human interventions, duplicate
effects, missed questions, retained work, elapsed time, and reported usage when
available. Missing usage stays unknown. Preserve the human boundary for native
approvals and uncertain submission; do not turn a pending approval into an
agent-authored answer to make the benchmark pass.
