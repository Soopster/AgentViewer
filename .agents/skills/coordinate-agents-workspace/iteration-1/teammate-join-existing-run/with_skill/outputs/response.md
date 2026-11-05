Sure — since you gave me a run ID, this is a join, not a create. Here's exactly what I'd do, in order:

1. **`coord_join_run`** with `run_id: "run_8f2a1c"`, `name: "codex-lane-2"`, my actual provider, and my current checkout path. I will not call `coord_create_run` or `coord_list_runs` — a run ID was supplied, so this is a straight join. I'll leave `respond_to_mode` unset (default `anyone`) unless you've told me otherwise. This call returns my capability token, which I persist locally and never print, message, or commit.

2. **`coord_status`** — read the run snapshot immediately after joining: current tasks, who owns what, the `actionable` digest (claimable tasks, urgent/status counts, unresolved reply-required requests, plan-review queue if I'm a lead — I'm not here).

3. **`coord_read_inbox`** — drain my mailbox before doing anything else. If anything in there is flagged `replyRequired`, I answer it with `coord_send_message` (using `response` + `in_reply_to`) before touching the board further — the skill is explicit that silence on reply-required mail reads as dropped, not busy.

4. From the `actionable` digest / `coord_status` output, pick one unblocked, independently claimable task that isn't already owned. **`coord_claim_task`** on that specific task — atomic claim, one task at a time.

5. Read the claimed task's outcome, dependencies, expected write paths, and any run guardrails from the task detail before touching files.

6. If the run has plan approval enabled, call **`coord_submit_plan`** and wait for approval before editing anything.

7. If the task needs write access outside its declared paths, call **`coord_request_locks`** first and stay inside whatever's granted.

8. Call **`coord_progress(status="working")`** to mark the task in-flight, then actually start the work. For anything that runs longer than ~2 minutes, I keep sending `coord_progress(status="heartbeat")` roughly every 2 minutes with a one-line summary so the lead doesn't read board silence as a stall.

Throughout, I narrate every mailbox exchange to my own terminal (`← sender: ...` / `→ recipient: ...`), and if any `coord_*` call throws (not an empty/timeout result — an actual error), I wait ~2s and retry the same call with the same identity rather than re-joining or asking whether to retry.

That's the sequence through "claim + start first task" — completion (`coord_complete_task`), findings, and leaving the run come later, after the task is actually done and verified.
