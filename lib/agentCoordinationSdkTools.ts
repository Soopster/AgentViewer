/**
 * In-process Coordinator tools for internally-hosted (pooled) agent sessions
 * — the SDK-tool counterpart to bin/agent-viewer-mcp.mjs's stdio tool set.
 * External CLIs reach the coordinator over stdio + HTTP; a pooled session
 * lives in this same process, so its tools call `executeExternalCoordinatorAction`
 * directly (no IPC, no fenced-block text protocol, no prompt-engineered
 * grammar to re-explain every turn).
 *
 * Every provider's native SDK has its own shape for "a locally-executed
 * custom tool," so COORD_TOOL_SPECS below is the single source of truth for
 * the coord_* contract (name, fields, the coordinator action + arg mapping)
 * and each provider gets a small converter from that shared spec to its own
 * tool type — buildCoordinatorSdkTools (Claude, zod shapes), buildCoordinatorPiTools
 * (Pi, TypeBox), buildCoordinatorCopilotTools (Copilot, zod objects). Codex
 * doesn't have an SDK tool type at all — see registerCoordinatorCodexTools
 * for its dynamicTools + server-request flow.
 *
 * A run's controller registers a session id → identity binding per
 * Claude/Pi/Copilot/Codex agent (see the register* functions below) and each
 * provider's client looks the binding up by session id at the point it
 * actually starts/resumes that session.
 */
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import type { McpServerConfig } from '@anthropic-ai/claude-agent-sdk'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { Type, type TSchema } from 'typebox'
import type { ToolDefinition as PiToolDefinition } from '@earendil-works/pi-coding-agent'
import type { DynamicToolSpec } from './codex-schema/v2'
import type { JsonValue } from './codex-schema/serde_json/JsonValue'
import type { ExternalProtocolIdentity } from './agentProtocol'

export const COORD_FINDING_DETAIL_MAX_CHARS = 32_000

function textResult(value: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value) }],
  }
}

function errorResult(error: unknown) {
  return {
    content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }],
    isError: true as const,
  }
}

// Deferred: agentCoordinationExternal.ts pulls in agentCoordination.ts, which
// pulls in sessionBackend.ts/claudePool.ts/piClient.ts/copilotClient.ts/codexClient.ts,
// which import this module at their top level to look up registered tools —
// a static import here would close that into a cycle. Node resolves a
// runtime import() after every module's own top-level body has finished
// evaluating, so this stays a leaf module for bundling purposes while still
// reaching the real dispatcher when called.
async function call(identity: ExternalProtocolIdentity, action: string, args: Record<string, unknown> = {}) {
  try {
    const { executeExternalCoordinatorAction } = await import('./agentCoordinationExternal')
    const result = await executeExternalCoordinatorAction({
      action,
      runId: identity.runId,
      agentId: identity.agentId,
      token: identity.token,
      requestId: randomUUID(),
      ...args,
    })
    return textResult(result)
  } catch (error) {
    return errorResult(error)
  }
}

async function callJson(identity: ExternalProtocolIdentity, action: string, args: Record<string, unknown> = {}): Promise<{ text: string; isError: boolean }> {
  try {
    const { executeExternalCoordinatorAction } = await import('./agentCoordinationExternal')
    const result = await executeExternalCoordinatorAction({
      action,
      runId: identity.runId,
      agentId: identity.agentId,
      token: identity.token,
      requestId: randomUUID(),
      ...args,
    })
    return { text: JSON.stringify(result), isError: false }
  } catch (error) {
    return { text: error instanceof Error ? error.message : String(error), isError: true }
  }
}

// ---- Shared coord_* tool contract -----------------------------------------

type FieldSpec =
  | { t: 'string'; min?: number; max?: number; optional?: boolean }
  | { t: 'enum'; values: readonly [string, ...string[]]; optional?: boolean }
  | { t: 'number'; int?: boolean; min?: number; max?: number; optional?: boolean }
  | { t: 'boolean'; optional?: boolean }
  | { t: 'stringArray'; min?: number; max?: number; optional?: boolean }

type ToolSpec = {
  name: string
  description: string
  fields: Record<string, FieldSpec>
  action: string
  mapArgs: (args: Record<string, any>) => Record<string, unknown>
}

function coordinatorMessage(args: Record<string, any>): string {
  const canonical = typeof args.message === 'string' ? args.message.trim() : ''
  if (canonical) return canonical
  const body = typeof args.body === 'string' ? args.body.trim() : ''
  if (body) return body
  const summary = typeof args.summary === 'string' ? args.summary.trim() : ''
  const detail = typeof args.detail === 'string' ? args.detail.trim() : ''
  return [summary, detail].filter(Boolean).join('\n\n')
}

function parsedJsonArray(value: unknown): unknown[] | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

const COORD_TOOL_SPECS: ToolSpec[] = [
  {
    name: 'coord_wait',
    description: 'Block (up to timeout_ms) until the board changes — new mail, task state, findings. Use this only for a short, bounded wait on something specific (e.g. a reply you expect soon); when there is nothing actionable and nothing specific to wait for, just end your turn instead — the coordinator re-dispatches you when the board changes.',
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
]

function zodField(f: FieldSpec): z.ZodTypeAny {
  let base: z.ZodTypeAny
  switch (f.t) {
    case 'string': {
      let s = z.string()
      if (f.min !== undefined) s = s.min(f.min)
      if (f.max !== undefined) s = s.max(f.max)
      base = s
      break
    }
    case 'enum':
      base = z.enum(f.values)
      break
    case 'number': {
      let n = z.number()
      if (f.int) n = n.int()
      if (f.min !== undefined) n = n.min(f.min)
      if (f.max !== undefined) n = n.max(f.max)
      base = n
      break
    }
    case 'boolean':
      base = z.boolean()
      break
    case 'stringArray': {
      let arr = z.array(z.string().min(1))
      if (f.min !== undefined) arr = arr.min(f.min)
      if (f.max !== undefined) arr = arr.max(f.max)
      base = arr
      break
    }
  }
  return f.optional ? base.optional() : base
}

function zodShape(fields: Record<string, FieldSpec>): Record<string, z.ZodTypeAny> {
  return Object.fromEntries(Object.entries(fields).map(([key, spec]) => [key, zodField(spec)]))
}

/** Build the coord_* tool set bound to one participant identity (Claude Agent SDK). */
export function buildCoordinatorSdkTools(identity: ExternalProtocolIdentity) {
  return COORD_TOOL_SPECS.map((spec) => tool(
    spec.name,
    spec.description,
    zodShape(spec.fields),
    async (args: Record<string, any>) => call(identity, spec.action, spec.mapArgs(args)),
  ))
}

const registry = new Map<string, Record<string, McpServerConfig>>()

/** Bind a session id to a Coordinator identity's tool set for its whole lifetime. */
export function registerCoordinatorMcpServer(sessionId: string, identity: ExternalProtocolIdentity): void {
  registry.set(sessionId, {
    'agent-viewer': createSdkMcpServer({
      name: 'agent-viewer',
      tools: buildCoordinatorSdkTools(identity),
    }),
  })
}

export function getCoordinatorMcpServers(sessionId: string): Record<string, McpServerConfig> | undefined {
  return registry.get(sessionId)
}

export function unregisterCoordinatorMcpServer(sessionId: string): void {
  registry.delete(sessionId)
}

// ---- Pi (TypeBox customTools) ----------------------------------------------

function typeboxField(f: FieldSpec): TSchema {
  let base: TSchema
  switch (f.t) {
    case 'string':
      base = Type.String(f.min !== undefined || f.max !== undefined ? { minLength: f.min, maxLength: f.max } : undefined)
      break
    case 'enum':
      base = Type.Union(f.values.map((value) => Type.Literal(value)))
      break
    case 'number':
      base = f.int
        ? Type.Integer(f.min !== undefined || f.max !== undefined ? { minimum: f.min, maximum: f.max } : undefined)
        : Type.Number(f.min !== undefined || f.max !== undefined ? { minimum: f.min, maximum: f.max } : undefined)
      break
    case 'boolean':
      base = Type.Boolean()
      break
    case 'stringArray':
      base = Type.Array(Type.String({ minLength: 1 }), f.min !== undefined || f.max !== undefined ? { minItems: f.min, maxItems: f.max } : undefined)
      break
  }
  return f.optional ? Type.Optional(base) : base
}

function typeboxParams(fields: Record<string, FieldSpec>): TSchema {
  return Type.Object(Object.fromEntries(Object.entries(fields).map(([key, spec]) => [key, typeboxField(spec)])))
}

/** Build the coord_* tool set bound to one participant identity (Pi's customTools). */
export function buildCoordinatorPiTools(identity: ExternalProtocolIdentity): PiToolDefinition[] {
  return COORD_TOOL_SPECS.map((spec) => ({
    name: spec.name,
    label: spec.name,
    description: spec.description,
    parameters: typeboxParams(spec.fields),
    async execute(_toolCallId: string, params: Record<string, any>) {
      const { text, isError } = await callJson(identity, spec.action, spec.mapArgs(params))
      return {
        content: [{ type: 'text' as const, text }],
        details: isError ? { error: text } : undefined,
      }
    },
  }))
}

const piRegistry = new Map<string, ExternalProtocolIdentity>()

export function registerCoordinatorPiTools(sessionId: string, identity: ExternalProtocolIdentity): void {
  piRegistry.set(sessionId, identity)
}

/** Pi's createAgentSession/customTools option needs the built tool array, not just the identity. */
export function getCoordinatorPiTools(sessionId: string): PiToolDefinition[] | undefined {
  const identity = piRegistry.get(sessionId)
  return identity ? buildCoordinatorPiTools(identity) : undefined
}

export function unregisterCoordinatorPiTools(sessionId: string): void {
  piRegistry.delete(sessionId)
}

// ---- Copilot (zod-schema Tool[]) -------------------------------------------

/** Build the coord_* tool set bound to one participant identity (Copilot SDK's Tool[]). */
export function buildCoordinatorCopilotTools(identity: ExternalProtocolIdentity): unknown[] {
  return COORD_TOOL_SPECS.map((spec) => ({
    name: spec.name,
    description: spec.description,
    parameters: z.object(zodShape(spec.fields)),
    skipPermission: true,
    async handler(args: Record<string, any>) {
      const { text, isError } = await callJson(identity, spec.action, spec.mapArgs(args))
      if (isError) throw new Error(text)
      return text
    },
  }))
}

const copilotRegistry = new Map<string, ExternalProtocolIdentity>()

export function registerCoordinatorCopilotTools(sessionId: string, identity: ExternalProtocolIdentity): void {
  copilotRegistry.set(sessionId, identity)
}

export function getCoordinatorCopilotTools(sessionId: string): unknown[] | undefined {
  const identity = copilotRegistry.get(sessionId)
  return identity ? buildCoordinatorCopilotTools(identity) : undefined
}

export function unregisterCoordinatorCopilotTools(sessionId: string): void {
  copilotRegistry.delete(sessionId)
}

// ---- Codex (JSON-schema dynamicTools + item/tool/call) --------------------

function jsonSchemaField(f: FieldSpec): Record<string, unknown> {
  switch (f.t) {
    case 'string':
      return { type: 'string', ...(f.min !== undefined ? { minLength: f.min } : {}), ...(f.max !== undefined ? { maxLength: f.max } : {}) }
    case 'enum':
      return { type: 'string', enum: [...f.values] }
    case 'number':
      return { type: f.int ? 'integer' : 'number', ...(f.min !== undefined ? { minimum: f.min } : {}), ...(f.max !== undefined ? { maximum: f.max } : {}) }
    case 'boolean':
      return { type: 'boolean' }
    case 'stringArray':
      return { type: 'array', items: { type: 'string', minLength: 1 }, ...(f.min !== undefined ? { minItems: f.min } : {}), ...(f.max !== undefined ? { maxItems: f.max } : {}) }
  }
}

function jsonSchemaParams(fields: Record<string, FieldSpec>): Record<string, unknown> {
  const properties: Record<string, unknown> = {}
  const required: string[] = []
  for (const [key, spec] of Object.entries(fields)) {
    properties[key] = jsonSchemaField(spec)
    if (!spec.optional) required.push(key)
  }
  return { type: 'object', properties, ...(required.length ? { required } : {}), additionalProperties: false }
}

/** Codex's ThreadStartParams.dynamicTools shape — {type:'function', name, description, inputSchema}. */
export function buildCoordinatorCodexDynamicTools(): DynamicToolSpec[] {
  return COORD_TOOL_SPECS.map((spec) => ({
    type: 'function' as const,
    name: spec.name,
    description: spec.description,
    // jsonSchemaParams only ever nests string/number/boolean/array/plain-object
    // literals we control above — structurally a JsonValue, just not provably
    // so to a Record<string, unknown> return type.
    inputSchema: jsonSchemaParams(spec.fields) as unknown as JsonValue,
  }))
}

const codexRegistry = new Map<string, ExternalProtocolIdentity>()

/** Bind a Codex thread id to a Coordinator identity so the item/tool/call server-request handler (lib/codexClient.ts) can dispatch by name. */
export function registerCoordinatorCodexTools(threadId: string, identity: ExternalProtocolIdentity): void {
  codexRegistry.set(threadId, identity)
}

export function getCoordinatorCodexIdentity(threadId: string): ExternalProtocolIdentity | undefined {
  return codexRegistry.get(threadId)
}

export function unregisterCoordinatorCodexTools(threadId: string): void {
  codexRegistry.delete(threadId)
}

async function dispatchByRegistry(
  registry: Map<string, ExternalProtocolIdentity>,
  sessionId: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<{ text: string; isError: boolean } | null> {
  const identity = registry.get(sessionId)
  const invocation = resolveCoordinatorToolCall(toolName, args)
  if (!identity || !invocation) return null
  return callJson(identity, invocation.action, invocation.args)
}

/** Resolve the shared provider-facing tool contract into a Coordinator action. */
export function resolveCoordinatorToolCall(
  toolName: string,
  args: Record<string, unknown>,
): { action: string; args: Record<string, unknown> } | null {
  const spec = COORD_TOOL_SPECS.find((entry) => entry.name === toolName)
  return spec ? { action: spec.action, args: spec.mapArgs(args) } : null
}

/** Dispatch a codex item/tool/call for a registered thread. Returns null if the tool name isn't one of ours. */
export function dispatchCoordinatorCodexToolCall(
  threadId: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<{ text: string; isError: boolean } | null> {
  return dispatchByRegistry(codexRegistry, threadId, toolName, args)
}

// ---- OpenCode (plugin file + local HTTP bridge) ----------------------------

// OpenCode's server is a genuinely separate OS process (createOpencodeServer
// shells out via cross-spawn — lib/opencodeClient.ts), and its plugin API has
// no per-session tool registration hook (Hooks.tool is one static map for the
// whole server) — so identity resolution has to happen here, keyed by
// sessionID, when the plugin's HTTP bridge call for a tool arrives (see
// lib/coordinatorBridgeServer.ts and lib/opencodePlugin/agentViewerCoordinator.mjs).
const opencodeRegistry = new Map<string, ExternalProtocolIdentity>()

export function registerCoordinatorOpenCodeTools(sessionId: string, identity: ExternalProtocolIdentity): void {
  opencodeRegistry.set(sessionId, identity)
}

export function unregisterCoordinatorOpenCodeTools(sessionId: string): void {
  opencodeRegistry.delete(sessionId)
}

/** Dispatch an OpenCode coordinator-plugin tool call for a registered session. Returns null if the session isn't a coordinator participant or the tool name isn't one of ours. */
export function dispatchCoordinatorOpenCodeToolCall(
  sessionId: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<{ text: string; isError: boolean } | null> {
  return dispatchByRegistry(opencodeRegistry, sessionId, toolName, args)
}
