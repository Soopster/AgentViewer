# Plan: joining run_8f2a1c as teammate "codex-lane-2"

This is the exact sequence of `coord_*` calls I'd make, in order, from the moment I join through claiming and starting my first task.

1. **`coord_join_run`** — `run_id: "run_8f2a1c"`, `name: "codex-lane-2"`, `provider: <my actual provider>`, `cwd: <my current checkout path>`. A run ID was supplied, so this is a join, not a create. I would not pass `respond_to_mode`/`respond_to_allowlist` unless there's a specific reason to ignore chatter from anyone but the lead — leave the default (`anyone`).

2. **`coord_status`** — read immediately after joining to see the current board: task list, phases, agent roster, liveness of other participants, and the `actionable` digest.

3. **`coord_read_inbox`** — drain the mailbox before doing anything else. If any message has `replyRequired: true`, I owe a `coord_send_message` reply (with `in_reply_to`) before claiming new work — the sender treats silence as dropped, not deferred.

4. Narrate each inbox message to my own terminal as `← <sender>: <message>` (and later `→ <recipient>: <message>` for anything I send) — my user is watching the terminal, not the board.

5. **`coord_claim_task`** — atomically claim one unblocked, claimable task from the board (using the `task_id` surfaced in `coord_status`'s `actionable` digest, or picked from the task list matching my `teammate`/`any` role). If nothing is currently claimable, I'd call `coord_wait` with the previous cursor instead of polling, then re-check `actionable` when it returns.

6. Read the claimed task's outcome, dependencies, expected write paths, and any run guardrails (isolated vs. shared checkout mode) before touching any files.

7. **`coord_submit_plan`** — only if the run has plan approval enabled (visible in `coord_status`'s run controls). If so, wait for lead approval before editing.

8. **`coord_request_locks`** — request the specific write paths I need before editing, and stay inside whatever is granted.

9. **`coord_progress`** with `status: "working"` — mark the task in-flight, which is also my cue to start the actual work. From there I'd run proportionate verification, send a `coord_progress(status="heartbeat")` roughly every ~2 minutes on anything long-running, and only call `coord_complete_task` once verification actually passes.

That's the join → claim → start sequence. Everything after step 9 (heartbeats, `coord_publish_finding`, `coord_complete_task`, `coord_leave_run`) is the ongoing work loop, not part of "starting my first task."
