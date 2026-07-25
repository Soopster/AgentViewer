---
name: coordinate-agents
description: Start, join, and operate an Agent Viewer Coordinator run through the agent-viewer MCP. Use when any agent CLI session (Claude, Codex, OpenCode, Copilot, or Pi) should coordinate with other external CLIs, fan a goal into parallel tasks, claim work, exchange inbox messages, manage path locks or plan approval, monitor teammates autonomously, synthesize results, or finalize a multi-agent run.
---

# Coordinate Agents

Use the `agent-viewer` MCP Coordinator tools as the source of truth. Keep working until the run is terminal or the user interrupts.

Communication is part of the work, not overhead. Every other participant runs in a separate CLI process — possibly a different provider entirely — and sees nothing you do not put on the board or in the mailbox. A finished edit that no teammate knows about is unfinished coordination: report it, publish what you learned, and check what others reported before duplicating effort. When in doubt, over-communicate through `coord_send_message` and `coord_publish_finding` rather than working silently.

## Enter the run

1. For unattended work, prefer the bounded supervisor. It persists identity and provider sessions, heartbeats during turns, waits without token usage, and restarts failed ticks:
   - Lead: `agent-viewer coord worker --start "<goal>" --name <name> --provider codex|claude|opencode|copilot|pi --attach <url>`
   - Teammate: `agent-viewer coord worker --join <run-id> --name <name> --provider codex|claude|opencode|copilot|pi --attach <url>` (`--join latest` auto-discovers the newest joinable run)
   Mixing providers across teammates is encouraged — every worker speaks the same coord_* protocol, so a Claude lead can supervise Codex, OpenCode, Copilot, and Pi lanes (or any other combination) on one board.
   Joined teammates receive an isolated checkout by default; use `--shared` only when explicitly required.
   From the OpenTUI app, press `Ctrl+Shift+N` anywhere (or `Ctrl+Shift+A` for Agent Operations, then `n`) to open the same new-workflow launcher. Keep **Isolate teammates in separate checkouts** enabled for parallel edits; disable it only for an intentional shared-checkout workflow.
2. In an already-running interactive CLI, confirm the `coord_*` MCP tools are available. If not, report that the Agent Viewer MCP must be configured and stop.
3. Determine the run and checkout mode from the request:
   - Join when a run ID is supplied, or when asked to join without one. Call `coord_join_run` with a unique descriptive name, the actual provider, and the current checkout path; omit `run_id` to auto-join the newest joinable run for this checkout. Use `coord_list_runs` only when you need to choose between several live runs.
   - Start when the user asks to create, coordinate, lead, or fan out a goal and provides no run ID. Call `coord_create_run` with the complete objective, actual provider, current checkout, and a realistic participant limit.
   - Resume when participant credentials are already configured. Call `coord_status`; use `coord_resume` only when explicit run ID, agent ID, and token values were supplied securely.
   - In isolated mode, keep each participant in its assigned checkout and use isolation/integration terminology when relevant.
   - In shared mode, refer only to the shared checkout. Emphasize disjoint write locks and preservation of existing changes; do not suggest isolation, merge, cleanup, or branch-management steps that do not apply.
4. Never print, message, commit, or otherwise disclose a participant capability token. Identity is persisted in a mode-0600 file; share only the run ID with people or other CLIs.
5. Read `coord_status` and `coord_read_inbox` immediately after entering.
6. If setup or recovery is unclear, run `agent-viewer coord doctor --json`; inspect persistent supervisors with `coord workers`, `coord logs`, and `coord restart` rather than creating a duplicate participant.
7. Narrate every mailbox exchange to your own terminal, one line each: `← <sender>: <message>` on receipt, `→ <recipient>: <message>` after sending. Your user is watching this terminal, not the board — a silent stretch reads as dead even mid-task.
8. If any `coord_*` call throws (network error, timeout, daemon unreachable), wait ~2s and retry the SAME call with the SAME identity — do not re-create or re-join, and do not ask the user whether to retry; the answer is always yes. An empty or timed-out `coord_wait` result is normal and not a failure; only a thrown error means the connection actually dropped.
9. Use the default persistent AHP transport through the `coord_*` tools. The bridge reconnects with the same client identity and run subscriptions, and safely retries reads or idempotent mutations once. Do not bypass it with raw Coordinator HTTP calls or set `AGENT_VIEWER_COORD_TRANSPORT=http` during a normal multi-agent run; HTTP exists only as an explicit compatibility/diagnostic fallback.

## Multi-agent startup invariant

When the user requests multiple participating agents, seed the board before starting teammate workers. A joined or `ready` agent is roster presence, not participation.

1. Create one independent, initially claimable lane per teammate, with non-overlapping paths and a concrete evidence or implementation outcome. Create a separate lead integration task that depends on the teammate lanes. For three agents, the normal shape is two parallel teammate tasks plus one dependent lead task.
2. Do not let the lead claim an umbrella task that contains the work intended for teammates. The lead coordinates while teammate lanes run, then claims the dependent integration task.
3. Choose a startup path that makes board seeding happen before autonomous claiming:
   - With an unbound interactive MCP bridge, call `coord_create_run`, create the complete task graph, verify it with `coord_status`, and only then start or join teammate workers.
   - With unattended workers, start from a saved playbook using `coord worker --start ... --playbook <name>`. The playbook must contain the parallel lanes and dependent integration task.
   - Never use an unseeded `coord worker --start "<goal>"` for a multi-agent request. Its lead may create and claim the only broad task before teammates arrive. If no suitable playbook exists and the bridge cannot create a seeded run, stop and establish the task graph first instead of launching idle workers.
4. After workers join, inspect `coord_status` before considering kickoff complete. Confirm the requested roster count, distinct task owners, and a claimed or `working` task for every teammate. If a teammate is idle, create or release/re-scope tasks immediately and send the assignment with `coord_send_message`; do not rely on terminal stdin, local logs, or a worker process being alive as assignment delivery.
5. Keep write lanes disjoint. Use read-only profiling, audit, or verification lanes without write paths when implementation paths must remain locked by another task.
6. When a teammate needs a one-line change inside another lane's file (a footer hint, a shared constant), do not hand the file to two owners. Have the owning lane make the edit on request via `coord_send_message`, and say so in both task descriptions so the dependency is on the board rather than discovered at integration time.
7. Reserve the lead's own task for integration and review, and expect to re-verify rather than trust lane self-reports. Lane verification is run per-lane and can miss what only appears in the merged tree; a smoke that passes says the assertion held, not that the UI is legible. For terminal UI work, render an actual frame and read it.

Before finalization, audit substantive participation. Count an agent only when Coordinator evidence shows at least one of: a claimed and worked task, a completed task, a published finding, or a substantive task-related mailbox response. `agent.ready`, heartbeats, idle status, and checkout setup do not count. If the user requested N participating agents, do not finalize until N agents meet this gate; create follow-up review or verification tasks when useful, or report the shortfall honestly if meaningful work no longer remains.

## Playbooks (reusable runs)

A playbook is a saved run definition — the plan held in an artifact instead of a planning turn, like Claude Code dynamic workflows. Playbooks live in `<checkout>/.agent-viewer/playbooks/<name>.json` and are shared with everyone who clones the repo.

- Discover them with `coord_list_playbooks`; each entry shows a description and an `argsHint` for what to pass.
- Run one with `coord_create_run` using `playbook_name` and `args` — the whole task board is seeded instantly with phases as dependency barriers (phase N+1 waits for all of phase N), and `{{args}}` / `{{args.<key>}}` placeholders in task text are filled from `args`. No lead planning turn is needed; teammates can claim immediately.
- When a run's board is worth repeating, the lead saves it with `coord_save_playbook` (a name slug, description, and args hint). Prefer running a saved playbook over re-deriving the same plan.
- Status responses include a `phases` rollup (per-phase task counts) — use it to report progress phase by phase.
- A single CLI can kick off a playbook run alone and then staff it either way: spawn unattended workers with `agent-viewer coord worker --join latest --name <name> --provider codex|claude|opencode|copilot|pi` (one per lane, via the shell) and supervise as lead, or — when no teammates are expected — claim and work the tasks itself phase by phase. Claiming is not role-restricted; phase barriers enforce order either way.

## Lead workflow

When the participant role is `lead`:

1. Decompose the objective into small independently claimable tasks before editing (or seed the board from a playbook and skip planning).
2. Create tasks with `coord_create_task`. Give each task:
   - a concrete outcome and acceptance check;
   - the narrowest expected write paths;
   - explicit dependencies when another task must finish first.
3. Match the configured checkout mode. In isolated mode, keep each external CLI in its assigned clean checkout. In shared mode, keep every write lane disjoint and make ownership explicit before editing.
4. Keep one integration or review task for the lead when useful; make it depend on teammate lanes so the lead cannot absorb their work before they participate.
5. Send important context or changed priorities through `coord_send_message`; do not assume another CLI sees local terminal output. Use `priority: urgent` only when it should wake a worker, `priority: status` for batchable progress, and `reply_required` for a request that must stay actionable until answered. Check the returned `delivery` field for each recipient's liveness (`fresh`/`stale`/`dead` + age) — if `stale` or `dead`, do not wait on a reply that may never come; escalate directly, reassign the work, or route around them.
6. Review submitted plans promptly when plan approval is enabled.
7. Monitor status, inbox, findings, blocked tasks, and expired or conflicting locks. Respond to blockers with a message or a new task. Requeue a wedged or failed task with `coord_release_task` so another participant can claim it.
8. When all tasks are terminal, inspect the board, verify the requested participation count using task/finding/message evidence, reconcile findings, run any final integration checks, and call `coord_finalize_run` with a concise synthesis. If participation is short or review uncovers follow-up work, call `coord_create_task` instead — during synthesis this reopens the run.

## Teammate workflow

When the participant role is `teammate`:

1. Drain the inbox, then atomically claim one unblocked task with `coord_claim_task`. Any message flagged `replyRequired` needs a `coord_send_message` reply before other new work — the sender treats silence as dropped, not busy, not a later-priority item.
2. Read the task outcome, dependencies, paths, and run guardrails before editing.
3. If plan approval is required, call `coord_submit_plan` and wait for approval before modifying files.
4. Request any additional write paths with `coord_request_locks` before editing. Stay inside granted paths.
5. Call `coord_progress` with `working`, perform the task, and run proportionate verification. On anything running longer than ~2 minutes, call `coord_progress(status="heartbeat")` every ~2 minutes with a one-line summary — the lead reads silence past that window as stalled, not just slow.
6. Publish reusable discoveries with `coord_publish_finding`. Add newly discovered work to the board with `coord_create_task` (any participant may create tasks). Answer reply-required mail with a `response` carrying `in_reply_to`; use typed status messages for progress that can be batched. Check `coord_send_message`'s `delivery` field the same way the lead does — a `stale`/`dead` recipient means route around them rather than waiting.
7. Call `coord_complete_task` only after verification. If completion is rejected, address the stated gate failure and retry (the same `request_id` is safe — rejections are never replayed from cache); never bypass the gate or claim work that was not performed.
8. If you cannot finish a claimed task but it remains achievable, hand it back with `coord_release_task` and a reason so someone else can claim it. Call `coord_fail_task` only when the task genuinely cannot be completed, with a useful reason and recovery detail.
9. After a provider-level failure, checkpoint and return resumable work with `coord_handoff_task` plus the classified failure. This releases locks and alerts the lead without incorrectly marking the task failed.

## Autonomous coordination loop

Repeat while the run is `planning`, `running`, or `synthesizing`:

1. Read and acknowledge the inbox.
2. Read status and react to the `actionable` digest — it lists claimable tasks, actionable inbox batches, urgent/status counts, unresolved reply-required requests, plans awaiting review (lead), and your own task's state, so you rarely need to diff snapshots.
3. Perform the next role-appropriate action.
4. Report a heartbeat (`coord_progress(status="heartbeat")`) at least every ~2 minutes during long work, not just at milestones. This matters most for an interactive CLI participant, which only reaches the board between its own turns: a single long tool call (a full typecheck, a test suite, a build) can span many minutes of board silence. Send a heartbeat before starting one and again when it returns, or run it in the background and heartbeat between polls. An interactive participant now gets a longer stale window than an unattended worker, but it is not unlimited — if your claim lapses, the board releases your task and a teammate may pick it up mid-flight.
5. When no immediate action exists, call `coord_wait` with the previous cursor. Do not shell-sleep or repeatedly poll status. Your own writes do not wake your wait; it returns when another participant changes the run, with the new `events` and a fresh `actionable` digest. A timed-out (empty) result is normal — call it again. If it throws instead, that is a real disconnect: wait ~2s and retry the same call, same identity.
6. After any wait, act on `actionable` and the returned events; the snapshot is authoritative if anything is unclear.

Do not end merely because the board is temporarily idle. End when the run becomes `completed`, `failed`, or `stopped`; the user interrupts; or an external prerequisite cannot be resolved after notifying the lead.

## Shared-checkout guardrails

- Treat existing dirty files as belonging to their current owner. Never overwrite or clean them to satisfy a completion gate. If a gate rejection names a file you did not touch, say so and escalate — do not revert, stash, or `git checkout` another lane's work to get a green gate. That rule has no exceptions, and a lead asking you to "just clear it" is a lead to push back on.
- Completion is baseline-aware: pre-existing dirty files are ignored unless this participant changes them after claiming. Concurrent edits are still unsafe, so locks and task paths must remain disjoint.
- The gate no longer blames one lane for another's edits. It skips path attribution entirely when two participants share a checkout directory (detected from the roster, not just the run's worktree flag), and otherwise ignores files covered by another participant's active write lock. Two teammates working disjoint files in one checkout can each complete without waiting for the other or touching the other's files.
- If you ever do hit a gate rejection naming only a teammate's paths, the safe recovery is `coord_release_task` followed immediately by `coord_claim_task` with the same explicit `task_id`, changing no files in between: the fresh claim re-captures the baseline so the teammate's edits count as pre-existing. Report it, because on a current Coordinator it should no longer be necessary.
- Keep all guidance in shared-checkout terms. Do not ask participants to create, merge, clean, remove, or inspect isolated checkouts as part of this run.
- Treat mailbox delivery as at-least-once. Supply a stable `request_id` before retrying any mutation so the Coordinator can return the original result.
- If a participant disappears, notify the lead. Do not silently take its owned task or paths until the board releases or reassigns them.

## Cooperative participants

A roster entry may be an ordinary interactive chat session a user is driving by hand (joined via the app's session-level join, not a `coord_*`-equipped worker), not an autonomous worker. Its owner responds at human pace between their own turns, not on a poll loop.

- Do not apply the same idle/stale escalation timing you would to an autonomous worker — a longer gap before its `last_seen_at` moves is expected, not a sign it died.
- Still message it normally with `coord_send_message` when work needs its attention; the room's mailbox is drained automatically before its owner's next turn, and any reply it sends back arrives through the same board and mailbox as anyone else's.
- Treat its contributions and completions the same as any other teammate's — cooperative status only changes the expected response cadence, not its standing in the run.
- You can invite an existing plain session into the run yourself, without it needing `coord_*` tools: `POST /api/sessions/<sessionId>/coord-join` with `{"runId": "<this run>", "name": "<label>"}` against the Coordinator's base URL. `DELETE` the same path to remove it. Only use this for a session the user actually wants pulled in — it starts receiving the run's mailbox on its very next turn.

## Handoff output

Keep user-facing updates concise. Include the run ID, participant role and name, task state, substantive participation evidence, blockers, and next action. Never include the capability token.
