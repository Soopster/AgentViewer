---
name: coordinate-agents
description: Start, join, and operate an Agent Viewer Coordinator run through the agent-viewer MCP. Use when a Codex or Claude CLI session should coordinate with other external CLIs, fan a goal into parallel tasks, claim work, exchange inbox messages, manage path locks or plan approval, monitor teammates autonomously, synthesize results, or finalize a multi-agent run.
---

# Coordinate Agents

Use the `agent-viewer` MCP Coordinator tools as the source of truth. Keep working until the run is terminal or the user interrupts.

## Enter the run

1. For unattended work, prefer the bounded supervisor. It persists identity and provider sessions, heartbeats during turns, waits without token usage, and restarts failed ticks:
   - Lead: `agent-viewer coord worker --start "<goal>" --name <name> --provider codex|claude --attach <url>`
   - Teammate: `agent-viewer coord worker --join <run-id> --name <name> --provider codex|claude --attach <url>`
   Joined teammates receive an isolated git worktree by default; use `--shared` only when explicitly required.
2. In an already-running interactive CLI, confirm the `coord_*` MCP tools are available. If not, report that the Agent Viewer MCP must be configured and stop.
3. Determine the mode from the request:
   - Join when a run ID is supplied. Call `coord_join_run` with a unique descriptive name, the actual provider, and the current worktree path.
   - Start when the user asks to create, coordinate, lead, or fan out a goal and provides no run ID. Call `coord_create_run` with the complete objective, actual provider, current worktree, and a realistic participant limit.
   - Resume when participant credentials are already configured. Call `coord_status`; use `coord_resume` only when explicit run ID, agent ID, and token values were supplied securely.
4. Never print, message, commit, or otherwise disclose a participant capability token. Identity is persisted in a mode-0600 file; share only the run ID with people or other CLIs.
5. Read `coord_status` and `coord_read_inbox` immediately after entering.

## Lead workflow

When the participant role is `lead`:

1. Decompose the objective into small independently claimable tasks before editing.
2. Create tasks with `coord_create_task`. Give each task:
   - a concrete outcome and acceptance check;
   - the narrowest expected write paths;
   - explicit dependencies when another task must finish first.
3. Prefer separate clean worktrees for each external CLI. Do not assign overlapping paths to parallel tasks.
4. Keep one integration or review task for the lead when useful; otherwise coordinate instead of duplicating teammate work.
5. Send important context or changed priorities through `coord_send_message`; do not assume another CLI sees local terminal output.
6. Review submitted plans promptly when plan approval is enabled.
7. Monitor status, inbox, findings, blocked tasks, and expired or conflicting locks. Respond to blockers with a message or a new task.
8. When all tasks are terminal, inspect the board, reconcile findings, run any final integration checks, and call `coord_finalize_run` with a concise synthesis.

## Teammate workflow

When the participant role is `teammate`:

1. Drain the inbox, then atomically claim one unblocked task with `coord_claim_task`.
2. Read the task outcome, dependencies, paths, and run guardrails before editing.
3. If plan approval is required, call `coord_submit_plan` and wait for approval before modifying files.
4. Request any additional write paths with `coord_request_locks` before editing. Stay inside granted paths.
5. Call `coord_progress` with `working`, perform the task, and run proportionate verification.
6. Publish reusable discoveries with `coord_publish_finding`. Send direct questions or handoffs with `coord_send_message`.
7. Call `coord_complete_task` only after verification. If completion is rejected, address the stated gate failure; never bypass it or claim work that was not performed.
8. Call `coord_fail_task` only when the task genuinely cannot be completed, with a useful reason and recovery detail.

## Autonomous coordination loop

Repeat while the run is `planning`, `running`, or `synthesizing`:

1. Read and acknowledge the inbox.
2. Read status and react to task, plan, lock, participant, or run changes.
3. Perform the next role-appropriate action.
4. Report a heartbeat or meaningful progress during long work.
5. When no immediate action exists, call `coord_wait` with the previous cursor. Do not shell-sleep or repeatedly poll status.
6. After any wait, assume state may have changed and reread the board before acting.

Do not end merely because the board is temporarily idle. End when the run becomes `completed`, `failed`, or `stopped`; the user interrupts; or an external prerequisite cannot be resolved after notifying the lead.

## Shared-checkout guardrails

- Treat existing dirty files as belonging to their current owner. Never overwrite or clean them to satisfy a completion gate.
- Completion is baseline-aware: pre-existing dirty files are ignored unless this participant changes them after claiming. Still prefer isolated worktrees because concurrent edits remain unsafe.
- Treat mailbox delivery as at-least-once. Supply a stable `request_id` before retrying any mutation so the Coordinator can return the original result.
- If a participant disappears, notify the lead. Do not silently take its owned task or paths until the board releases or reassigns them.

## Handoff output

Keep user-facing updates concise. Include the run ID, participant role and name, task state, blockers, and next action. Never include the capability token.
