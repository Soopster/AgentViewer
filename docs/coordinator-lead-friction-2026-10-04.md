# Lead-side Coordinator friction — 2026-10-04

Run: `chat-27e138135b53e5c4e9a46b72208f063ec74ec4c4` (explorer = agent-1, task-1).
Scope: read-only investigation. No `lib/` or `components/` edits. Line numbers are from the working tree as of this run (it has uncommitted changes in `lib/agentCoordination.ts` and `lib/coordinatorToolContract.mjs`; lines may shift after those land).

## Method

- Exercised live: `coord_status`, `coord_read_inbox` (keyed and unkeyed, with ack).
- Read the contract (`lib/coordinatorToolContract.mjs`), the wait loop, the keyed-operation layer, and the `actionable` digest in `lib/agentCoordination.ts`.
- Read `.agents/skills/coordinate-agents/SKILL.md` (the lead rules it promises).

## Ranked bottlenecks (autonomy impact first)

### 1. Failed keyed mutation cannot be retried, and the error says "reconcile" with no reconciliation tool

- `lib/agentCoordination.ts:2600-2650`: any throw inside `operation()` sets the attempt row to `state='failed'` (line ~2643) and rethrows. The reservation is never released, except when a completion returns `accepted:false` (2602-2612).
- `lib/agentCoordination.ts:2575-2586`: on the next call with the same key, *any* existing attempt row (`completed`, `failed`, or `running`) throws `COORDINATOR_OPERATION_UNCERTAIN`. For `failed` the text is "The prior attempt failed … Its effects may be partial." and then "do not repeat the mutation with a new key".
- Skill `SKILL.md:74` says "Validation and gate failures require correction, not blind retries", which implies that a corrected retry is the intended path. The code does not allow it for any non-completion validation error (a bad path grant, a conflicting `assign_to`, a missing dependency, and so on).
- Effect: a lead whose `coord_delegate` was rejected for a fixable reason has two options, both bad: reuse the key and be refused forever, or use a new key, which the error and skill both forbid "until its effects are understood". There is no reconcile call that answers "did this task get created?" other than scanning `coord_status`. The error also gives no `taskId` or `similarTasks` hint.
- Fix shape (for the fix owner): validation errors thrown before any side effect should delete the reservation like the `accepted:false` path; or `COORDINATOR_OPERATION_UNCERTAIN` should carry the prior result/effect ids so the lead can reconcile in one call.

### 2. `coord_wait` default `until` includes `idle`, so an unfiltered wait can return immediately

- `lib/agentCoordination.ts:2449-2459`: default `timeoutMs` 25 000; with no `until`, the wake set is all of `SETTLED_AGENT_STATES` = `idle, ready, done, blocked, failed, stopped` (2433-2434). Freshly spawned or between-task teammates are `idle`/`ready`, so an unfiltered wait can return before any work moves.
- The contract text (`coordinatorToolContract.mjs:45-53`) says a wait with `agent` returns on settle; without `agent` it returns on "board changes". The implementation returns on any board change that matches those states. A lead cannot tell from the description which of the two it is.
- Effect: a lead in an interactive host without subscriptions loops `coord_wait` → immediate return → `coord_status` → `coord_wait`, burning turns. The skill (`SKILL.md:50`) says "empty/timed-out waits are normal", which hides this.
- Fix shape: default an unfiltered wait to "any change since cursor" with an explicit documented wake set, or make the description say which.

### 3. `coord_status` is an unbounded full snapshot with duplicated payloads

- Observed live: the `task.created` event carries the full task prompt (`events[]` detail = the whole goal + instructions), and the same prompt is repeated in `tasks[].prompt`. Each status call re-sends both, plus the roster, locks, and up to the whole event tail.
- `coordinatorToolContract.mjs:57-62`: `coord_status` takes no arguments, so there is no `since`/`limit`/`events=false`. The skill (`SKILL.md:40`) tells leads to avoid repeated full loads and to use `coord_query_context`, but the tool offers no lighter read.
- Effect: a long run's status grows with run age and task text. Status-based polling for progress costs the lead context each time (the skill says this must stay bounded, but the snapshot is not).
- Fix shape: `coord_status({ since_cursor, include_events })`, or a compact `actionable`-only mode.

### 4. Two supervision models in the skill conflict, and the lead cannot tell which one applies

- `coordinatorToolContract.mjs:45-47` and `SKILL.md:46`: "Managed turns must never call `coord_wait`". `SKILL.md:50`: interactive-without-subscription uses `coord_wait`.
- The lead's own status shows `runtime` = `external claude CLI` with `turnActive: true` (observed in `coord_status`, `agents[0]`). Nothing in the status or the actionable digest says "managed" vs "interactive". The lead must guess.
- Effect: either the lead waits in a managed turn (wrong, burns tokens) or it returns control when it should stay engaged (the run stalls with no redispatch). This is a guess point at the start of every run.
- Fix shape: put `supervision: 'managed' | 'interactive' | 'subscribed'` in `actionable` (or on `agents[*]` for the caller).

### 5. Reply-guard reminder fires per silence window with no cure signal

- `lib/agentCoordination.ts:1540-1565`: the guard is due when a working teammate has gone `REPLY_GUARD_SILENCE_MS` without `coord_progress`/`coord_send_message`/`coord_publish_finding`, up to `REPLY_GUARD_MAX_REMINDERS`. The reminder text says "your reasoning … is invisible to teammates" and "if you have genuinely made no progress yet, this reminder can be ignored".
- Effect: a lead (or teammate) that is making progress via tools that do not count (for example `coord_request_locks` or reads) keeps receiving the same reminder, and a lead cannot distinguish a real stall from a healthy quiet phase. The digest exposes `replyGuardDue` but not the silence duration or the last-report time, so the lead cannot judge it.
- Fix shape: include `silentForMs` and `lastReportAt` in the `replyGuard` digest block; count `coord_request_locks` as progress.

### 6. Same-key `coord_read_inbox` / `coord_status` retries have no documented safe-retry window

- `SKILL.md:74` says reads may be retried after about two seconds. `coord_read_inbox` with `acknowledge: true` is a mutation (it marks messages read) and is idempotent only through `request_id`. The task-1 reading used a new `request_id` for the ack call and got `messages:[]`, which is correct, but a transport failure after the ack leaves the lead unable to tell whether the messages were acknowledged. Nothing in the response reports the acknowledged ids, only `nextCursor`.
- Fix shape: return `acknowledged: [ids]` on an acked read.

### 7. `coord_delegate` vs `coord_create_task(assign_to)` overlap with two different wait behaviours

- `coordinatorToolContract.mjs:135-148` (delegate) vs `98-133` (create_task). Delegate's description says `wait_ms` is "interactive hosts only" and returns `settled.outcome`; create_task's `assign_to` returns "queued delivery, not proof of execution" and has no wait. A lead choosing between them must read both descriptions to learn that only delegate can wait.
- `SKILL.md:55` tells leads to use delegate for direct assignment; `agentCoordination.ts:1830` `targetRole: entry.role ?? 'teammate'` shows the role default differs by entry point. Confirmed in code, not in the schema.
- Fix shape: one assignment verb, or make `wait_ms` on create_task too.

### 8. Interactive-host detection is invisible to the tools

- `coord_delegate.wait_ms` is documented as interactive-only (`coordinatorToolContract.mjs:135-148`). No error or capability flag says whether this caller is managed, so a lead passing `wait_ms` in a managed turn gets silent behaviour (or an error whose text the lead has to parse). Not reproduced live in this session.

## Things that worked

- `coord_read_inbox` with a fresh `request_id` returned cleanly with `nextCursor` (observed).
- `coord_status` returned an `actionable` digest with `myTask`, `replyRequiredCount`, `allTasksTerminal`, and `replyGuardDue`; this is enough to decide the next step without reading the full board (observed).
- Lock grants are visible per task in `coord_status.locks[]` with `leaseExpiresAt` (observed), which made the write-path ownership inspectable.
- `COORDINATOR_OPERATION_UNCERTAIN` at least names the situation rather than failing silently (2586).

## Not tested (limits of this pass)

- No live `coord_delegate` / `coord_wait` mutation was issued from this explorer, to avoid changing the room. Findings 1, 2, and 7 are from code reading plus the contract, and should be confirmed with `scripts/coordDelegateWaitSmoke.ts` / `coordTargetedWaitSmoke.ts` (not run here).
- Restart/timeout recovery for the lead was not exercised; the lead's session was not interrupted.
