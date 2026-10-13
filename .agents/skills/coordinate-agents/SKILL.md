---
name: coordinate-agents
description: Operate Agent Viewer Coordinator runs through coord_* tools. Use for leading/joining, delegation, teammate mail, task/result inspection, uncertain mutations, execution recovery, integration and finalization.
---

# Coordinate Agents

The Coordinator board and mailbox are the run's authoritative state; your memory of them is not. Preserve the user's complete objective.

Read references only when needed:

- [references/protocol-and-hosts.md](references/protocol-and-hosts.md): host startup, rejections, task/operation inspection, pinned recovery/cancellation, result integration and checkout gates.
- [references/playbooks-and-memory.md](references/playbooks-and-memory.md): playbooks, context search, durable project memory and reusable roles.

## Know your host first

Two facts decide most of what follows.

- **Role:** `coord_status` reports yours. Leads plan, delegate, review and synthesize; teammates own one task at a time. A lead-only rejection belongs to the other role; do not retry it.
- **Who waits:** `actionable.waitingPolicy` reports ownership. `managed`: return when idle; the supervisor waits. `interactive`: subscribe if supported, otherwise `coord_wait`. `cooperative`: return to the human; there is no independent wake loop. `unknown`: verify the host's turn prompt before waiting. This policy is independent of liveness and automatic-continuation settings. If absent, follow the host prompt.

## Enter the run

- **Already bound:** call `coord_status`, then `coord_read_inbox`. Keep the identity; do not create or join again. If a restart left you unbound, `coord_resume` with your run and agent IDs; no token needed.
- **Tools exposed but unbound:** if the host supplied a session-bound client command, use that exact command for `coord_status` and keyed `coord_read_inbox`; see the host reference. Do not join a replacement run or inspect credential files.
- **Asked to join:** `coord_join_run` with a unique name, your actual `provider` (it defaults to codex when omitted), and the checkout. Pass the requested run ID, or omit it to take the newest joinable run for that checkout.
- **Asked to lead/start:** `coord_create_run` with the full objective, checkout, actual provider, and a realistic participant limit. Seed tasks before launching teammates.
- **Unattended work:** prefer `agent-viewer coord worker`; it persists identity and waits without model tokens. Startup commands are in the host reference. Joined workers use isolated checkouts unless `--shared`.

If tools or identity are unavailable, diagnose with `agent-viewer coord doctor --json`, `coord workers`, and `coord logs`. Inspect the existing worker before `coord restart`; never create a duplicate to recover it. Never print, message, or commit capability tokens; share only the run ID.

## Multi-agent startup invariant

For a request involving multiple participating agents:

1. Seed independent, immediately claimable teammate lanes with outcomes, acceptance checks, dependencies, and disjoint write paths. Use `role: teammate` for execution and a dependent `role: lead` task for integration/review; `role: any` permits either on purpose.
2. With interactive MCP, create the task graph and check status before starting workers. Unattended startup takes a playbook containing that graph.
3. Keep the lead free to coordinate. Do not absorb teammate lanes into a lead umbrella task. Give a change in a shared file to its existing owner; use read-only review lanes when ownership cannot be split.
4. Verify task ownership after joining. Roster presence, `ready`, heartbeats, and a live process do not prove participation.

Before finalization, verify the requested participation through completed tasks, findings, or substantive replies. Create follow-up work when it is incomplete; report a shortfall honestly if nothing meaningful remains.

## Autonomous coordination loop

While the run is nonterminal:

1. Read inbox and status on entry; let `actionable` choose the next step: answer `replyRequiredCount`, continue `myTask`, claim `claimableTasks`, review `plansAwaitingReview`, or inspect `allTasksTerminal`. Push/wait already carries state. `coord_read_task` returns full receipts/handoffs; `coord_list_tasks` finds older task IDs. Use `coord_query_context` for prior decisions or full findings.
2. Answer `replyRequired` mail with `coord_send_message(kind="response", in_reply_to=<message-id>)`. Reading acknowledges delivery; it does not answer. `coord_read_inbox(unresolved=true)` lists what you still owe, with original ids, without acknowledging anything. Check mail during long work so changed instructions arrive before more edits.
3. Do role-appropriate work. Report new evidence, a blocker, or a changed next action once — through progress, a finding, or mail to those affected — not in every channel, and never mail just to check liveness.
4. Interactive participants heartbeat about every two minutes of long work. Managed supervisors heartbeat for you; still report meaningful progress. On `replyGuardReminder`, report real progress or an obstacle; never invent activity.
5. When nothing is actionable, wait the way your host waits:

**Managed turn:** return control immediately, including while blocked or awaiting approval. Never call `coord_wait`, shell-sleep, poll, or pass `wait_ms`. The supervisor waits and redispatches.

**Interactive host with subscriptions:** subscribe once to `pushResource` (`coord://agent-viewer/current-run`) and re-read it on `notifications/resources/updated`; notifications invalidate state, they are not patches.

**Interactive host without subscriptions:** `coord_wait`. Pass `agent` to wait for one teammate to settle rather than waking on every board change; new mail needing your reply still ends it. Your own writes do not wake it, and an empty or timed-out wait is normal. If the host returns a durable MCP Task, observe it with `tasks/get` instead of starting another wait.

## Lead workflow

- Query prior context before decomposing. Give each task concrete acceptance evidence, narrow paths, and explicit dependencies. A teammate sees the task, not your conversation: put everything it needs in `detail`. Inspect `similarTasks` before duplicating work.
- Assign with `coord_delegate` and a stable `request_id`. Omit `to`/`name` for any idle teammate; `name` reuses or creates one; `to` assigns follow-up work in an existing session. Put the full task context in `detail`. Explicit provider/account/model/effort selection prevents cross-provider failover. Call `coord_capabilities` before choosing model/effort IDs. Steer busy teammates with `coord_send_message`, not a competing assignment.
- `delivery: queued` confirms assignment only. Confirm provider activity and the receipt before claiming execution. In an interactive host, `wait_ms` may return `blocked`, `needs_reply`, `stalled`, or `timeout`: inspect the board and inbox. None of them authorizes repeating the assignment.
- Review plans and phase/run gates promptly. Check agent `liveness` and message `delivery` before waiting on a reply. Cooperative sessions answer at human pace (host reference).
- Human-owned approvals stay with the human. When a run requests human review, or a provider permission/question is pending, surface it through its existing UI and continue independent work. Do not answer it by mail, impersonate the human, enable automatic continuation, or call review tools to get past it.
- Inspect recovery with `coord_inspect_recovery`. After reading the saved transcript, `coord_acknowledge_execution` retires a completed/relinquished reservation; `coord_resume_agent` restarts unfinished work in the saved conversation. Use exact inspection pins and a stable key; neither bypasses human gates or another host. Details are in the host reference.
- Recovery: `coord_cancel_turn` restarts a working teammate's turn and keeps ownership; `coord_release_task` returns work to the board; `coord_handoff_task` also records a failure class and a checkpoint on the task (`contextHandoff`) — read it with `coord_read_handoff` before reassigning. Do not interrupt healthy work.
- Retire obsolete work with `coord_cancel_task`, using `coord_read_task`'s revision after checking `cancellationImpact`; unfinished dependent work can fail. Cancellation does not erase edits or confirm native interruption.
- Inspect isolated changes with `coord_read_result`, then `coord_integrate_result` with its review pin and required stable `request_id`. It can commit the source branch and stages a squash merge in the target. Human review, verification, path and dirty-checkout gates remain enforced. Inspect the entire branch, including later tasks; see the host reference.
- When all tasks are terminal, inspect results, verify participation and integrated behavior, and resolve open decisions/reviews. For a bounded run whose objective is complete, call `coord_finalize_run` with a concise synthesis. In a persistent interactive room, finishing a batch does not close the room: report results and keep it open unless the user asks. If verification finds remaining work, create a follow-up task; that reopens synthesis. Save only durable discoveries with `coord_remember`.

## Teammate workflow

- Continue your owned task or `coord_claim_task` one unblocked lane. A task with a `contextHandoff` was started by someone else: verify its checkpoint against the checkout before building on it. If plan approval is required, `coord_submit_plan` and wait for approval before editing.
- Edit only granted paths; request more with `coord_request_locks` and leave `denied` paths alone. Report `working`, do the task, and verify proportionately. Report `blocked` with the exact obstacle.
- Complete only verified work, with an honest receipt: actual model and usage when observable, changed files, commands run, and unresolved decisions. A gate refusal arrives as `accepted: false` with a reason: fix what it names and call again with the same `request_id`.
- Answer reply-required mail before completing or leaving. If completion reports stale ownership, inspect the task instead of retrying: a release or reassignment changed the claim while you verified.
- Release achievable unfinished work with a reason. After a provider failure use `coord_handoff_task` with the checkpoint, remaining work, and `failure_class`. Fail a task only when it genuinely cannot be done.
- When no more work is expected, `coord_leave_run` after releasing or handing off anything owned. In a persistent interactive room, finish the task and return control, staying available for follow-ups. A lead leaving fails the whole run.

## Mail and recovery

For immediate delivery, leave both `kind` and `priority` off `status`; either one batches mail. `urgent` does not override `kind:"status"`. Use `to:"all"` for shared context; reply to one sender with `in_reply_to`.

Supply a stable `request_id` on the **first** mutation, acknowledging inbox reads included. Retry that operation with identical arguments/key; new work gets a new key. The bridge's generated key covers only retries within one call. After a transport failure, retry reads/keyed writes with the same identity after about two seconds. Unkeyed writes and unknown create/join outcomes require identity/board reconciliation first. On `COORDINATOR_OPERATION_UNCERTAIN`, use `coord_inspect_operation` with the original `tool_name` and `operation_request_id`, then inspect its referenced task. `running` does not prove a live process; `not_found` does not prove nothing applied. Never bypass uncertainty with a new key. Correct validation and gate failures before retrying.

## Shared-checkout guardrails

Preserve existing dirty files and other participants' edits. Keep write locks disjoint and stay in the configured checkout mode. Do not clean, revert, stash, or overwrite another lane to satisfy a gate. If a rejection names only another owner's paths, report the attribution problem and consult the host reference; do not recapture a baseline to disguise your own changes. Take over abandoned paths only after the board releases them.

## Handoff output

Report the run ID, role/name, verified task state, substantive participation, unresolved blockers, and next action concisely. Completion claims must match board and verification evidence.
