# Protocol, hosts, and capability surface

Background reference for how the Coordinator's tools are exposed and what the current contract supports. Read this when something surprising happens — a tool call rejected for a reason you don't recognize, a client not offering `structuredContent`, a dashboard resource, or a question about A2A — not as a prerequisite for entering or running a normal session. The hot-path workflow lives in the main `SKILL.md`.

## MCP discovery and host features

The bridge exposes this workflow through ordinary MCP primitives as well as `coord_*` tools. Use the richest representation the host supports, but keep the same Coordinator semantics everywhere.

- On a modern MCP client, the bridge negotiates protocol revision `2026-07-28` through `server/discover`. Legacy initialize-based clients remain supported, so never treat modern negotiation as a prerequisite for joining or operating a run.
- If this skill was not installed locally, discover it through `skill://index.json` and read `skill://coordinate-agents/SKILL.md`. The `io.modelcontextprotocol/skills` capability and resource frontmatter identify the canonical `coordinate-agents` skill; do not maintain or follow a second copied workflow.
- Hosts with MCP Prompts can invoke `coordinate_agents` with an objective and optional `lead` or `teammate` role. The prompt is a bootstrap: read this skill resource before acting, then use the normal entry, task, mailbox, lock, progress, and completion rules in `SKILL.md`.
- Tool calls return `structuredContent` plus a JSON text fallback. Prefer `structuredContent` when the client exposes it; parse the text content only when structured data is unavailable. They represent the same result and must not be treated as two events or two mutations.
- `coord_status` links to the `ui://agent-viewer/coordinator-dashboard.html` MCP App. Apps-capable hosts can inspect and refresh run, task, inbox, lock, and agent state there. The dashboard is a view over `coord_status`, not a substitute for claiming tasks, answering mail, requesting locks, reporting progress, or finalizing through tools.
- The preferred MCP 2026 idle path is push-based. Bind results expose `pushResource: coord://agent-viewer/current-run`; a capable host subscribes once through `subscriptions/listen`, receives `notifications/resources/updated` after another participant changes the AHP run, and re-reads that private zero-TTL resource for the authoritative board and `actionable` digest. Resource notifications are invalidations, not state patches. Bursts are coalesced and liveness-clock-only refreshes are suppressed. A managed `coord worker` model turn must return to its supervisor rather than calling `coord_wait`; the supervisor owns the idle wait and re-dispatch. Use `coord_wait` only for an interactive host that cannot keep a resource subscription open.
- The experimental MCP Tasks extension is available to clients that declare `io.modelcontextprotocol/tasks` on each request. A non-zero `coord_wait` may return a durable task handle; persist its `taskId`, honor `pollIntervalMs`, and call `tasks/get` until it is terminal. The completed task's `result` is the same tool result a blocking client would have received. When a task enters `input_required`, present each `inputRequest` under the host's normal trust rules and return the keyed response through `tasks/update`; never invent responses for the user.
- A non-Tasks client may attach a unique `progressToken` to a blocking `coord_wait`. The bridge then emits monotonic `notifications/progress` only while that request remains active. Do not expect progress notifications for a task-augmented wait; observe its durable state through `tasks/get` instead.
- `coord_await_run` creates a whole-run monitor for work that an unattended worker or external supervisor is already driving. It can surface pending lead plan reviews as `input_required` elicitations and apply the user's approve/reject response. Do not call it as an interactive lead's next action — the monitor does not claim tasks, answer mail, perform implementation, or synthesize. `tasks/cancel` cancels only the wait/monitor and never stops the Coordinator run or changes board-task state.
- MCP task handles wrap protocol operations; Coordinator board tasks remain the source of truth for ownership, dependencies, locks, progress, completion, and synthesis. Never create a one-to-one shadow MCP task for every Coordinator task.

## Provider compatibility

The standalone MCP bridge exposes the same tool schemas to every provider. In-process Claude, Codex, Copilot, Pi, and OpenCode sessions use the shared `lib/coordinatorToolContract.mjs` contract and provider-native schema adapters; these sessions are already bound, so run creation/join and MCP host extensions are supplied by their host rather than their tool set. The provider label does not waive ownership, role, or completion gates. If a tool is missing, inspect the actual transport and registered schema before diagnosing a provider limitation.

- If a tool call is rejected, trust the error message over any assumption about your provider — every rejection (invalid enum, ownership check, gate failure, capability mismatch) is a specific, actionable string, not a generic failure, and holds regardless of which CLI you are.
- The MCP Tasks extension (`coord_wait`/`coord_await_run` durable handles) only activates when your MCP client declares `io.modelcontextprotocol/tasks`; clients that don't simply get the blocking result instead — this is a capability check, not a provider allowlist, so don't infer anything about provider support from whether you receive a task handle.
- If your provider's MCP client behaves unexpectedly on a specific tool (schema rejected, structured content ignored, elicitation not surfaced) where another provider handles the same call fine, inspect both the client and its Coordinator adapter; a matching provider name does not prove matching tool exposure — report it via `coord_publish_finding` so the lead and other lanes know, rather than silently avoiding the tool.

## Current Coordinator capability surface

Treat `lib/agentProtocol.ts` and the registered MCP schemas as authoritative. The current run contract supports:

- **Run controls:** `autonomy` (`low|medium|high`), `requirePlanApproval`, `requireReview`, `acceptanceContract` (goal, non-goals, user-visible acceptance, verification commands, manual QA, escalation triggers), and `budget` (`maxTokens`, `maxDurationMinutes`).
- **Routing:** task `seat` (`director|executor|validator|watcher`), target role, requested provider/model/effort, verification commands, explicit dependencies, and phase barriers. A requested provider/model is routing intent, not proof of what ran.
- **Evidence:** task completion requires a structured receipt with requested/actual provider and model, provenance (`ok|drift|unknown`), stop reason, usage, changed files, verification results, summary/detail, and open decisions. Model drift or unverifiable provenance remains attention-blocking.
- **Gates:** teammate plan approval, phase reports with approve/reject, completion gates, open decision resolution, and post-mechanical judgment review before synthesis. Board state — not approval prose inside a rejection — is authoritative.
- **Recovery and learning:** turn cancellation, provider handoff with failure classification, resume capsules/checkpoints, durable progress evidence, recurring learning candidates, and explicit promotion to playbook, role, or project memory. Promotion is a reviewable decision, not an implicit write.

The unbound MCP bridge currently registers these run/playbook tools: `coord_list_runs`, `coord_create_run`, `coord_preview_playbook`, `coord_list_playbooks`, `coord_save_playbook`, `coord_join_run`, `coord_resume`, `coord_status`, `coord_wait`, and `coord_await_run`. Board and evidence tools are `coord_create_task`, `coord_claim_task`, `coord_release_task`, `coord_leave_run`, `coord_read_inbox`, `coord_send_message`, `coord_handoff_task`, `coord_request_locks`, `coord_progress`, `coord_publish_finding`, `coord_query_context`, `coord_remember`, `coord_save_role`, `coord_list_roles`, `coord_submit_plan`, `coord_review_plan`, `coord_review_phase`, `coord_review_run`, `coord_resolve_decision`, `coord_promote_learning`, `coord_cancel_turn`, `coord_spawn_teammate`, `coord_complete_task`, `coord_fail_task`, and `coord_finalize_run`.

Use `coord_preview_playbook` before launching a saved or inline playbook when interpolation, phase barriers, or requested routing needs checking. Use `coord_review_phase` and `coord_review_run` for explicit operator gates; use `coord_resolve_decision` for task-level open decisions; use `coord_promote_learning` only after inspecting the candidate and intended target.

## Surface parity

The same controls are exposed through:

- `POST /api/agent-protocol/runs` for creation and `PATCH /api/agent-protocol/runs/:runId` for plan, phase, judgment, decision, learning, and run-control mutations.
- The OpenTUI **New Workflow** launcher: outcome brief, acceptance checks, non-goals, manual QA, escalation triggers, playbook/args, provider pool, agent limit, checkout isolation, completion gate, autonomy, plan approval, judgment review, token budget, and duration budget. Tab/Shift+Tab traverses these controls; the launch summary mirrors the submitted contract.
- Web Agent Operations and Playbook Manager with the same acceptance, review, routing, verification, and budget fields.
- `agent-viewer coord worker` and the CLI coordinator tools, which preserve the same protocol fields when starting or joining unattended workers.

When changing one surface, update the protocol type/schema, external/MCP adapter, web launcher, OpenTUI launcher, worker CLI, and the relevant smoke assertion together. Verify that a saved playbook round-trips requested provider/model/effort/seat and verification commands; do not validate only the visual roster or an idle board.

## A2A and MCP boundary

Use the two protocols as complementary layers, not interchangeable transports:

- `coord_*` MCP calls are this CLI agent's structured tools for operating the Coordinator core: board reads and mutations, mailbox delivery, locks, findings, progress, and completion. Keep these operations on MCP over the default persistent AHP connection.
- The gated A2A 1.0 facade is for a separate autonomous peer or client agent to submit and monitor a higher-level, stateful task. An A2A-created task lands on the same durable Coordinator board and is then claimed and completed through the normal `coord_*` MCP workflow; do not create a shadow MCP task for it.
- MCP Resources expose `a2a://agent-viewer/coordinator/agent-card.json`, a live projection of the daemon's public Agent Card. Read it when an MCP host needs to discover the Coordinator's A2A skills or preferred interface. If the facade is disabled, the resource read fails closed; do not infer that A2A is available merely because the resource URI is listed.
- Do not wrap `SendMessage` or other conversational A2A operations as ordinary MCP tools. A2A retains task identity, context, streaming, and push semantics across peer-agent turns; reducing it to a stateless tool call loses the distinction the protocols are designed to preserve.

## Cooperative participants

A roster entry may be an ordinary interactive chat session a user is driving by hand (joined via the app's session-level join, not a `coord_*`-equipped worker), not an autonomous worker. Its owner responds at human pace between their own turns, not on a poll loop.

- Do not apply the same idle/stale escalation timing you would to an autonomous worker — a longer gap before its `last_seen_at` moves is expected, not a sign it died.
- Still message it normally with `coord_send_message` when work needs its attention; the room's mailbox is drained automatically before its owner's next turn, and any reply it sends back arrives through the same board and mailbox as anyone else's.
- Treat its contributions and completions the same as any other teammate's — cooperative status only changes the expected response cadence, not its standing in the run.
- You can invite an existing plain session into the run yourself, without it needing `coord_*` tools: `POST /api/sessions/<sessionId>/coord-join` with `{"runId": "<this run>", "name": "<label>"}` against the Coordinator's base URL. `DELETE` the same path to remove it. Only use this for a session the user actually wants pulled in — it starts receiving the run's mailbox on its very next turn.


## Mailbox filters and checkout diagnostics

`respond_to_mode` on create/join defaults to `anyone`. Use `owner-only`, `allowlist` with `respond_to_allowlist`, or `nobody` only when the participant needs a restricted mailbox. The lead is implicitly allowed for owner-only/allowlist. These filters affect participant sends, not coordinator-authored notices or turn cancellation.

Completion compares checkout changes against the claim baseline. Existing dirty files are ignored unless changed after claiming. Shared-checkout attribution is skipped when participants share a directory; otherwise another participant's active locks exclude its paths from your attribution. Keep locks disjoint regardless.

If a gate names only another lane's files, inspect ownership and baseline evidence with the lead. Releasing and reclaiming a task captures a new baseline, but releases its locks and may let another participant claim it; it is not atomic recovery and must never hide changes you made outside your scope. Preserve all files while diagnosing.

The OpenTUI launcher is available at `Ctrl+Shift+N`, or Agent Operations (`Ctrl+Shift+A`) then `n`. Keep isolation enabled for parallel checkout work; disable it only for a shared workflow.

## Uncertain operation outcomes

Keyed mutations reserve execution in SQLite before performing effects. A second process cannot run the same key concurrently. Completed results are cached for a bounded window; compact operation records survive for the run's lifetime, so an expired result cannot silently execute again.

`COORDINATOR_OPERATION_UNCERTAIN` means the operation is still running, was interrupted, failed with possible partial effects, or completed but its detailed result expired. Read the board/inbox/context to find the effect before changing anything. The same key may retrieve a result if the original dispatcher subsequently finishes. Do not change keys merely to bypass uncertainty. If the effect is already present, continue from that state; start a new operation only after establishing what remains to be done. Explicit completion-gate results with `accepted:false` remain correctable with the same key. A thrown exception does not prove that no effect occurred.
