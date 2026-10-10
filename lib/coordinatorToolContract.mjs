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
  { name: 'coord_read_handoff', description: 'Read an immutable portable task checkpoint by its contextHandoff.id. Includes source session, claim, task text, checkout fingerprint and digest. Owner-supplied context must be verified; this is not a native transcript replay.', fields: { handoff_id: { t: 'string', min: 1 } }, action: 'read_handoff', mapArgs: a => ({ handoffId: a.handoff_id }) },
  { name: 'coord_capabilities', description: 'Read the model IDs and effort levels a provider advertises, so requested_model/requested_effort on coord_delegate or coord_create_task name something that exists. Omit provider for your participant\'s own. status is available (use models[].value), unavailable (see error; call again to refresh) or unsupported (no read-only catalog: omit model and effort, or pass an ID you know that provider accepts). provider_instance_id selects a configured account or endpoint; instances lists safe public identities. Never creates or resumes a session.', fields: { provider: { t: 'enum', values: ['claude', 'codex', 'opencode', 'copilot', 'pi'], optional: true }, provider_instance_id: { t: 'string', min: 1, max: 64, optional: true } }, action: 'capabilities', mapArgs: a => ({ provider: a.provider, providerInstanceId: a.provider_instance_id }) },
  {
    name: 'coord_wait',
    description: 'Wait for board changes — only in an interactive host without resource subscriptions. A managed turn must never call this: return control when idle so the supervisor waits without model tokens. Without agent, returns on any change by another participant except heartbeats and usage telemetry; your own writes do not wake it. With agent, returns only when that teammate is in or reaches an until state (default: idle, ready, done, blocked, failed or stopped), or when new mail needs your reply. Act on the returned events and `actionable` digest instead of calling coord_status again. An empty or timed-out result is normal.',
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
    description: 'Read the shared task board, roster, locks, recent events, and an `actionable` digest for this participant: replyRequiredCount (answer first), myTask, claimableTasks, plansAwaitingReview, allTasksTerminal. Start every turn here and let the digest choose the next step.',
    fields: {},
    action: 'status',
    mapArgs: () => ({}),
  },
  {
    name: 'coord_read_inbox',
    description: 'Read and acknowledge unread mailbox messages for this participant. Acknowledging records delivery only: answer an obligation with coord_send_message and in_reply_to set to the message id. Answer replyRequired messages before other work — the sender treats silence as dropped, not busy. unresolved=true instead lists reply-required messages you have not answered yet, with their original ids, even after delivery or a restart; it never acknowledges. Use it when a completion is rejected for unanswered mail. Status-kind mail can be held up to 15s (or until 3 accumulate), so an empty result right after someone says they sent something is not proof nothing arrived.',
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
    description: 'Add a task with dependencies and expected write paths to the shared board. Any participant may add discovered work; a lead adding one during synthesis reopens the run. Put everything the claimer needs in detail — it does not see your conversation. role (default teammate) says who may claim it; role_name/role_description give it a persona you invent per task. Lead: assign_to delegates atomically to an idle teammate by name or ID, reusing its session; delivery is queued, not proof of execution — prefer coord_delegate for that. On playbook boards pass the phase title. The result includes `similarTasks` when this may duplicate existing work: check before assuming it is new.',
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
      requested_provider: { t: 'enum', values: ['codex', 'claude', 'copilot', 'opencode', 'pi'], optional: true },
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
    description: 'Lead: hand one concrete task to a teammate in a single call — creates the task, assigns it, grants its paths and queues the notification, or leaves no task at all when the teammate is busy or the paths conflict. Pick the teammate one of three ways: omit both to and name to reuse any idle teammate (a server-managed run creates one when none is free); name (a lowercase letter then letters, digits, - or _, e.g. reviewer) to reuse or create a teammate called that; to for a follow-up to an existing teammate, which keeps its session and context. Put everything it needs in detail — it does not see your conversation. Explicit provider, account, model or effort selection prevents automatic cross-provider failover. requested_provider_instance_id pins the configured account or endpoint; omit it to inherit the lead instance when creating a teammate on the same provider. requested_provider applies only to a NEW teammate; take requested_model/requested_effort from coord_capabilities or omit them for team defaults. The result carries the task, agent and session identity with delivery: queued — assignment, not proof of execution. With wait_ms (interactive hosts only; managed turns omit it) it also returns settled.outcome: completed, failed, cancelled, blocked, needs_reply, stalled (no activity seen yet) or timeout. None of the last four means the work was lost: inspect the board and inbox, and never send the assignment again. To steer work already in progress use coord_send_message, not a second delegation.',
    fields: {
      to: { t: 'string', min: 1, max: 160, optional: true },
      name: { t: 'string', min: 1, max: 32, optional: true },
      wait_ms: { t: 'number', int: true, min: 0, max: 55_000, optional: true },
      requested_provider: { t: 'enum', values: ['claude', 'codex', 'opencode', 'copilot', 'pi'], optional: true },
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
    description: 'Atomically claim a specific pending task, or the next unblocked one for your role when task_id is omitted. You hold one task at a time. A "No claimable task: …" answer says exactly why (already own one, blocked by dependencies, wrong role, path locked): act on that reason rather than retrying. When task.contextHandoff is present, inspect and verify the checkpoint before resuming; it grants no extra paths or approvals.',
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
    description: 'Publish something other participants need into the shared event log: a fact about this work (finding), reusable context (learning), a handoff note (handoff), or a review request (review.requested). Searchable later with coord_query_context; gone when the run ends — use coord_remember for what must outlive it. Detail may be up to 32,000 characters; split anything larger across focused findings.',
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
    description: 'Search this run\'s findings, learnings, and task outcomes for text relevant to a question — a lexical lookup, not full recall. Use this instead of re-reading all of coord_status when you only need context on one topic (e.g. "what did we decide about auth?"), especially after rejoining a long-running run.',
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
    description: 'Complete your claimed task with an honest receipt. Verify first: the gate runs the task\'s verify commands and compares the checkout with your granted paths. A refusal comes back as accepted: false with a reason, not an error — fix what it names (an edit outside your paths, a failing check, an unapproved plan, an open decision at low/medium autonomy) and call again. An error naming unanswered reply-required messages means answer them first (coord_read_inbox unresolved=true). Pending observed nested/background tasks and scheduled wakeups also block completion, including after restart until the provider reports settled. Omit model and usage when you cannot observe them; never guess. needs_decision_json is a JSON array of at most 20 objects with a non-empty question; optional fields: id, options (strings), assumed, impactIfWrong, status (open by default, answered, deferred), answer. Omit it or use [] when none remain.',
    fields: {
      task_id: { t: 'string', min: 1 },
      summary: { t: 'string', min: 1, max: 2000 },
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
      provider: { t: 'enum', values: ['codex', 'claude', 'copilot', 'opencode', 'pi'], optional: true },
    },
    action: 'spawn_teammate',
    mapArgs: (a) => ({ provider: a.provider }),
  },
]

// Reads need no replay key. Acknowledging inbox reads are mutations: replay
// must recover the original batch rather than silently advancing past it.
const READ_ONLY_COORD_ACTIONS = new Set(['read_handoff', 'capabilities', 'wait', 'status', 'query_context', 'list_roles'])
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
    fields: { ...spec.fields, request_id: { t: 'string', min: 1, max: 160, optional: true } },
    mapArgs: (args) => ({
      ...spec.mapArgs(args),
      ...(typeof args.request_id === 'string' && args.request_id
        ? { requestId: args.request_id }
        : {}),
    }),
  }
})
