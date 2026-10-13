# Coordinator MCP autonomy audit — 2026-10-13

Scope: the current working tree, preserving pre-existing Coordinator recovery
and TUI edits. This is an implementation and fixture audit, not evidence of
live-provider restart success. No production run was mutated.

## Recovery gap closed in this pass

The UI could inspect, acknowledge and resume retained execution, but the shared
SDK contract and standalone MCP bridge offered only release, handoff and
cancel-turn. A lead could release/reclaim a task while its old reservation still
prevented dispatch. The October 11 recovery audit records that incident.

Three tools now share the external authenticated action router and SDK contract:

- `coord_inspect_recovery`: lead-only read, optional teammate name/ID, native
  directory/conversation evidence, host ownership, retained reservation and
  current claim identity. It neither takes a host nor submits a turn.
- `coord_acknowledge_execution`: retire completed/relinquished markers, pinned
  to the inspected task ID and reservation timestamp. Live execution, owned
  unfinished work, changed reservations and foreign hosts are rejected.
  Newer assignments and locks survive. Maintenance can dispatch queued work
  later; the acknowledgement itself does not submit it.
- `coord_resume_agent`: start a new turn in the saved managed conversation,
  pinned to inspected task ID, session ID and claim generation. Rechecks the
  claim after native inspection. Rejects native questions/permissions, task
  approvals/open decisions, budget gates, unavailable native sessions/directories
  and foreign host ownership. Explicit provider/account bindings survive.

All mutations use participant-scoped replay keys. Input/claim rejections before
writes can be corrected under the same key; successful same-key retries return
receipts without repeating execution. Reads cannot certify that a previous
provider turn performed no tools: inspect its saved transcript before resume.
No receipt is inferred from a finding or a stopped turn.

## Additional gaps closed in the continuation

- `coord_read_task` retrieves full durable receipts/results and provides claim
  generation and a task/dependency revision pin. Private dispatch policy and
  mailbox bodies remain excluded. `coord_list_tasks` pages compact summaries
  by insertion order with bound-run/filter cursors. Concurrent filter changes
  are documented as current-state reads, not a frozen snapshot.
- `coord_cancel_task` exposes authenticated lead cancellation, with an
  inspected revision and reason. Task or dependent-work changes invalidate
  the pin; comparison is repeated inside the cancellation transaction. The
  cancellation event names the lead, locks/ownership are released, and
  impossible unfinished dependents fail. Native interruption is best effort;
  neither saved edits nor uncertain dispatch reservations are erased.
- `coord_inspect_operation` maps the original tool name to its stored action
  and reads only the caller's participant-scoped operation. It exposes ledger
  state, cache availability and safe returned task/agent references, not cached
  board bodies. Completed tombstones still fence replay after cache expiry.
  Running reservations do not certify liveness; failed attempts may have
  partial effects, and absent records cannot certify an unkeyed/setup request.

- `coord_read_result` and `coord_integrate_result` now expose authenticated lead
  review and integration for native and external lead identities, using exact
  task data rather than chat rebinding. The reviewed source/target/receipt/run
  pin is required, as is a stable replay key. Dirty targets, stale verification,
  out-of-grant paths, unresolved native questions/execution, unavailable merge
  preview, conflicts and required human run review block integration. Source
  work can be committed onto its task branch; the target receives staged squash
  changes, never an automatic target commit. Git writes mark the keyed attempt
  as potentially applied before mutation, preserving uncertain-failure fences.

- `actionable.waitingPolicy` now reports model-turn waiting ownership with
  evidence (`unattended-capability`, verified managed binding, external client,
  cooperative session, or unverified host). Unknown native identities are not
  assumed supervised. The policy appears in status, waits and mutation receipts;
  it is independent of liveness and auto-continue. Supervisors may still use
  the same wait API outside model turns.
- The canonical Coordinator skill now routes to every new tool and its exact
  pin/key workflow. Detailed host guidance remains progressively disclosed;
  the compatibility entry point forwards to that maintained source. Both
  skill entry points validate, and the canonical hot path stays below 1,700 words.
- Role-aware discovery now gives teammates 24 of the 40 Coordinator tools,
  retaining discovered-work creation and execution tools. Verified standalone
  role changes invalidate discovery once; native bindings and scoped OpenCode
  prompt masks share the same filter. Unknown roles retain all tools and backend
  authorization remains authoritative. OpenCode native commands lack a mask field.
- Result review defaults to a compact overview. Pinned whole-branch/file diff
  pages include binary and untracked changes, reject source/target drift, and
  expose complete changes beyond the legacy preview cap. Integration and human
  review gates remain unchanged. Character measurements are recorded in
  `coordinator-mcp-token-cost-2026-10-13.md`; billed-token savings are unmeasured.

## Remaining gaps, ranked

| Priority | Current source evidence | Agent impact and next implementation |
| --- | --- | --- |
| 1 | Dispatch reservations identify task + timestamp; claim generation is a separate task column. October 11 audit identifies provider cooldown/reset evidence as unfinished. | Persist independent attempt identity, provider instance, claim generation and quota/reset evidence. Distinguish quota recovery from a human question. Never retry a possibly executed turn solely because observation expired. |

Earlier audits describe several issues that have since changed: current external
status is bounded, actionable unresolved mail survives acknowledgement, targeted
wait/delegation fixtures exist, and pre-write keyed rejection handling is
present. Those older findings are leads to recheck, not current proof of defects.
The broad autonomy goal remains open while the gaps above lack implementation
and verification.

## Verification

Passing focused evidence in this pass:

- `scripts/coordRecoveryClaimSmoke.ts`: legacy stranded assignment, release/reclaim
  exclusion, healthy handoff, stale/missing reservation rejection, role gates,
  same-key acknowledgement and restart persistence.
- `scripts/coordTeamRecoverySmoke.ts`: actual killed host/reopen, missing/mismatched
  native resources, stale claim rejection, native human-question rejection,
  corrected same-key resume, no duplicate submission or replacement session.
- `scripts/coordInteractiveHostsSmoke.ts`: live foreign ownership retained,
  inspection read-only, foreign acknowledgement rejected, dead-host takeover.
- `scripts/coordInteractiveRecoverySmoke.ts`: explicit recovery retains native
  teammate/task after process restart without automatic replay.
- `scripts/mcpBridgeSmoke.mjs`: actual stdio MCP discovery, shared metadata/schema
  parity, authenticated mapping of all three recovery tools and replay keys.
- `scripts/coordCancelTaskSmoke.ts`: lead gate, graph-change and transactional
  revision rejection, dependency-chain failure, owner release, actor attribution
  and keyed replay.
- `scripts/coordTaskInspectionSmoke.ts`: 26 terminal outcomes, full old receipt
  and result outside ordinary detail retention, compact keyset pagination,
  filter/cursor/authentication/run isolation and private policy/mail exclusion.
- `scripts/coordOperationInspectionSmoke.ts`: alias mapping, participant privacy,
  real in-flight handle observation, partial failure, completed cache lookup,
  expired-cache tombstone and retained replay fencing.
- `scripts/coordKeyedRetrySmoke.ts` and `scripts/coordIdempotencySmoke.ts`.
- `scripts/mcpBridgeSmoke.mjs` additionally exercises all four new task/operation
  tools with bound identity, revision, cursor and replay-key mapping.
- `scripts/coordResultReviewSmoke.ts`: actual source/target Git state, stale
  evidence, moved/dirty targets, path grants, lead role, external lead with
  required unapproved human review, staged integration and exact-key replay.
- `scripts/coordInteractiveHostsSmoke.ts` additionally rejects foreign-host
  cancellation/integration and avoids inspecting foreign result paths.
- `scripts/mcpBridgeSmoke.mjs` also covers both result tools and the required
  integration key/schema mapping.
- `scripts/coordWaitingPolicySmoke.ts`: negotiated managed/interactive modes,
  cooperative/unknown identity handling, waiting ownership in wait results,
  renegotiation and native app binding independent of auto-continue.
- Skill Creator `quick_validate.py` validates canonical/compatibility entry points;
  MCP bridge smoke verifies shipped skill resources and the hot-path word budget.
- `scripts/coordToolDiscoverySmoke.ts`: native provider catalogs, warm/rebind
  behavior, scoped prompt masks and rejection of forged role hints.
- `scripts/coordResultDiffSmoke.ts`: complete 265,006-character reconstruction
  across 17 pages, role/limit/stale-pin rejection; result-review smoke additionally
  covers untracked file pages and source/target drift.
- `scripts/mcpBridgeSmoke.mjs`: exactly one discovery invalidation on verified
  role changes and diff-page mapping. Authenticated shell fallback smoke passes.
- Full `npx tsc --noEmit`, `npm run tui:check` and `git diff --check` pass.
