## "judgment review pending"

That's not an error in the ordinary sense — it's one of the Coordinator's completion gates firing as designed. The current run contract supports a set of gates including "post-mechanical judgment review before synthesis" (alongside plan approval, phase approve/reject, completion gates, and open-decision resolution). This run has that judgment-review gate enabled, and your `coord_complete_task` call hit it: the mechanical checks (verification commands, changed-files, receipt shape) passed, but the task needs an explicit human/lead judgment pass before it's allowed to close.

What to do next:

1. **Don't bypass it and don't claim the work is done anyway.** The gate exists specifically to keep a human or lead judgment call in the loop for this task — there's no legitimate way around it, only through it.
2. **Read the rejection message itself first**, not just the category — every Coordinator rejection is a specific, actionable string (this applies regardless of provider), so it may already tell you who needs to review or what's outstanding.
3. **Check `coord_status`** — board state is authoritative, not the prose inside a rejection. Look for whether there's a pending review request/decision tied to this task, and who owns resolving it (typically the lead, via `coord_review_run` or `coord_review_phase`, or `coord_resolve_decision` if it's a task-level open decision).
4. **If you're a teammate**, this usually isn't something you resolve yourself — ping the lead with `coord_send_message` (mark `reply_required` if you need it acted on to unblock) so they know the task is sitting at the judgment gate, then keep the same `request_id` and retry `coord_complete_task` once it clears. Rejections are never replayed from cache, so re-submitting the same completion after the review lands is the correct move, not creating a new completion call or a new task.
5. **If you're the lead**, this is your cue to actually perform that judgment review (via `coord_review_run`/`coord_review_phase` or by resolving the relevant open decision) rather than treat the rejection as a transient failure to retry blindly.

In short: it's a real, intentional gate on this run (judgment review is enabled), it's blocking synthesis until someone with review authority signs off, and the fix is to get that review done (or ask the lead to do it) and then resubmit completion — not to work around it.

## Copilot never getting a task handle from `coord_wait`

Not a bug, and not something you need to work around. The MCP Tasks extension (which is what makes `coord_wait` return a durable task handle instead of blocking) only activates when the calling MCP client explicitly declares the `io.modelcontextprotocol/tasks` capability on its requests. Clients that don't declare it simply get the ordinary blocking result back instead of a handle — this is a capability check on the *client*, not a provider allowlist on the Coordinator side. So the fact that you (presumably Claude, whose client declares Tasks support) get a handle and your Copilot teammate doesn't is expected: it just means the Copilot CLI's MCP client hasn't declared that capability, so the Coordinator falls back to blocking behavior for it.

Nothing to fix functionally — the Copilot teammate should just keep using `coord_wait`/`coord_status` in blocking mode as normal; they aren't missing functionality, only the optional non-blocking task-handle convenience. If it's worth flagging, the right move is `coord_publish_finding` noting that Copilot's MCP client doesn't advertise `io.modelcontextprotocol/tasks`, so the lead and other lanes know rather than anyone silently trying to route around it — but there's no code change needed on the Coordinator side.

---

*Files consulted: `.agents/skills/coordinate-agents/SKILL.md` (teammate workflow, gate/completion rules), and `.agents/skills/coordinate-agents/references/protocol-and-hosts.md` (current Coordinator capability surface — gates list including "post-mechanical judgment review before synthesis"; MCP Tasks extension / `io.modelcontextprotocol/tasks` capability-gating explanation for why `coord_wait` handles are client-dependent, not provider-dependent).*
