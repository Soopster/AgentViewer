# Teammate-side Coordinator friction — 2026-10-04

Scope: a claimed-task teammate finishing long-running work autonomously through
`coord_*` tools. Method: static read of the contract and server handlers, plus
read-only live inspection of run `chat-27e138135b53e5c4e9a46b72208f063ec74ec4c4`
(`coord_status`, `coord_read_inbox` on my own task-2). **No mutations were issued
against the run** (no claim, complete, lock, or progress calls), so the failure
modes below are from code paths, not observed incidents, unless marked *observed*.
No `lib/` edits were made.

## Ranked bottlenecks

### 1. Mutations without `request_id` are not idempotent (retry-unsafe) — high
- `lib/coordinatorToolContract.mjs:399-403`: `request_id` is added to every tool as
  **optional**, and forwarded only when present.
- `lib/agentCoordinationExternal.ts:143-147`: `mutate()` passes straight through when
  `requestId` is absent.
- `lib/agentCoordination.ts:2551`: `runExternalProtocolIdempotent` returns
  `operation()` when no key is supplied — no dedupe at all.
- Effect: a teammate whose `coord_complete_task` / `coord_claim_task` /
  `coord_request_locks` response is lost (turn interrupted, bridge timeout) and who
  retries will run the mutation twice. For `complete_task` that means a second
  receipt; for `claim_task` it means a claim against a task it already owns.
- The shell fallback *does* warn (`lib/coordinatorSessionClient.ts`, CLIENT_SOURCE:
  "A submitted mutation may have applied… reuse the identical request_id"), but the
  native MCP path gives no such instruction and no per-tool requirement.

### 2. Mail is acknowledged on read, before it is acted on — high
- `lib/agentCoordinationExternal.ts:258`: `acknowledge: body.acknowledge !== false`
  — teammate `coord_read_inbox` defaults to acknowledging.
- `lib/agentCoordination.ts:3286-3292`: rows are marked acknowledged in the same
  transaction as the read.
- The lead-side sweep reads with `acknowledge: false` (`lib/agentCoordination.ts:2517`),
  which shows the team already knows read-without-ack is the safe mode.
- Effect: a teammate that reads a steering message or a reply-required request and
  then is interrupted or restarts before acting loses the message from its inbox.
  Nothing re-surfaces it.

### 3. `status: idle` with `turnActive: true` — blocked vs working is ambiguous — high
- *Observed*: `coord_status` lists my own agent (`agent-2`) as
  `"status":"idle"` while `"turnActive":true` and `progressEvidence.signal:"turn"`,
  and my claimed task as `claimed` until my first `coord_progress`.
- The status field is the one a lead or a restarted teammate reads first; `idle`
  reads as "waiting for work", which is the opposite of what is happening.
- Effect: neither side can tell from the headline status whether a teammate is
  working, parked on a lock, or waiting on plan approval. `coord_progress` offers
  `working` / `blocked` but a teammate that never sends `working` stays `idle`.
- `lib/agentCoordination.ts:3470-3473` correctly refuses `working`/`blocked` without
  an owned task, which is good, but nothing ties the status to the live turn.

### 4. Lock denials arrive in a *successful* result — medium-high
- `lib/agentCoordination.ts:3440-3450`: `requestExternalProtocolLocks` returns
  `{ granted, denied }` inside a normal return value; `mutate()` does not throw.
- Effect: a teammate that checks only for a throw will proceed to edit paths it
  does not hold. The denial reason is accurate (`conflicts with an active lock held
  by … on …`), but it is easy to miss.

### 5. Two rejection channels for plan approval and completion — medium
- External completion rejection (`lib/agentCoordination.ts:3686-3700`,
  `rejectExternalCompletion`) returns `{ accepted: false, reason }` to the caller and
  records `agent.blocked`, but leaves the task claimed and **sets no dispatch note**.
- The event-path rejection (`lib/agentCoordination.ts:7916-7931`) does set
  `controller.dispatchNotes`, so the *next* dispatch carries the instruction
  ("emit `task.planned`… wait for `plan.approved`").
- Effect: a teammate that completes via the tool gets a rejection with no
  follow-up guidance on its next turn unless it reads the tool result carefully.
  The plan-gate check itself (`lib/agentCoordination.ts:3832-3833`) is correct.

### 6. Errors are plain strings with no retryable/terminal distinction — medium
- Budget gate: `lib/agentCoordination.ts:3168` throws `Cannot claim more work: …`.
- Claim misses: `lib/agentCoordination.ts:3214-3241` return `No claimable task: …`
  strings that differ only by suffix. These are specific, but a teammate has to
  parse prose to decide between "wait and retry" (lock held, dependency
  incomplete) and "stop" (run not running, budget exhausted, owns another task).
- The `coord_claim_task` description (`coordinatorToolContract.mjs`) does not say
  which of these a teammate should wait out.

### 7. Lock lease is 20 minutes and renews only on activity — medium-low
- `lib/agentCoordination.ts:192`: `LOCK_LEASE_MS = 20 * 60_000`.
- `lib/agentCoordination.ts:2501-2504`: leases are refreshed when the agent records
  activity.
- Effect: a single silent tool run or long model turn longer than 20 minutes lets
  another participant claim the same paths (`lease_expires_at > ?` at
  `lib/agentCoordination.ts:1193`). That is intended, but the teammate is not told
  its lease lapsed, and the next `request_locks` looks like a fresh grant.

### 8. In-memory idempotency in-flight map — low (restart window)
- `lib/agentCoordination.ts:2548-2560`: concurrent-duplicate suppression uses an
  in-process `Map`. The persisted table (`lib/agentCoordination.ts:640-666`) covers
  completed requests, so a retry *after* a restart is safe **if** a request_id was
  supplied (see #1). A retry that races a restart with a key still in flight is the
  only unhandled case.

## What works (keep)
- `coord_progress` rejects `working`/`blocked` without an owned task, with a
  message that says what to do (`lib/agentCoordination.ts:3472-3473`).
- Shell fallback error text explicitly distinguishes "bridge unreachable" from
  "request rejected" and tells the caller to reconcile before retrying
  (`lib/coordinatorSessionClient.ts`, CLIENT_SOURCE).
- Claim misses name the blocking dependency or lock holder
  (`lib/agentCoordination.ts:3235`, `:3241`).

## Not verified
- No live `complete_task` rejection, lock conflict, or interrupted-turn recovery was
  exercised. Items 1, 2, 4 and 5 are code-path findings and should be confirmed with
  one scripted run (claim → kill turn → re-read inbox → retry complete) before they
  drive fixes.
- Restart recovery for a teammate whose session is re-attached was not traced end to
  end.
