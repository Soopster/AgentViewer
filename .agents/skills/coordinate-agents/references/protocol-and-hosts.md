# Protocol, hosts, and capability surface

Background reference for how the Coordinator's tools are exposed and what the current contract supports. Read this when something surprising happens — a tool call rejected for a reason you don't recognize, a client not offering `structuredContent`, a dashboard resource, or a question about A2A — not as a prerequisite for entering or running a normal session. The hot-path workflow lives in the main `SKILL.md`.

## Rejections and what to do

Every rejection is a specific message. Match it here before retrying; a retry with the same arguments gets the same answer.

| Message starts with | Meaning | Do this |
|---|---|---|
| `This CLI is not bound to a Coordinator run` | No identity on this connection | Were you in this run before a restart? `coord_resume` with your run and agent ids. Otherwise `coord_join_run` or `coord_create_run` once; with a host-supplied client command, use that instead |
| `No saved credential for <agent> in run <run>` | `coord_resume` found no identity file for those ids | Check the ids against your join result, or pass its `identityFile` as `identity_file` |
| `This bridge is already bound to run …` | You called create/join while bound | Continue with `coord_status`; never join a second time |
| `Only the Coordinator lead can …` | Lead-only tool called by a teammate | Ask the lead by mail; do not retry |
| `No claimable task: … already owns <task>` | One task at a time | Finish, release, or hand off the task you hold |
| `No claimable task: … blocked by incomplete dependencies` | Nothing is ready for you | Managed turn: return. Interactive: wait |
| `No claimable task: … targets the lead role` | Role affinity | Leave it for that role, or ask the lead to retarget it |
| `No claimable task: … requires a path locked by` | Another task holds the path | Wait for it or tell the lead the lanes overlap |
| `Cannot report working` / `blocked without owning a Coordinator task` | Progress before a claim | `coord_claim_task` first; use `heartbeat` or `ready` when you own nothing |
| `Cannot request locks without owning a Coordinator task` | Locks belong to a task | Claim, then request |
| `Unanswered reply-required messages: <ids>` | Completion or leave blocked by mail you owe | `coord_read_inbox(unresolved=true)`, answer each with `in_reply_to`, then call again |
| `Stale completion rejected` | Your claim was released or reassigned while you worked | `coord_read_task` with its task ID; do not resend the completion |
| `Reply target not found or not addressed to this participant` | `in_reply_to` is not a message sent to you | Use the id from your own inbox |
| `A correlated reply must address exactly one participant` | `in_reply_to` with `to:"all"` | Reply to the original sender |
| `… is not accepting messages from you right now` | Recipient's respond-to filter | Route through the lead |
| `Cannot leave while owning <task>` | Leaving would orphan work | Release or hand off first |
| `Coordinator run still has N unfinished task(s)` | Finalize too early | Finish, fail, or cancel them; then finalize |
| `Coordinator run requires an approved judgment review` | `requireReview` run | `coord_review_run` first — if that review is the human's, surface it instead |
| `Completed tasks lack valid receipts` | A completion had no usable receipt | Have its owner complete again with files, commands, and model |
| `Model … is not advertised by` / `Effort … is not advertised for` | Routing ID the provider does not offer | `coord_capabilities`, then use a listed `value` or omit the field |
| `… is a <provider> teammate; a provider choice only applies to a new teammate` | `requested_provider` on an existing teammate | Drop it, or delegate under a new `name` |
| `All teammate slots are busy` / `Teammate is busy or unavailable` | No free teammate; no task was created | Steer by mail or wait for a result, then delegate again |
| `No idle teammate is available. Start or join a teammate` | Externally managed run cannot create teammates | Start another CLI or `coord worker --join` |
| `Inspect and reconcile the previous teammate execution` | Its last dispatch is unconfirmed | Check its transcript and task before assigning more |
| `This run already has N open tasks` | Open-task cap | Let work finish or cancel stale tasks |
| `Cannot delegate more work:` / `Cannot claim more work:` | Run budget exhausted | Report to the lead or human; do not work around it |
| `Coordinator participant name already exists` | Name taken on join | Join under a different name |
| `Coordinator run has reached its participant limit` | Roster full | Ask the lead; do not create another run |
| `Context handoff not found in this run` | Wrong id, or a checkpoint from another run | Use the task's `contextHandoff.id` from `coord_status` |
| `Task claim changed while preparing the handoff` | The task was released or reassigned mid-handoff | Read the task; do not resend |
| `COORDINATOR_OPERATION_UNCERTAIN` | Outcome of a keyed call is unknown | See *Uncertain operation outcomes* below |
| `accepted: false` (a result, not an error) | Completion gate refused | Fix the named cause; call again with the same `request_id` |

A schema error from the MCP client itself (wrong type, value outside an enum, text over a length limit) never reached the Coordinator: correct the argument. An argument the tool does not declare is dropped silently, so check the tool's schema when a call behaves as if an option was not passed.

## What a result contains, and what it leaves out

Results are sized for a model's context, so some text is an excerpt by design:

- `coord_status` lists recent events and up to 100 findings, each with at most 600 characters of `detail`. A cut entry ends with a note saying how much was left out.
- `coord_wait` returns the events since your cursor with up to 2,000 characters of detail each, plus the `actionable` digest. It does not repeat the board.
- `coord_query_context` returns the best match whole and further matches in full until about 40,000 characters are spent; later ones are cut to an excerpt. To read one entry completely, query for its distinctive words or pass `limit: 1`.
- Old finished tasks appear as an id, title and one-line outcome; mail is read through `coord_read_inbox`, never repeated in status.

Write findings accordingly: put the conclusion in `summary` and the first lines of `detail`, since that is what every other participant sees without asking.

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

### Session-bound client fallback

If native `coord_*` tools report an unbound identity despite the host supplying a session-bound command, invoke that exact command with the tool name and JSON arguments appended. The generated `client.mjs` reads the private binding itself; do not read or copy its credentials into commands, mail, or output. Start with `coord_status '{}'`, then `coord_read_inbox '{"request_id":"<unique-inbox-operation>"}'`, and confirm the expected run and participant before mutations. Keep using the same identity and stable mutation keys across transport changes. Do not create or join another run to repair an unbound native connection.

This fallback requires an actual host-supplied command, not a guessed binding path. If it is unavailable, report the missing binding to the host/operator. If the client cannot reach the existing bridge, check whether the app is running and the shell has local-network access; use the host's normal approval path if access is restricted. A connection error is not proof the URL is wrong or a mutation did not apply. Reconcile the board and inbox before retrying a mutation with the same arguments and key.

- If a tool call is rejected, trust the error message over any assumption about your provider — every rejection (invalid enum, ownership check, gate failure, capability mismatch) is a specific, actionable string, not a generic failure, and holds regardless of which CLI you are.
- The MCP Tasks extension (`coord_wait`/`coord_await_run` durable handles) only activates when your MCP client declares `io.modelcontextprotocol/tasks`; clients that don't simply get the blocking result instead — this is a capability check, not a provider allowlist, so don't infer anything about provider support from whether you receive a task handle.
- If your provider's MCP client behaves unexpectedly on a specific tool (schema rejected, structured content ignored, elicitation not surfaced) where another provider handles the same call fine, inspect both the client and its Coordinator adapter; a matching provider name does not prove matching tool exposure — report it via `coord_publish_finding` so the lead and other lanes know, rather than silently avoiding the tool.

## Current Coordinator capability surface

Treat `lib/agentProtocol.ts` and the registered MCP schemas as authoritative. The current run contract supports:

- **Run controls:** `autonomy` (`low|medium|high`), `requirePlanApproval`, `requireReview`, `acceptanceContract` (goal, non-goals, user-visible acceptance, verification commands, manual QA, escalation triggers), and `budget` (`maxTokens`, `maxDurationMinutes`).
- **Discovery:** `coord_capabilities` returns a provider's advertised models and effort levels with `status` `available`, `unavailable` (call again to refresh) or `unsupported` (no read-only catalog; the provider's own dispatcher decides). It never opens a session.
- **Routing:** task `seat` (`director|executor|validator|watcher`), target role, requested provider/model/effort, verification commands, explicit dependencies, and phase barriers. A requested provider/model is routing intent, not proof of what ran.
- **Evidence:** task completion requires a structured receipt with requested/actual provider and model, provenance (`ok|drift|unknown`), stop reason, usage, changed files, verification results, summary/detail, and open decisions. Model drift or unverifiable provenance remains attention-blocking.
- **Gates:** teammate plan approval, phase reports with approve/reject, completion gates, open decision resolution, and post-mechanical judgment review before synthesis. Board state — not approval prose inside a rejection — is authoritative.
- **Portable checkpoints:** `coord_handoff_task` pins an immutable `contextHandoff` to the task: the previous owner's summary and detail, its provider, session and claim, the task text and paths, a checkout fingerprint, and a digest. The next claimer's prompt includes it, and `coord_read_handoff(handoff_id)` returns it at any time, including after the event window has moved on. It is the previous owner's account, not a transcript replay: compare the fingerprint with the current checkout and verify its claims before building on them.
- **Recovery and learning:** turn cancellation, provider handoff with failure classification, resume capsules/checkpoints, durable progress evidence, recurring learning candidates, and explicit promotion to playbook, role, or project memory. Promotion is a reviewable decision, not an implicit write.

The unbound MCP bridge currently registers these run/playbook tools: `coord_list_runs`, `coord_create_run`, `coord_preview_playbook`, `coord_list_playbooks`, `coord_save_playbook`, `coord_join_run`, `coord_resume`, `coord_capabilities`, `coord_status`, `coord_wait`, and `coord_await_run`. Board and evidence tools are `coord_create_task`, `coord_delegate`, `coord_claim_task`, `coord_release_task`, `coord_leave_run`, `coord_read_inbox`, `coord_send_message`, `coord_handoff_task`, `coord_read_handoff`, `coord_request_locks`, `coord_progress`, `coord_publish_finding`, `coord_query_context`, `coord_remember`, `coord_save_role`, `coord_list_roles`, `coord_submit_plan`, `coord_review_plan`, `coord_review_phase`, `coord_review_run`, `coord_resolve_decision`, `coord_promote_learning`, `coord_cancel_turn`, `coord_spawn_teammate`, `coord_complete_task`, `coord_fail_task`, and `coord_finalize_run`.

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

`COORDINATOR_OPERATION_UNCERTAIN` means the operation is still running, was interrupted, failed with possible partial effects, or completed but its detailed result expired. Use `coord_inspect_operation` with the original tool name and key, then read the referenced task/board/inbox/context to reconcile the effect before changing anything. The same key may retrieve a result if the original dispatcher subsequently finishes. Do not change keys merely to bypass uncertainty. If the effect is already present, continue from that state; start a new operation only after establishing what remains to be done. Explicit completion-gate results with `accepted:false` remain correctable with the same key. A thrown exception does not prove that no effect occurred.


## Waiting ownership in the actionable digest

`coord_status`, `coord_wait` and mutation receipts carry
`actionable.waitingPolicy` for the caller. It describes model-turn waiting,
not proof of a live supervisor process or permission to start a native turn.

| Mode | Evidence | Idle action |
| --- | --- | --- |
| `managed` | Negotiated `unattended:true`, or a verified managed binding | Return to the supervisor; no model-turn `coord_wait` |
| `interactive` | External client with no negotiated supervisor | Subscribe if the MCP host supports it; otherwise `coord_wait` |
| `cooperative` | Existing cooperative session | Return to the human; messages arrive at its next normal send |
| `unknown` | Native identity without a verified managed binding | Check the host's turn prompt; do not infer supervision from session ID |

`source` reports the evidence and `idleAction` names the action. A false
`coordWaitAllowed` describes the model turn. A supervisor may still call the
same wait API for its worker; the participant identity alone cannot distinguish
supervisor polling from a model tool call. Interactive subscription support
comes from MCP host discovery, not from provider name or agent status. Older
hosts may omit waitingPolicy; follow the supplied turn prompt and supervisor
contract rather than treating a missing field as interactive permission.

## Unattended worker startup

A lead starts with a playbook containing independent teammate tasks and a
lead integration lane:

```bash
agent-viewer coord worker --start "<full objective>" --playbook <name> --name <name> --provider <provider> --max-agents <n> --attach <url>
agent-viewer coord worker --join <run-id|latest> --name <name> --provider <provider> --attach <url>
```

Joined workers get isolated checkouts unless `--shared`. The supervisor persists
identity, heartbeats and waits outside model turns. Resume the existing worker
rather than creating a replacement participant after a disconnect.

## Execution reservation recovery through MCP

`coord_inspect_recovery` is a lead-only read that checks native conversation and
checkout availability and reports host ownership and retained execution
reservations. It never claims a host or submits work. Filter by participant name
or ID with `agent`; managed leads are inspectable too.

`attempts` lists the last ten native dispatch records, newest first. Each has
its own ID and the original task, claim generation, conversation, provider and
provider instance. `submitted` without later settlement means observation is
unresolved; it does not prove a live process or permit replay. `rejected` means
the send returned a non-success HTTP response; `settled` records an observed
stream ending, not task completion. `uncertain` retains stream/transport failure
evidence. `reconciled` records explicit acknowledgement/recovery, without
claiming the old attempt completed. Attempts remain distinct from the current claim.

For rate limits, `cooldown` reports explicit provider Retry-After evidence.
`resetKnown=false` means no reset time was supplied; never guess one from prose.
An active cooldown prevents resume and new native sends in that provider
instance. Native dispatches deferred before submission are retained with their
session, task, claim generation and authored message, then the local mailbox
sweep releases them after `retryAt`. The sweep rechecks current ownership,
claim, session activity and cooldown before sending. This host-local queue does
not cover remote worker hosts or reset signals providers have not exposed as
HTTP `Retry-After`. Elapsed cooldown alone does not approve replay of an
uncertain execution, clear a human gate, or prove an earlier execution did not
run.

Inspect the saved transcript. When `canAcknowledge` is true, use
`coord_acknowledge_execution` with the exact agent ID, reservation `taskId` as
`expected_task_id`, and reservation `createdAt` as `expected_created_at`.
Use a stable `request_id`. The server rechecks the reservation, host ownership,
and execution state. A stale reservation, live turn, or owned unfinished work
is rejected. Acknowledgement keeps any newer claim and locks and does not
itself submit a turn; maintenance can subsequently dispatch queued work.

`executionElsewhere` requires the owning host. For unfinished work with
`needsRecovery`, inspect the saved transcript and call `coord_resume_agent`
with the exact `recoveryClaim` taskId, sessionId and claimGeneration returned
by inspection. For a managed lead without a claimed task, pass its
`recoveryClaim.attemptId` as `expected_attempt_id` and its sessionId; omit task
and claim-generation pins. Changed attempts are rejected. This starts a new
turn in the saved session and checkout. Accepted-stream failures never
automatically retry or fail over to a new conversation. Automatic recovery
cannot retire unresolved attempts; explicitly inspect and reconcile first. It
rejects changed claims, native human questions/permissions, task approval/open
decision gates, unavailable conversations/directories, host conflicts and
budget gates. Provider failures may recur; inspect their cause first. Supply
a stable `request_id` and reuse it to retrieve the receipt after a disconnect.
Do not create a replacement conversation. Do not repeatedly
release and reclaim tasks to force dispatch, and do not use recovery to answer
human approvals or provider permission requests.


## External worker attempt recovery

`coord_inspect_recovery.externalWorkers` reports this daemon host's worker
process observations and the newest ten public provider attempts for each
matching run/agent. Attempts retain their ID, task, native conversation,
provider, transport, PID and process outcome. A missing provider instance stays
null: it was not observed. Identity/configuration contents are excluded.
`externalWorkerObservationScope="this-host-only"` means an empty list does not
prove a remote worker stopped. Inspect/recover it on its existing host.

A crashed supervisor can leave a detached provider running. Neither changing
provider nor an ordinary restart permits replay of a retained unresolved
attempt. Inspect its transcript and `coord workers --run <run-id> --json`.
After confirming the old provider stopped, use `coord restart <exact-worker>`
with `--reconcile-attempt <attempt-id>` (or that flag on `coord worker --identity`).
A live recorded PID or changed attempt is rejected; no process is signalled by
reconciliation. Existing task ownership and native conversation are retained.
Do not inspect the private identity file to get the pin; use public attempts.
`closed` reports observed subprocess closure, not task completion or absence of
provider-owned/background work. Check those independently before recovery.

## Role-aware discovery

Known teammates receive execution, mailbox, task/context inspection and
completion tools, including `coord_create_task` for discovered work. Lead-only
planning, recovery, cancellation and integration tools are hidden; ask the lead
when you need them. Leads keep their own task execution tools. Unknown or older
bindings retain the complete catalog until a role is verified.

Native Claude/Pi/Copilot/Codex/ACP definitions use the bound role. Standalone MCP
updates discovery after authenticated join/resume/status, sending one catalog
invalidation per role change; hosts should refresh tools on that notification.
Roles in local identity metadata are discovery hints, never authorization.
Backend role/capability checks still apply even to directly invoked hidden tools.
OpenCode's plugin catalog is server-wide, so ordinary and steering prompts use
an account/session-scoped mask. Its native command API has no tools-mask field;
that path retains provider discovery and backend authorization.

## Keeping MCP context small

Read full `coord_status` on first join/recovery or when you need the board/roster/locks.
For routine next-action checks, use `coord_status(view="actionable")`. It keeps
the caller identity, run status, cursor, phases and the complete actionable
digest, including waiting ownership and reply obligations, while omitting the
snapshot. Mutation and wait receipts already contain next actions: act on them
without another status read. Use `coord_read_task` for a specific full receipt
and a focused `coord_query_context` (limit 1 when sufficient) for full findings.

Create/delegate receipts omit the prompt you just supplied and private dispatch
policy. They still report task identity/status, paths, dependencies, delegation
and next actions; `taskDetailTool` points to `coord_read_task` if context was lost.
Claim receipts keep the full task. Supervisor/ledger records remain unchanged.
The session shell fallback recognizes read-only tools from the shared contract;
those reads do not require a mutation key. Acknowledging inbox reads still do.

## Exact task and keyed operation inspection

Ordinary `coord_status` is deliberately bounded. `coord_list_tasks` returns
compact summaries in insertion order, with a status filter and `nextCursor`.
Keep the filter unchanged while paging; concurrent status changes mean this is
not a frozen snapshot. `coord_read_task` retrieves one full durable prompt,
receipt, verification, decisions, handoff and result even after terminal detail
ages out of ordinary status. Reads stay in the authenticated participant's run.

After a lost keyed mutation response, use `coord_inspect_operation` with the
original `tool_name` and `operation_request_id`. It maps aliases such as
`coord_delegate` to their stored action and inspects only your participant.
`completed` plus `hasCachedResult` means retry the original tool with identical
arguments/key to retrieve its receipt. Completed records without cached results
still fence replay. A `running` record does not prove a live process; inspect
the host and task before deciding what stopped. `failed` may mean partial
side effects. `not_found` does not prove an unkeyed/setup request never applied.
Inspection does not clear reservations or replay work under a new key.

## Retiring obsolete tasks

Lead: `coord_read_task` first to inspect `cancellationImpact`. If that work is
obsolete, pass its `revision` to `coord_cancel_task` as `expected_revision`,
with the task ID, a reason and stable `request_id`. Cancellation permanently
ends that task, releases its locks, frees its owner and fails unfinished
downstream tasks whose dependencies become impossible. A changed task or
dependency chain invalidates the pin. Cancellation is recorded before
best-effort interruption; do not infer that the native turn has stopped from
`cancelled: true`. It does not erase saved edits or clear uncertain execution
reservations. For achievable work use release/handoff; for restarting an owned
turn use `coord_cancel_turn`.


## Isolated result integration

Lead: `coord_read_result` defaults to a small overview: actual changed paths,
verification, merge preview, run review and integration blockers. It omits diff
text. Read the whole source branch, including later task changes, with
`coord_read_result_diff(review_token=checkout.token)`. Select a changed `file`
or omit it for the branch; follow `nextOffset` while `hasMore`. Pages default
to 8,000 characters, maximum 16,000, and include untracked/binary changes.
Offsets use JavaScript string positions; use the returned next offset.
Source or target changes invalidate all pages. Read all relevant changes before
integrating. `include_diff=true` on the overview retains the legacy 200,000
character preview, which can truncate and omits untracked contents; use pages
for complete inspection. The human UI preview remains unchanged.
Reading does not approve a human gate. After inspecting it, pass
`checkout.token` as `review_token` to `coord_integrate_result`, with the task ID
and a required stable `request_id`. Source or target changes invalidate that
review. The shared implementation rejects dirty targets, path-grant violations,
stale verification, open decisions, pending teammate native questions, retained
execution, unknown/conflicted merge previews, and unapproved required reviews.
Foreign hosts must integrate in their owning host.

Integration commits any uncommitted source work onto its task branch and
squash-merges it into the target as staged changes. It never commits the target.
Keep unrelated edits and ask their owner to resolve a blocked target; do not
stash or reset another lane to make the gate pass. The operation uses the same
replay key through UI and MCP. After a lost response retry identical arguments
and key, or inspect it with `coord_inspect_operation`. A failure after possible
Git writes remains fenced; inspection does not authorize a new-key replay.
