// Provider-neutral tool metadata and argument mapping. Keep this module free
// of SDK/backend imports: OpenCode loads it in a separate Node process.
export const COORD_FINDING_DETAIL_MAX_CHARS = 32_000

function coordinatorMessage(args) {
  const canonical = typeof args.message === 'string' ? args.message.trim() : ''
  if (canonical) return canonical
  const body = typeof args.body === 'string' ? args.body.trim() : ''
  if (body) return body
  const summary = typeof args.summary === 'string' ? args.summary.trim() : ''
  const detail = typeof args.detail === 'string' ? args.detail.trim() : ''
  return [summary, detail].filter(Boolean).join('\n\n')
}

export function validateCoordinatorDecisions(value) {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length > 20) {
    throw new Error('needsDecision must be an array of at most 20 decision objects')
  }
  for (const [index, entry] of value.entries()) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)
      || typeof entry.question !== 'string' || !entry.question.trim()) {
      throw new Error(`needsDecision[${index}] must have a non-empty question`)
    }
    if (entry.status !== undefined && !['open', 'answered', 'deferred'].includes(entry.status)) {
      throw new Error(`needsDecision[${index}].status must be open, answered, or deferred`)
    }
  }
  return value
}

function parsedDecisions(value) {
  if (value === undefined) return undefined
  let parsed
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error('needs_decision_json must contain a valid JSON array of decision objects; omit it when there are no decisions')
  }
  return validateCoordinatorDecisions(parsed)
}

const BASE_COORD_TOOL_SPECS = [
  {
    name: 'coord_read_result_diff', description: 'Lead-only: read a diff page with review_token=checkout.token from coord_read_result. Optional file must be in checkout.files; omit for the whole branch. Includes tracked/binary and untracked changes. offset/limit are character offsets (default 8000, max 16000); follow nextOffset while hasMore. Source/target changes invalidate every page. Read all relevant changes before integration; inspection does not approve human gates.',
    fields: { task_id: { t: 'string', min: 1 }, review_token: { t: 'string', min: 1 }, file: { t: 'string', min: 1, optional: true }, offset: { t: 'number', int: true, min: 0, optional: true }, limit: { t: 'number', int: true, min: 1, max: 16000, optional: true } }, action: 'read_result_diff', mapArgs: a => ({ taskId: a.task_id, reviewToken: a.review_token, file: a.file, offset: a.offset, limit: a.limit }),
  },
  {
    name: 'coord_read_result', description: 'Lead-only: inspect an isolated completed task checkout for integration. Defaults to overview without diff; include_diff=true retains the legacy preview capped at 200000 characters. Use coord_read_result_diff for pinned file/pages, including untracked contents. Returns its durable receipt, verification freshness, actual changed paths/diff for the whole source branch (including later task changes), merge conflicts, run-review state and integrationBlockers. Does not approve review or apply changes. checkout.token pins source and target revisions, receipt and run review; use it as review_token on coord_integrate_result after inspecting the diff. Shared checkout changes are already present and are not integrated. Foreign execution hosts are reported without reading their local paths.',
    fields: { task_id: { t: 'string', min: 1 }, include_diff: { t: 'boolean', optional: true } }, action: 'read_result', mapArgs: a => ({ taskId: a.task_id, includeDiff: a.include_diff }),
  },
  {
    name: 'coord_integrate_result', description: 'Lead-only: integrate with review_token=checkout.token from coord_read_result and a required stable request_id. Rechecks source/target, completion, grants, verification, idle owner, decisions, human run review and host ownership. Does not approve human gates. Commits uncommitted source work on its task branch, then stages a squash merge in the target; never commits the target. Dirty targets/conflicts block it: preserve unrelated edits. Lost responses retry the same key; failures after Git writes remain uncertain. Use coord_inspect_operation.',
    fields: { task_id: { t: 'string', min: 1 }, review_token: { t: 'string', min: 1 }, request_id: { t: 'string', min: 1, max: 160 } }, action: 'integrate_result', mapArgs: a => ({ taskId: a.task_id, reviewToken: a.review_token, requestId: a.request_id }),
  },
  {
    name: 'coord_inspect_operation', description: "Inspect your participant's keyed operation after a lost response: original tool_name and operation_request_id. Aliases map to stored actions. Returns ledger state, cache availability and task/agent references; never replays or clears work. running is not proof of a live process; not_found does not prove an unkeyed/setup request never applied. failed may have partial effects. Retrieve a cached completed receipt by retrying the original tool with identical arguments/key. Expired receipts still fence replay.",
    fields: { tool_name: { t: 'string', min: 1 }, operation_request_id: { t: 'string', min: 1, max: 160 } }, action: 'inspect_operation', mapArgs: a => ({ toolName: a.tool_name, operationRequestId: a.operation_request_id }),
  },
  {
    name: 'coord_read_task', description: 'Read one exact task in your bound run, including its full prompt, receipt, verification, decisions, handoff and durable result even when it aged out of coord_status. Returns claimGeneration and a revision pin plus cancellationImpact for unfinished downstream dependents. No mailbox or provider credentials. Use the revision for coord_cancel_task; any task or dependent-work change invalidates it.',
    fields: { task_id: { t: 'string', min: 1 } }, action: 'read_task', mapArgs: a => ({ taskId: a.task_id }),
  },
  {
    name: 'coord_list_tasks', description: 'List compact task summaries in insertion order for your bound run, including tasks that aged out of coord_status. Optional status filter; limit defaults to 20, maximum 100. Pass nextCursor as cursor with the same filter while hasMore is true. Updates do not reorder entries; filters reflect current status, so this is not a frozen snapshot. Use coord_read_task for the full receipt or result.',
    fields: { cursor: { t: 'string', min: 1, optional: true }, limit: { t: 'number', int: true, min: 1, max: 100, optional: true }, status: { t: 'enum', values: ['pending', 'claimed', 'planning', 'planned', 'in_progress', 'blocked', 'completed', 'failed', 'cancelled'], optional: true } }, action: 'list_tasks', mapArgs: a => ({ cursor: a.cursor, limit: a.limit, status: a.status }),
  },
  {
    name: 'coord_cancel_task', description: 'Lead-only: permanently cancel obsolete task work, release its locks and free its owner. Unfinished downstream tasks whose dependencies become impossible are failed. First coord_read_task to inspect cancellationImpact, then pass its revision as expected_revision and a concrete reason. Changed task/dependency work and another owning host are rejected. Best-effort turn interruption follows cancellation; inspect the receipt rather than assuming the native turn stopped. Use coord_cancel_turn to restart a turn while preserving ownership, or coord_release_task to keep achievable work on the board. Reuse request_id for retries.',
    fields: { task_id: { t: 'string', min: 1 }, expected_revision: { t: 'string', min: 1 }, reason: { t: 'string', min: 1 } }, action: 'cancel_task', mapArgs: a => ({ taskId: a.task_id, expectedRevision: a.expected_revision, reason: a.reason }),
  },
  {
    name: 'coord_resume_agent',
    description: 'Lead-only: resume a managed participant after inspecting its saved transcript and coord_inspect_recovery. Starts a new turn in the same conversation and checkout; does not create a replacement. Pass exact recoveryClaim taskId/sessionId/claimGeneration; for a taskless managed lead pass attemptId/sessionId instead. Active provider cooldowns and uncertain live execution reject recovery. Rejects stale claims, live turns, another owning host, unavailable native sessions/directories, pending native permission/questions, task approvals/open decisions and budget gates. Provider failure may recur: inspect its cause before resuming. Reuse request_id for transport retries; never repeat with a new key merely because dispatch is queued.',
    fields: { agent_id: { t: 'string', min: 1 }, expected_task_id: { t: 'string', min: 1, optional: true }, expected_session_id: { t: 'string', min: 1 }, expected_claim_generation: { t: 'number', int: true, min: 0, optional: true }, expected_attempt_id: { t: 'string', min: 1, optional: true } },
    action: 'resume_agent', mapArgs: a => ({ targetAgentId: a.agent_id, expectedTaskId: a.expected_task_id, expectedSessionId: a.expected_session_id, expectedClaimGeneration: a.expected_claim_generation, expectedAttemptId: a.expected_attempt_id }),
  },
  {
    name: 'coord_inspect_recovery',
    description: 'Lead-only: inspect saved participant executions without claiming the host, creating a conversation or submitting work. Optional agent takes a name or ID. Returns native conversation/directory evidence, host ownership, needsRecovery and canAcknowledge, plus retained reservations, exact native attempt bindings/outcomes and explicit provider cooldown evidence. Unknown reset times stay unknown. Inspect the saved transcript before retiring a marker. executionElsewhere means use the owning host; needsRecovery on unfinished work requires coord_resume_agent after transcript inspection, not repeated release/claim or delegation.',
    fields: { agent: { t: 'string', min: 1, optional: true } },
    action: 'inspect_recovery', mapArgs: a => ({ agent: a.agent }),
  },
  {
    name: 'coord_acknowledge_execution',
    description: 'Lead-only: retire a completed or relinquished execution reservation after inspecting its saved transcript with coord_inspect_recovery. Pass the agent ID and exact reservation taskId/createdAt from inspection. Rechecks host ownership, live turns, unfinished work and reservation identity; a stale inspection is rejected. Retains any newer claim and locks. Does not itself submit a turn; maintenance may dispatch an already queued assignment afterward. Cannot answer human approvals or permission requests. Reuse request_id for transport retries.',
    fields: { agent_id: { t: 'string', min: 1 }, expected_task_id: { t: 'string', min: 1 }, expected_created_at: { t: 'string', min: 1 } },
    action: 'acknowledge_execution', mapArgs: a => ({ targetAgentId: a.agent_id, expectedTaskId: a.expected_task_id, expectedCreatedAt: a.expected_created_at }),
  },
  { name: 'coord_read_handoff', description: 'Read an immutable portable task checkpoint by its contextHandoff.id. Includes source session, claim, task text, checkout fingerprint and digest. Owner-supplied context must be verified; this is not a native transcript replay.', fields: { handoff_id: { t: 'string', min: 1 } }, action: 'read_handoff', mapArgs: a => ({ handoffId: a.handoff_id }) },
  { name: 'coord_capabilities', description: 'Read advertised model IDs (models[].value), effort levels and public provider instances. Omit provider for yours; provider_instance_id selects an account/endpoint. status=available, unavailable (error; refresh), or unsupported (omit model/effort or use a known valid ID). Never creates/resumes a session.', fields: { provider: { t: 'enum', values: ['claude', 'codex', 'opencode', 'copilot', 'pi', 'acp'], optional: true }, provider_instance_id: { t: 'string', min: 1, max: 64, optional: true } }, action: 'capabilities', mapArgs: a => ({ provider: a.provider, providerInstanceId: a.provider_instance_id }) },
  {
    name: 'coord_wait',
    description: "Interactive hosts without subscriptions: wait for other participants' board activity; own writes/heartbeats do not wake it. Managed model turns return to their supervisor instead. Optional agent waits for that teammate to settle in until states, or new reply-required mail. Act on returned events/actionable without another status call. Empty/time-out results are normal.",
    fields: {
      cursor: { t: 'string', optional: true },
      timeout_ms: { t: 'number', int: true, min: 0, max: 55_000, optional: true },
      agent: { t: 'string', optional: true },
      until: { t: 'stringArray', max: 7, optional: true },
    },
    action: 'wait',
    mapArgs: (a) => ({ cursor: a.cursor, timeoutMs: a.timeout_ms, agent: a.agent, until: a.until }),
  },
  {
    name: 'coord_status',
    description: 'Read caller state. view=full (default) returns board/roster/locks and excerpted events; view=actionable returns only run identity/status, cursor, phases and next actions for routine checks. Answer replyRequiredCount first, continue myTask, then claim/review/finalize as appropriate. waitingPolicy names who waits; managed turns return when idle. Use coord_read_task for full receipts, coord_query_context for full findings. Push/wait already includes next actions: do not follow it with another status read.',
    fields: { view: { t: 'enum', values: ['full', 'actionable'], optional: true } },
    action: 'status',
    mapArgs: a => ({ view: a.view }),
  },
  {
    name: 'coord_read_inbox',
    description: 'Read unread mail; defaults to acknowledging delivery, not resolving replies. Answer replyRequired mail with coord_send_message(in_reply_to=id). unresolved=true lists unanswered obligations with original IDs after reads/restarts and never acknowledges. Supply a stable request_id for acknowledging reads. Status mail can be batched up to 15s or three messages; an empty read does not prove none arrived.',
    fields: {
      after: { t: 'string', optional: true },
      limit: { t: 'number', int: true, min: 1, max: 200, optional: true },
      acknowledge: { t: 'boolean', optional: true },
      unresolved: { t: 'boolean', optional: true },
    },
    action: 'read_inbox',
    mapArgs: (a) => ({ after: a.after, limit: a.limit, acknowledge: a.acknowledge, unresolved: a.unresolved }),
  },
  {
    name: 'coord_send_message',
    description: 'Send a typed direct message to a teammate by name or id, to "lead", or to "all" (every other active participant). Setting EITHER kind:"status" OR priority:"status" holds the message until 3 such messages accumulate or 15 seconds pass, and "urgent" does not override kind:"status" — leave both off status for anything the recipient should see now. Answer a request with kind:"response" and in_reply_to set to its id; in_reply_to must address exactly one participant, never "all". The result\'s `delivery` gives each recipient\'s liveness (fresh/stale/dead): if stale or dead, route around them rather than waiting on a reply.',
    fields: {
      to: { t: 'string', min: 1 },
      message: { t: 'string', min: 1, max: 8000 },
      kind: { t: 'enum', values: ['request', 'response', 'status', 'finding', 'handoff', 'review_request', 'review_result'], optional: true },
      priority: { t: 'enum', values: ['status', 'normal', 'urgent'], optional: true },
      reply_required: { t: 'boolean', optional: true },
      correlation_id: { t: 'string', min: 1, max: 160, optional: true },
      in_reply_to: { t: 'string', optional: true },
    },
    action: 'send_message',
    mapArgs: (a) => ({
      to: a.to,
      message: coordinatorMessage(a),
      kind: a.kind === 'alert' ? 'request' : a.kind,
      priority: a.priority,
      replyRequired: a.reply_required,
      correlationId: a.correlation_id,
      inReplyTo: a.in_reply_to,
    }),
  },
  {
    name: 'coord_create_task',
    description: 'Add discovered work with complete detail, dependencies and write paths. role defaults to teammate; role_name/role_description define a reusable persona. On playbook boards pass phase title. Lead assign_to atomically delegates to an idle teammate by name/ID; prefer coord_delegate for assignments. A lead adding work during synthesis reopens the run. Check returned similarTasks for duplicates. delivery=queued confirms assignment only.',
    fields: {
      assign_to: { t: 'string', min: 1, max: 160, optional: true },
      title: { t: 'string', min: 1, max: 160 },
      detail: { t: 'string', min: 1, max: 8000 },
      paths: { t: 'stringArray', max: 100, optional: true },
      depends_on: { t: 'stringArray', max: 100, optional: true },
      phase: { t: 'string', min: 1, max: 120, optional: true },
      role: { t: 'enum', values: ['lead', 'teammate', 'any'], optional: true },
      role_name: { t: 'string', min: 1, max: 80, optional: true },
      role_description: { t: 'string', min: 1, max: 1000, optional: true },
      seat: { t: 'enum', values: ['director', 'executor', 'validator', 'watcher'], optional: true },
      requested_provider: { t: 'enum', values: ['codex', 'claude', 'copilot', 'opencode', 'pi', 'acp'], optional: true },
      requested_provider_instance_id: { t: 'string', min: 1, max: 64, optional: true },
      requested_model: { t: 'string', min: 1, max: 200, optional: true },
      requested_effort: { t: 'string', min: 1, max: 100, optional: true },
      verify_commands: { t: 'stringArray', max: 20, optional: true },
    },
    action: 'create_task',
    mapArgs: (a) => ({
      assignTo: a.assign_to,
      title: a.title,
      detail: a.detail,
      paths: a.paths,
      dependsOn: a.depends_on,
      phase: a.phase,
      targetRole: a.role,
      roleName: a.role_name,
      roleDescription: a.role_description,
      seat: a.seat,
      requestedProvider: a.requested_provider, requestedProviderInstanceId: a.requested_provider_instance_id,
      requestedModel: a.requested_model,
      requestedEffort: a.requested_effort,
      verifyCommands: a.verify_commands,
    }),
  },
  {
    name: 'coord_delegate',
    description: 'Lead-only: atomically create, assign and grant paths, or create no task on busy/path conflict. Omit to/name for any idle teammate; name (lowercase letter first, then lowercase letters/digits/-/_) reuses/creates a named teammate; to reuses an existing session. Put complete context in detail. requested_provider applies only to new teammates; provider/account/model/effort pins prevent cross-provider failover. Get model/effort IDs from coord_capabilities. delivery=queued is assignment, not execution. Interactive hosts may pass wait_ms for settled.outcome; managed turns omit it. blocked/needs_reply/stalled/timeout require inspection, never duplicate delegation. Steer active work with coord_send_message.',
    fields: {
      to: { t: 'string', min: 1, max: 160, optional: true },
      name: { t: 'string', min: 1, max: 32, optional: true },
      wait_ms: { t: 'number', int: true, min: 0, max: 55_000, optional: true },
      requested_provider: { t: 'enum', values: ['claude', 'codex', 'opencode', 'copilot', 'pi', 'acp'], optional: true },
      requested_provider_instance_id: { t: 'string', min: 1, max: 64, optional: true },
      requested_model: { t: 'string', min: 1, max: 200, optional: true },
      requested_effort: { t: 'string', min: 1, max: 100, optional: true },
      title: { t: 'string', min: 1, max: 160 },
      detail: { t: 'string', min: 1, max: 8000 },
      paths: { t: 'stringArray', max: 100, optional: true },
      verify_commands: { t: 'stringArray', max: 20, optional: true },
    },
    action: 'create_task',
    mapArgs: (a) => ({ assignTo: a.to ?? 'auto', teammateName: a.to ? undefined : a.name, waitMs: a.wait_ms, title: a.title, detail: a.detail, paths: a.paths, verifyCommands: a.verify_commands, targetRole: 'teammate', requestedProvider: a.requested_provider, requestedProviderInstanceId: a.requested_provider_instance_id, requestedModel: a.requested_model, requestedEffort: a.requested_effort }),
  },
  {
    name: 'coord_claim_task',
    description: 'Atomically claim a specific pending task, or the next unblocked one for your role when task_id is omitted. You hold one task at a time. grantedPaths in the result are already locked for you; request only further paths. A "No claimable task: …" answer says exactly why (already own one, blocked by dependencies, wrong role, path locked): act on that reason rather than retrying. When task.contextHandoff is present, inspect and verify the checkpoint before resuming; it grants no extra paths or approvals.',
    fields: { task_id: { t: 'string', min: 1, optional: true } },
    action: 'claim_task',
    mapArgs: (a) => ({ taskId: a.task_id }),
  },
  {
    name: 'coord_release_task',
    description: 'Return a claimed task to the board without failing it, releasing its locks so another participant can claim it. Owners hand back work they cannot finish; the lead can also release a wedged or failed task to requeue it. Say why in reason.',
    fields: {
      task_id: { t: 'string', min: 1 },
      reason: { t: 'string', max: 1000, optional: true },
    },
    action: 'release_task',
    mapArgs: (a) => ({ taskId: a.task_id, reason: a.reason }),
  },
  {
    name: 'coord_handoff_task',
    description: 'Checkpoint owned work after a provider/CLI failure or bounded supervisor stop, release its locks, and return it to the board; the lead receives an urgent durable handoff. Put what is done, what remains, and where things stand in summary/detail — the next owner starts from it. The task carries an immutable contextHandoff checkpoint; coord_read_handoff inspects its pinned source session, claim and checkout fingerprint.',
    fields: {
      task_id: { t: 'string', min: 1 },
      summary: { t: 'string', min: 1, max: 1000 },
      detail: { t: 'string', max: 8000, optional: true },
      failure_class: { t: 'enum', values: ['rate_limited', 'authentication_failed', 'context_exhausted', 'approval_blocked', 'cli_missing', 'transient_transport', 'provider_failure', 'provider_timeout', 'supervisor_stopped'] },
    },
    action: 'handoff_task',
    mapArgs: (a) => ({ taskId: a.task_id, summary: a.summary, detail: a.detail, failureClass: a.failure_class }),
  },
  {
    name: 'coord_leave_run',
    description: 'Leave the run as the current participant, releasing active locks. Fails while you still own a task — release or hand it off first — or owe reply-required mail. A teammate steps aside once its lane is done and no more work is expected; a lead leaving fails the whole run and stops every participant.',
    fields: { reason: { t: 'string', max: 1000, optional: true } },
    action: 'leave_run',
    mapArgs: (a) => ({ reason: a.reason }),
  },
  {
    name: 'coord_cancel_turn',
    description: 'Lead-only: interrupt a teammate\'s in-flight turn without releasing its task. Its supervisor starts a fresh turn; ownership and status are untouched. Use this for a stuck or looping turn, coord_release_task to put the work back on the board. agent_id takes a name or id, not yourself.',
    fields: { agent_id: { t: 'string', min: 1 } },
    action: 'cancel_turn',
    mapArgs: (a) => ({ targetAgentId: a.agent_id }),
  },
  {
    name: 'coord_request_locks',
    description: 'Request write locks for more paths needed by your current task. Returns explicit `granted` and `denied` (with the conflicting holder) lists; do not edit a denied path — wait, or tell the lead the lanes overlap.',
    fields: { paths: { t: 'stringArray', min: 1, max: 100 } },
    action: 'request_locks',
    mapArgs: (a) => ({ paths: a.paths }),
  },
  {
    name: 'coord_progress',
    description: 'Report working, blocked, idle, ready, or heartbeat for this participant. working and blocked need an owned task — claim first. Give blocked the exact obstacle in summary and return to working when it clears. In an interactive host, send heartbeat about every two minutes of long work: silence past that reads to the lead as stalled, not slow. A managed supervisor heartbeats for you; still report meaningful progress.',
    fields: {
      status: { t: 'enum', values: ['ready', 'working', 'idle', 'blocked', 'heartbeat'] },
      task_id: { t: 'string', optional: true },
      summary: { t: 'string', max: 2000, optional: true },
      detail: { t: 'string', max: 8000, optional: true },
    },
    action: 'progress',
    mapArgs: (a) => ({ status: a.status, taskId: a.task_id, summary: a.summary, detail: a.detail }),
  },
  {
    name: 'coord_publish_finding',
    description: 'Publish something other participants need into the shared event log: a fact about this work (finding), reusable context (learning), a handoff note (handoff), or a review request (review.requested). coord_status lists it with a 600-character excerpt of detail, so lead with the conclusion; coord_query_context returns the full text. gone when the run ends — use coord_remember for what must outlive it. Detail may be up to 32,000 characters; split anything larger across focused findings.',
    fields: {
      kind: { t: 'enum', values: ['finding', 'learning', 'handoff', 'review.requested'] },
      summary: { t: 'string', min: 1, max: 2000 },
      detail: { t: 'string', max: COORD_FINDING_DETAIL_MAX_CHARS, optional: true },
      task_id: { t: 'string', optional: true },
    },
    action: 'finding',
    mapArgs: (a) => ({ kind: a.kind, summary: a.summary, detail: a.detail, taskId: a.task_id }),
  },
  {
    name: 'coord_query_context',
    description: 'Search this run\'s findings, learnings, and task outcomes for text relevant to a question — a lexical lookup, not full recall. Use this instead of re-reading all of coord_status when you only need context on one topic (e.g. "what did we decide about auth?"), especially after rejoining a long-running run. The best match comes back whole and the rest in full while a size budget lasts; a cut entry says so — query for it specifically, or with limit 1, to read all of it.',
    fields: {
      query: { t: 'string', min: 1, max: 300 },
      limit: { t: 'number', int: true, min: 1, max: 20, optional: true },
    },
    action: 'query_context',
    mapArgs: (a) => ({ query: a.query, limit: a.limit }),
  },
  {
    name: 'coord_remember',
    description: 'Record a durable fact into this project\'s persistent memory (.agent-viewer/memory.md) — unlike coord_publish_finding, this outlives the run: every future coordinator run in this project starts with it in view. Use for genuinely durable context (architecture decisions, gotchas, established patterns), not routine progress.',
    fields: {
      summary: { t: 'string', min: 1, max: 2000 },
      detail: { t: 'string', max: 8000, optional: true },
    },
    action: 'remember',
    mapArgs: (a) => ({ summary: a.summary, detail: a.detail }),
  },
  {
    name: 'coord_save_role',
    description: 'Save a role_name/role_description pairing for reuse across coord_create_task calls (this run and future ones) — invent the persona once, then pass just role_name and it will be filled in automatically.',
    fields: {
      name: { t: 'string', min: 1, max: 80 },
      description: { t: 'string', min: 1, max: 1000 },
    },
    action: 'save_role',
    mapArgs: (a) => ({ name: a.name, description: a.description }),
  },
  {
    name: 'coord_list_roles',
    description: 'List saved role templates (name + description) available for coord_create_task\'s role_name in this project.',
    fields: {},
    action: 'list_roles',
    mapArgs: () => ({}),
  },
  {
    name: 'coord_submit_plan',
    description: 'Submit your implementation plan for a claimed task when the run requires plan approval, then wait: do not edit until the lead approves it.',
    fields: {
      task_id: { t: 'string', min: 1 },
      summary: { t: 'string', min: 1, max: 2000 },
      detail: { t: 'string', max: 8000, optional: true },
    },
    action: 'submit_plan',
    mapArgs: (a) => ({ taskId: a.task_id, summary: a.summary, detail: a.detail }),
  },
  {
    name: 'coord_review_plan',
    description: 'Lead-only: approve or reject a teammate\'s submitted plan and notify its owner. On rejection say what must change in summary/detail.',
    fields: {
      task_id: { t: 'string', min: 1 },
      approved: { t: 'boolean' },
      summary: { t: 'string', max: 2000, optional: true },
      detail: { t: 'string', max: 8000, optional: true },
    },
    action: 'review_plan',
    mapArgs: (a) => ({ taskId: a.task_id, approved: a.approved, summary: a.summary, detail: a.detail }),
  },
  {
    name: 'coord_review_phase',
    description: 'Lead-only: approve or reject a completed phase gate. Low/medium autonomy runs cannot enter the next phase until this is approved.',
    fields: {
      phase: { t: 'string', min: 1, max: 120 },
      approved: { t: 'boolean' },
      summary: { t: 'string', max: 2000, optional: true },
      detail: { t: 'string', max: 8000, optional: true },
    },
    action: 'review_phase',
    mapArgs: (a) => ({ phase: a.phase, approved: a.approved, summary: a.summary, detail: a.detail }),
  },
  {
    name: 'coord_review_run',
    description: 'Lead-only judgment gate after mechanical validation. Review the acceptance contract, task receipts, scope, risks, and unresolved decisions before approving synthesis.',
    fields: {
      approved: { t: 'boolean' },
      summary: { t: 'string', min: 1, max: 2000 },
      detail: { t: 'string', max: 16000, optional: true },
    },
    action: 'review_run',
    mapArgs: (a) => ({ approved: a.approved, summary: a.summary, detail: a.detail }),
  },
  {
    name: 'coord_resolve_decision',
    description: 'Lead-only: answer or explicitly defer a structured open decision raised by a worker receipt.',
    fields: {
      task_id: { t: 'string', min: 1 },
      decision_id: { t: 'string', min: 1 },
      answer: { t: 'string', min: 1, max: 4000 },
      deferred: { t: 'boolean', optional: true },
    },
    action: 'resolve_decision',
    mapArgs: (a) => ({ taskId: a.task_id, decisionId: a.decision_id, answer: a.answer, deferred: a.deferred }),
  },
  {
    name: 'coord_promote_learning',
    description: 'Lead-only: mark a recurring learning candidate for promotion into a playbook, saved role, or project memory. This records intent; it does not silently rewrite artifacts.',
    fields: {
      candidate_id: { t: 'string', min: 1 },
      target: { t: 'enum', values: ['playbook', 'role', 'project_memory'] },
    },
    action: 'promote_learning',
    mapArgs: (a) => ({ candidateId: a.candidate_id, target: a.target }),
  },
  {
    name: 'coord_complete_task',
    description: 'Complete verified owned work with an honest receipt: summary is the one line the lead reads (strongly expected; filled in as "<task> completed (no summary given)" when omitted). The gate checks verification commands, granted paths, plan approval and decisions. accepted=false includes the reason: correct it and retry the same key. Unanswered mail requires coord_read_inbox(unresolved=true) and correlated replies first. Pending observed background tasks/wakeups block completion after restart too. Omit unobservable model/usage. needs_decision_json: JSON array, max 20 objects, nonblank question; optional id/options/assumed/impactIfWrong/status(open|answered|deferred)/answer. Omit or [] when none.',
    fields: {
      task_id: { t: 'string', min: 1 },
      summary: { t: 'string', min: 1, max: 2000, optional: true },
      detail: { t: 'string', max: 8000, optional: true },
      actual_model: { t: 'string', min: 1, max: 200, optional: true },
      files_changed: { t: 'stringArray', max: 200, optional: true },
      commands_run: { t: 'stringArray', max: 100, optional: true },
      input_tokens: { t: 'number', int: true, min: 0, optional: true },
      output_tokens: { t: 'number', int: true, min: 0, optional: true },
      total_tokens: { t: 'number', int: true, min: 0, optional: true },
      cost_usd: { t: 'number', min: 0, optional: true },
      duration_ms: { t: 'number', int: true, min: 0, optional: true },
      needs_decision_json: { t: 'string', max: 16000, optional: true },
    },
    action: 'complete_task',
    mapArgs: (a) => ({
      taskId: a.task_id,
      summary: a.summary,
      detail: a.detail,
      actualModel: a.actual_model,
      filesChanged: a.files_changed,
      commandsRun: a.commands_run,
      usage: {
        inputTokens: a.input_tokens,
        outputTokens: a.output_tokens,
        totalTokens: a.total_tokens,
        costUsd: a.cost_usd,
        durationMs: a.duration_ms,
      },
      needsDecision: parsedDecisions(a.needs_decision_json),
    }),
  },
  {
    name: 'coord_fail_task',
    description: 'Mark your claimed task failed with a reason so the board can continue to synthesis. Only for work that genuinely cannot be done; use coord_release_task for work someone else could finish and coord_handoff_task after a provider failure.',
    fields: {
      task_id: { t: 'string', min: 1 },
      summary: { t: 'string', min: 1, max: 2000 },
      detail: { t: 'string', max: 8000, optional: true },
    },
    action: 'fail_task',
    mapArgs: (a) => ({ taskId: a.task_id, summary: a.summary, detail: a.detail }),
  },
  {
    name: 'coord_finalize_run',
    description: 'Lead-only: close the run with a concise synthesis once every task is completed, failed, or cancelled and any required judgment review is approved. In a persistent interactive room, do not finalize just because a batch finished.',
    fields: { summary: { t: 'string', min: 1, max: 16000 } },
    action: 'finalize_run',
    mapArgs: (a) => ({ summary: a.summary }),
  },
  {
    name: 'coord_spawn_teammate',
    description: 'Lead-only: spawn one additional teammate mid-run when you discover more parallelizable work than the team was originally sized for. Only works for runs this server started (in-app runs); externally-run Coordinator sessions must add teammates by starting another CLI and calling coord_join_run instead.',
    fields: {
      provider: { t: 'enum', values: ['codex', 'claude', 'copilot', 'opencode', 'pi', 'acp'], optional: true },
    },
    action: 'spawn_teammate',
    mapArgs: (a) => ({ provider: a.provider }),
  },
]

// Reads need no replay key. Acknowledging inbox reads are mutations: replay
// must recover the original batch rather than silently advancing past it.
const READ_ONLY_COORD_ACTIONS = new Set(['read_result_diff', 'read_result', 'inspect_operation', 'read_task', 'list_tasks', 'inspect_recovery', 'read_handoff', 'capabilities', 'wait', 'status', 'query_context', 'list_roles'])
/** The one description of a coord_* tool; the MCP bridge reads it from here too. */
export function coordToolDescription(name) {
  const spec = BASE_COORD_TOOL_SPECS.find((entry) => entry.name === name)
  if (!spec) throw new Error(`Unknown Coordinator tool: ${name}`)
  return spec.description
}

export const COORD_TOOL_SPECS = BASE_COORD_TOOL_SPECS.map((spec) => {
  if (READ_ONLY_COORD_ACTIONS.has(spec.action)) return spec
  return {
    ...spec,
    fields: { ...spec.fields, request_id: spec.fields.request_id ?? { t: 'string', min: 1, max: 160, optional: true } },
    mapArgs: (args) => ({
      ...spec.mapArgs(args),
      ...(typeof args.request_id === 'string' && args.request_id
        ? { requestId: args.request_id }
        : {}),
    }),
  }
})


const LEAD_ONLY_COORD_TOOLS = new Set([
  'coord_read_result', 'coord_read_result_diff', 'coord_integrate_result',
  'coord_cancel_task', 'coord_inspect_recovery', 'coord_resume_agent',
  'coord_acknowledge_execution', 'coord_delegate', 'coord_review_plan',
  'coord_review_phase', 'coord_review_run', 'coord_resolve_decision',
  'coord_promote_learning', 'coord_cancel_turn', 'coord_spawn_teammate',
  'coord_finalize_run', 'coord_save_playbook',
])

/** Discovery hint only; backend participant authorization still checks each call. */
export function coordToolAllowedForRole(name, role) {
  return role !== 'teammate' || !LEAD_ONLY_COORD_TOOLS.has(name)
}
export function coordinatorToolSpecsForRole(role) {
  return COORD_TOOL_SPECS.filter(spec => coordToolAllowedForRole(spec.name, role))
}
