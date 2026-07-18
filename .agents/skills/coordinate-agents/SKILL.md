---
name: coordinate-agents
description: Start, join, and operate an Agent Viewer Coordinator run through the agent-viewer MCP. Use when a Codex or Claude CLI session should coordinate with other external CLIs, fan a goal into parallel tasks, claim work, exchange inbox messages, manage path locks or plan approval, monitor teammates autonomously, synthesize results, or finalize a multi-agent run.
---

# Coordinate Agents

Use the `agent-viewer` MCP Coordinator tools as the source of truth. Keep working until the run is terminal or the user interrupts.

## Enter the run

1. For unattended work, prefer the bounded supervisor. It persists identity and provider sessions, heartbeats during turns, waits without token usage, and restarts failed ticks:
   - Lead: `agent-viewer coord worker --start "<goal>" --name <name> --provider codex|claude --attach <url>`
   - Teammate: `agent-viewer coord worker --join <run-id> --name <name> --provider codex|claude --attach <url>` (`--join latest` auto-discovers the newest joinable run)
   Joined teammates receive an isolated git worktree by default; use `--shared` only when explicitly required.
2. In an already-running interactive CLI, confirm the `coord_*` MCP tools are available. If not, report that the Agent Viewer MCP must be configured and stop.
3. Determine the mode from the request:
   - Join when a run ID is supplied, or when asked to join without one. Call `coord_join_run` with a unique descriptive name, the actual provider, and the current worktree path; omit `run_id` to auto-join the newest joinable run for this checkout. Use `coord_list_runs` only when you need to choose between several live runs.
   - Start when the user asks to create, coordinate, lead, or fan out a goal and provides no run ID. Call `coord_create_run` with the complete objective, actual provider, current worktree, and a realistic participant limit.
   - Resume when participant credentials are already configured. Call `coord_status`; use `coord_resume` only when explicit run ID, agent ID, and token values were supplied securely.
4. Never print, message, commit, or otherwise disclose a participant capability token. Identity is persisted in a mode-0600 file; share only the run ID with people or other CLIs.
5. Read `coord_status` and `coord_read_inbox` immediately after entering.

## Playbooks (reusable runs)

A playbook is a saved run definition — the plan held in an artifact instead of a planning turn, like Claude Code dynamic workflows. Playbooks live in `<checkout>/.agent-viewer/playbooks/<name>.json` and are shared with everyone who clones the repo.

- Discover them with `coord_list_playbooks`; each entry shows a description and an `argsHint` for what to pass.
- Run one with `coord_create_run` using `playbook_name` and `args` — the whole task board is seeded instantly with phases as dependency barriers (phase N+1 waits for all of phase N), and `{{args}}` / `{{args.<key>}}` placeholders in task text are filled from `args`. No lead planning turn is needed; teammates can claim immediately.
- When a run's board is worth repeating, the lead saves it with `coord_save_playbook` (a name slug, description, and args hint). Prefer running a saved playbook over re-deriving the same plan.
- Status responses include a `phases` rollup (per-phase task counts) — use it to report progress phase by phase.
- A single CLI can kick off a playbook run alone and then staff it either way: spawn unattended workers with `agent-viewer coord worker --join latest --name <name> --provider codex|claude` (one per lane, via the shell) and supervise as lead, or — when no teammates are expected — claim and work the tasks itself phase by phase. Claiming is not role-restricted; phase barriers enforce order either way.

## Lead workflow

When the participant role is `lead`:

1. Decompose the objective into small independently claimable tasks before editing (or seed the board from a playbook and skip planning).
2. Create tasks with `coord_create_task`. Give each task:
   - a concrete outcome and acceptance check;
   - the narrowest expected write paths;
   - explicit dependencies when another task must finish first.
3. Prefer separate clean worktrees for each external CLI. Do not assign overlapping paths to parallel tasks.
4. Keep one integration or review task for the lead when useful; otherwise coordinate instead of duplicating teammate work.
5. Send important context or changed priorities through `coord_send_message`; do not assume another CLI sees local terminal output.
6. Review submitted plans promptly when plan approval is enabled.
7. Monitor status, inbox, findings, blocked tasks, and expired or conflicting locks. Respond to blockers with a message or a new task. Requeue a wedged or failed task with `coord_release_task` so another participant can claim it.
8. When all tasks are terminal, inspect the board, reconcile findings, run any final integration checks, and call `coord_finalize_run` with a concise synthesis. If the review uncovers follow-up work, call `coord_create_task` instead — during synthesis this reopens the run.

## Teammate workflow

When the participant role is `teammate`:

1. Drain the inbox, then atomically claim one unblocked task with `coord_claim_task`.
2. Read the task outcome, dependencies, paths, and run guardrails before editing.
3. If plan approval is required, call `coord_submit_plan` and wait for approval before modifying files.
4. Request any additional write paths with `coord_request_locks` before editing. Stay inside granted paths.
5. Call `coord_progress` with `working`, perform the task, and run proportionate verification.
6. Publish reusable discoveries with `coord_publish_finding`. Add newly discovered work to the board with `coord_create_task` (any participant may create tasks). Send direct questions or handoffs with `coord_send_message`.
7. Call `coord_complete_task` only after verification. If completion is rejected, address the stated gate failure and retry (the same `request_id` is safe — rejections are never replayed from cache); never bypass the gate or claim work that was not performed.
8. If you cannot finish a claimed task but it remains achievable, hand it back with `coord_release_task` and a reason so someone else can claim it. Call `coord_fail_task` only when the task genuinely cannot be completed, with a useful reason and recovery detail.

## Autonomous coordination loop

Repeat while the run is `planning`, `running`, or `synthesizing`:

1. Read and acknowledge the inbox.
2. Read status and react to the `actionable` digest — it lists your claimable tasks, undelivered inbox count, plans awaiting your review (lead), and your own task's state, so you rarely need to diff snapshots.
3. Perform the next role-appropriate action.
4. Report a heartbeat or meaningful progress during long work.
5. When no immediate action exists, call `coord_wait` with the previous cursor. Do not shell-sleep or repeatedly poll status. Your own writes do not wake your wait; it returns when another participant changes the run, with the new `events` and a fresh `actionable` digest.
6. After any wait, act on `actionable` and the returned events; the snapshot is authoritative if anything is unclear.

Do not end merely because the board is temporarily idle. End when the run becomes `completed`, `failed`, or `stopped`; the user interrupts; or an external prerequisite cannot be resolved after notifying the lead.

## Shared-checkout guardrails

- Treat existing dirty files as belonging to their current owner. Never overwrite or clean them to satisfy a completion gate.
- Completion is baseline-aware: pre-existing dirty files are ignored unless this participant changes them after claiming. Still prefer isolated worktrees because concurrent edits remain unsafe.
- Treat mailbox delivery as at-least-once. Supply a stable `request_id` before retrying any mutation so the Coordinator can return the original result.
- If a participant disappears, notify the lead. Do not silently take its owned task or paths until the board releases or reassigns them.

## Handoff output

Keep user-facing updates concise. Include the run ID, participant role and name, task state, blockers, and next action. Never include the capability token.
