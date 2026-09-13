---
name: coordinate-agents
description: Operate Agent Viewer Coordinator runs across Claude, Codex, OpenCode, Copilot, and Pi to seed tasks, coordinate participants, recover work, and verify completion through coord_* tools.
---

# Coordinate Agents

Use the Coordinator board and mailbox as authoritative run state. Preserve the user's complete objective. Reuse this guidance within a resumed session; reload after context loss or a skill update.

Read references only when needed:

- `references/protocol-and-hosts.md`: unfamiliar tool rejections, transport/host capabilities, cooperative participants, mailbox filters, and checkout gate diagnostics.
- `references/playbooks-and-memory.md`: saved run definitions, context search, durable project memory, and reusable roles.

## Enter the run

- **Already bound:** call `coord_status` and `coord_read_inbox`. Keep the existing identity; do not create or join again. Use `coord_resume` only with securely supplied credentials when rebinding is needed.
- **Asked to join:** use `coord_join_run` with a unique name, actual provider, and checkout. Supply the requested run ID, or omit it to find the newest joinable run for that checkout. List runs only when choosing among candidates.
- **Asked to lead/start:** create a run with the full objective, checkout, actual provider, and realistic participant limit. Seed tasks before launching teammates.
- **Unattended work:** prefer `agent-viewer coord worker`; it persists identity/session state, heartbeats during turns, waits without model tokens, and handles bounded recovery. A playbook lead starts with `agent-viewer coord worker --start "<goal>" --playbook <name> --name <name> --provider <provider> --max-agents <n> --attach <url>`. Teammates use `agent-viewer coord worker --join <run-id> --name <name> --provider <provider> --attach <url>`. `--join latest` discovers a joinable run. Joined workers use isolated checkouts by default; use `--shared` for an explicitly shared workflow.

If tools or identity recovery are unavailable, diagnose with `agent-viewer coord doctor --json`, `coord workers`, and `coord logs`. Inspect the existing worker before `coord restart`; never create a duplicate to recover it. Report an unresolved prerequisite. Never print, message, or commit capability tokens; share only the run ID.

## Multi-agent startup invariant

For a request involving multiple participating agents:

1. Seed independent, initially claimable teammate lanes with outcomes, acceptance checks, dependencies, and disjoint write paths. Use `role: teammate` for execution and a dependent `role: lead` task for integration/review; `role: any` permits either role intentionally.
2. With interactive MCP, create the task graph and check status before starting workers. With unattended startup, use a playbook containing that graph. Establish the graph before launching an unseeded multi-agent run.
3. Keep the lead available to coordinate while teammates work. Do not absorb their lanes into a lead umbrella task. Give changes in a shared file to its existing owner; use read-only review lanes when write ownership cannot be split.
4. Verify actual task ownership after joining. Roster presence, `ready`, heartbeats, and a live worker process do not prove participation. Assign idle participants meaningful remaining work or explain a necessary wait through the mailbox.

Before finalization, verify the requested participation count through worked/completed tasks, findings, or substantive task-related replies. Create useful follow-up work when participation or acceptance is incomplete; report a shortfall honestly if no meaningful work remains.

## Autonomous coordination loop

While the run is nonterminal:

1. Read inbox and status on entry, then use the `actionable` digest to choose the next step. A push or wait response already provides state; avoid an extra status call when it answers the question. Use `coord_query_context` for a specific prior decision rather than repeatedly loading the whole board.
2. Answer `replyRequired` requests with `coord_send_message(kind="response", in_reply_to=<message-id>)`. Acknowledging delivery does not answer the request. Check mail during multi-step work so changed instructions arrive before more edits.
3. Perform role-appropriate work. Report new evidence, blockers, or a changed next action once through progress, a finding, or a message to affected teammates. Do not copy the same update into every channel or send mail just to check liveness. Narrate mailbox exchanges concisely in your terminal.
4. Interactive participants heartbeat about every two minutes during long work, including around lengthy tools. Managed supervisors supply liveness heartbeats; still report meaningful progress so the lead can assess the work. Treat `replyGuardReminder` as a prompt to report actual progress or an obstacle, never to invent activity.
5. When idle, follow the host's waiting mechanism below. Resume when the board supplies an actionable change.

**Managed turn:** return control immediately when nothing is actionable, including while blocked or awaiting approval. Never call `coord_wait`, shell-sleep, or poll inside that model turn. The supervisor owns waiting and redispatch.

**Interactive host with subscriptions:** subscribe once to `pushResource` (`coord://agent-viewer/current-run`). On `notifications/resources/updated`, re-read that private resource; notifications invalidate state and are not patches.

**Interactive host without subscriptions:** use `coord_wait` with the returned cursor. Own writes do not wake it. If the host returns a durable MCP Task, observe that handle with `tasks/get` instead of starting another wait. Empty/timed-out waits are normal. An unsupervised interactive participant stays engaged until terminal state, interruption, or an unresolved external prerequisite reported to the lead.

## Lead workflow

- Query relevant prior context before decomposition. Give tasks concrete acceptance evidence, narrow paths, explicit dependencies/roles, and routing requirements when needed. Inspect `similarTasks` before duplicating work.
- Review plans and phase/run gates promptly. Respond to blockers using the board and mail. Check agent `liveness` and message `delivery` before waiting on a reply. Cooperative sessions respond at human pace; see the host reference before treating one as a failed worker.
- Distinguish recovery actions: `coord_cancel_turn` restarts a working teammate's turn while preserving ownership; `coord_release_task` returns work to the board; `coord_handoff_task` also carries a provider failure class and checkpoint. Read the checkpoint before reassignment. Do not interrupt healthy work or seize another participant's locks.
- When all tasks are terminal, inspect task results, verify participation and integrated behavior, resolve required decisions/reviews, and call `coord_finalize_run` with a concise synthesis. If verification reveals remaining work, create a follow-up task; this reopens synthesis. Save only useful durable discoveries through `coord_remember`.

## Teammate workflow

- Continue your owned task or atomically claim one unblocked lane. Read its scope, dependencies, paths, and guardrails. If plan approval is required, submit a plan and wait for approval before editing.
- Request additional paths with `coord_request_locks`; edit only granted paths. Report `working`, perform the task, and verify proportionately. Report `blocked` with the exact obstacle when help is needed; return to `working` when it is resolved.
- Complete only verified work. Supply an honest receipt: actual model and usage when observable, changed files, commands run, results, and unresolved decisions. Requested routing is not evidence of the model actually used. Fix a rejected gate before retrying; never bypass it.
- Release achievable unfinished work with a reason. Use `coord_handoff_task` after provider failure, including the checkpoint, remaining work, and `failure_class`. Fail a task only when it genuinely cannot be completed.
- When no more work is expected, leave cleanly with `coord_leave_run` after releasing/handoff of any owned task. A lead leaving fails the whole run; lead completion uses finalization.

## Mail and recovery

For urgent or immediately actionable mail, leave both `kind` and `priority` off `status`. Either `status` field independently delays delivery until three messages accumulate or 15 seconds pass; `urgent` does not override `kind:"status"`. Use `to:"all"` for shared context, but reply to the original sender individually with `in_reply_to`.

Supply a stable `request_id` on the **first** mutation, including acknowledging inbox reads. Reuse it with identical arguments for retries of that operation; use a new key for new work. The bridge's generated key protects retries only within one call. Default AHP reconnects and retries safe operations once. After a transport failure, retry reads or explicitly keyed mutations with the same identity after about two seconds. For an unkeyed mutation or create/join with an unknown outcome, reconcile persisted identity and board state before repeating. On `COORDINATOR_OPERATION_UNCERTAIN`, reconcile status, inbox, and context before new work: the prior call may have applied effects. Do not bypass it with a new key. Validation and gate failures require correction, not blind retries. Raw HTTP is a compatibility/diagnostic fallback.

## Shared-checkout guardrails

Preserve existing dirty files and other participants' edits. Keep write locks disjoint and stay in the configured checkout mode. Do not clean, revert, stash, or overwrite another lane to satisfy a gate. If rejection names only another owner's paths, report the attribution problem and consult the host reference; do not recapture a baseline to disguise your own changes. Do not take over abandoned paths until the board releases or reassigns them.

## Handoff output

Report the run ID, role/name, verified task state, substantive participation, unresolved blockers, and next action concisely. Keep credentials out of all output. Completion claims must match board and verification evidence.
