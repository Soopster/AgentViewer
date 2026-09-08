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

function parsedJsonArray(value) {
  if (typeof value !== 'string' || !value.trim()) return undefined
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

const BASE_COORD_TOOL_SPECS = [
  {
    name: 'coord_wait',
    description: 'Wait for board changes only in an interactive host without resource subscriptions. Managed turns must never call this tool: return control when idle so the supervisor waits without model tokens.',
    fields: {
      cursor: { t: 'string', optional: true },
      timeout_ms: { t: 'number', int: true, min: 0, max: 55_000, optional: true },
    },
    action: 'wait',
    mapArgs: (a) => ({ cursor: a.cursor, timeoutMs: a.timeout_ms }),
  },
  {
    name: 'coord_status',
    description: 'Read the full run snapshot: roster, task board, recent events.',
    fields: {},
    action: 'status',
    mapArgs: () => ({}),
  },
  {
    name: 'coord_read_inbox',
    description: 'Read and acknowledge direct mailbox messages. Any message with replyRequired=true needs a coord_send_message reply before other work.',
    fields: {
      after: { t: 'string', optional: true },
      limit: { t: 'number', int: true, min: 1, max: 200, optional: true },
      acknowledge: { t: 'boolean', optional: true },
    },
    action: 'read_inbox',
    mapArgs: (a) => ({ after: a.after, limit: a.limit, acknowledge: a.acknowledge }),
  },
  {
    name: 'coord_send_message',
    description: 'Send a typed direct message to a teammate by name, "lead", or "all".',
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
    description: 'Add a task with dependencies and expected write paths to the shared board. Optionally give it a role_name/role_description specialization for whoever claims it. The result includes `similarTasks` when this looks like it may duplicate existing work — not blocking, but check before assuming it\'s new.',
    fields: {
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
      requested_model: { t: 'string', min: 1, max: 200, optional: true },
      requested_effort: { t: 'string', min: 1, max: 80, optional: true },
      verify_commands: { t: 'stringArray', max: 20, optional: true },
    },
    action: 'create_task',
    mapArgs: (a) => ({
      title: a.title,
      detail: a.detail,
      paths: a.paths,
      dependsOn: a.depends_on,
      phase: a.phase,
      targetRole: a.role,
      roleName: a.role_name,
      roleDescription: a.role_description,
      seat: a.seat,
      requestedProvider: a.requested_provider,
      requestedModel: a.requested_model,
      requestedEffort: a.requested_effort,
      verifyCommands: a.verify_commands,
    }),
  },
  {
    name: 'coord_claim_task',
    description: 'Atomically claim a specific pending task, or the next unblocked one when task_id is omitted.',
    fields: { task_id: { t: 'string', min: 1, optional: true } },
    action: 'claim_task',
    mapArgs: (a) => ({ taskId: a.task_id }),
  },
  {
    name: 'coord_release_task',
    description: 'Return a claimed task to the board without failing it.',
    fields: {
      task_id: { t: 'string', min: 1 },
      reason: { t: 'string', max: 1000, optional: true },
    },
    action: 'release_task',
    mapArgs: (a) => ({ taskId: a.task_id, reason: a.reason }),
  },
  {
    name: 'coord_handoff_task',
    description: 'Checkpoint owned work after a provider failure, release locks, and return it to the board with an urgent handoff to the lead.',
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
    description: 'Leave after releasing or handing off owned work. A teammate steps aside; a lead leaving fails the whole run and stops all participants.',
    fields: { reason: { t: 'string', max: 1000, optional: true } },
    action: 'leave_run',
    mapArgs: (a) => ({ reason: a.reason }),
  },
  {
    name: 'coord_cancel_turn',
    description: 'Lead-only: interrupt a working teammate while preserving task ownership. Its supervisor starts a fresh turn.',
    fields: { agent_id: { t: 'string', min: 1 } },
    action: 'cancel_turn',
    mapArgs: (a) => ({ targetAgentId: a.agent_id }),
  },
  {
    name: 'coord_request_locks',
    description: 'Request write locks for paths needed by the current task.',
    fields: { paths: { t: 'stringArray', min: 1, max: 100 } },
    action: 'request_locks',
    mapArgs: (a) => ({ paths: a.paths }),
  },
  {
    name: 'coord_progress',
    description: 'Report status: agent.start_work / agent.stop_work / heartbeat / blocked / unblocked.',
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
    description: 'Publish a fact (`finding`) or reusable context (`learning`) other agents need. Detailed audit evidence may be up to 32,000 characters; split anything larger across focused findings.',
    fields: {
      kind: { t: 'enum', values: ['finding', 'learning'] },
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
    description: 'Submit an implementation plan for your claimed task before editing (when plan approval is required).',
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
    description: 'Lead-only: approve or reject a submitted plan.',
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
    description: 'Complete your claimed task. Rejected (with feedback) if changes fall outside your granted paths, the quality gate fails, or plan approval is outstanding.',
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
      needsDecision: parsedJsonArray(a.needs_decision_json),
    }),
  },
  {
    name: 'coord_fail_task',
    description: 'Fail your claimed task with a reason.',
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
    description: 'Lead-only: finalize the run with a concise synthesis once all tasks are terminal.',
    fields: { summary: { t: 'string', min: 1, max: 4000 } },
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
const READ_ONLY_COORD_ACTIONS = new Set(['wait', 'status', 'query_context', 'list_roles'])
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
