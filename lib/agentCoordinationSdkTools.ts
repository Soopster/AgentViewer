/**
 * In-process Coordinator MCP tools for internally-hosted (pooled) agent
 * sessions — the SDK-tool counterpart to bin/agent-viewer-mcp.mjs's stdio
 * tool set. External CLIs reach the coordinator over stdio + HTTP; a
 * pooled Claude session lives in this same process, so its tools call
 * `executeExternalCoordinatorAction` directly (no IPC, no fenced-block
 * text protocol, no prompt-engineered grammar to re-explain every turn).
 *
 * A run's controller registers one of these servers per Claude-provider
 * agent (see registerCoordinatorMcpServer) and claudePool/sessionBackend
 * look servers up by session id when spawning that session's Query.
 */
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import type { McpServerConfig } from '@anthropic-ai/claude-agent-sdk'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { ExternalProtocolIdentity } from './agentProtocol'

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
// pulls in sessionBackend.ts/claudePool.ts, which import this module at their
// top level to look up registered servers — a static import here would close
// that into a cycle. Node resolves a runtime import() after every module's
// own top-level body has finished evaluating, so this stays a leaf module for
// bundling purposes while still reaching the real dispatcher when called.
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

/** Build the coord_* tool set bound to one participant identity. */
export function buildCoordinatorSdkTools(identity: ExternalProtocolIdentity) {
  return [
    tool(
      'coord_wait',
      'Block (up to timeout_ms) until the board changes — new mail, task state, findings. Use this only for a short, bounded wait on something specific (e.g. a reply you expect soon); when there is nothing actionable and nothing specific to wait for, just end your turn instead — the coordinator re-dispatches you when the board changes.',
      { cursor: z.string().optional(), timeout_ms: z.number().int().min(0).max(55_000).optional() },
      async (args) => call(identity, 'wait', { cursor: args.cursor, timeoutMs: args.timeout_ms }),
    ),
    tool(
      'coord_status',
      'Read the full run snapshot: roster, task board, recent events.',
      {},
      async () => call(identity, 'status'),
    ),
    tool(
      'coord_read_inbox',
      'Read and acknowledge direct mailbox messages. Any message with replyRequired=true needs a coord_send_message reply before other work.',
      { after: z.string().optional(), limit: z.number().int().min(1).max(200).optional(), acknowledge: z.boolean().optional() },
      async (args) => call(identity, 'read_inbox', { after: args.after, limit: args.limit, acknowledge: args.acknowledge }),
    ),
    tool(
      'coord_send_message',
      'Send a typed direct message to a teammate by name, "lead", or "all".',
      {
        to: z.string().min(1),
        summary: z.string().min(1).max(2000),
        detail: z.string().max(8000).optional(),
        kind: z.enum(['status', 'request', 'response', 'alert']).optional(),
        priority: z.enum(['status', 'normal', 'urgent']).optional(),
        reply_required: z.boolean().optional(),
        in_reply_to: z.string().optional(),
      },
      async (args) => call(identity, 'send_message', {
        to: args.to,
        summary: args.summary,
        detail: args.detail,
        kind: args.kind,
        priority: args.priority,
        replyRequired: args.reply_required,
        inReplyTo: args.in_reply_to,
      }),
    ),
    tool(
      'coord_create_task',
      'Add a task with dependencies and expected write paths to the shared board. Optionally give it a role_name/role_description specialization for whoever claims it.',
      {
        title: z.string().min(1).max(160),
        detail: z.string().min(1).max(8000),
        paths: z.array(z.string().min(1)).max(100).optional(),
        depends_on: z.array(z.string().min(1)).max(100).optional(),
        phase: z.string().min(1).max(120).optional(),
        role: z.enum(['lead', 'teammate', 'any']).optional(),
        role_name: z.string().min(1).max(80).optional(),
        role_description: z.string().min(1).max(1000).optional(),
      },
      async (args) => call(identity, 'create_task', {
        title: args.title,
        detail: args.detail,
        paths: args.paths,
        dependsOn: args.depends_on,
        phase: args.phase,
        targetRole: args.role,
        roleName: args.role_name,
        roleDescription: args.role_description,
      }),
    ),
    tool(
      'coord_claim_task',
      'Atomically claim a specific pending task, or the next unblocked one when task_id is omitted.',
      { task_id: z.string().min(1).optional() },
      async (args) => call(identity, 'claim_task', { taskId: args.task_id }),
    ),
    tool(
      'coord_release_task',
      'Return a claimed task to the board without failing it.',
      { task_id: z.string().min(1), reason: z.string().max(1000).optional() },
      async (args) => call(identity, 'release_task', { taskId: args.task_id, reason: args.reason }),
    ),
    tool(
      'coord_request_locks',
      'Request write locks for paths needed by the current task.',
      { paths: z.array(z.string().min(1)).min(1).max(100) },
      async (args) => call(identity, 'request_locks', { paths: args.paths }),
    ),
    tool(
      'coord_progress',
      'Report status: agent.start_work / agent.stop_work / heartbeat / blocked / unblocked.',
      {
        status: z.enum(['ready', 'working', 'idle', 'blocked', 'heartbeat']),
        task_id: z.string().optional(),
        summary: z.string().max(2000).optional(),
        detail: z.string().max(8000).optional(),
      },
      async (args) => call(identity, 'progress', { status: args.status, taskId: args.task_id, summary: args.summary, detail: args.detail }),
    ),
    tool(
      'coord_publish_finding',
      'Publish a fact (`finding`) or reusable context (`learning`) other agents need.',
      { kind: z.enum(['finding', 'learning']), summary: z.string().min(1).max(2000), detail: z.string().max(8000).optional(), task_id: z.string().optional() },
      async (args) => call(identity, 'finding', { kind: args.kind, summary: args.summary, detail: args.detail, taskId: args.task_id }),
    ),
    tool(
      'coord_submit_plan',
      'Submit an implementation plan for your claimed task before editing (when plan approval is required).',
      { task_id: z.string().min(1), summary: z.string().min(1).max(2000), detail: z.string().max(8000).optional() },
      async (args) => call(identity, 'submit_plan', { taskId: args.task_id, summary: args.summary, detail: args.detail }),
    ),
    tool(
      'coord_review_plan',
      'Lead-only: approve or reject a submitted plan.',
      { task_id: z.string().min(1), approve: z.boolean(), summary: z.string().max(2000).optional(), detail: z.string().max(8000).optional() },
      async (args) => call(identity, 'review_plan', { taskId: args.task_id, approve: args.approve, summary: args.summary, detail: args.detail }),
    ),
    tool(
      'coord_complete_task',
      'Complete your claimed task. Rejected (with feedback) if changes fall outside your granted paths, the quality gate fails, or plan approval is outstanding.',
      { task_id: z.string().min(1), summary: z.string().min(1).max(2000), detail: z.string().max(8000).optional() },
      async (args) => call(identity, 'complete_task', { taskId: args.task_id, summary: args.summary, detail: args.detail }),
    ),
    tool(
      'coord_fail_task',
      'Fail your claimed task with a reason.',
      { task_id: z.string().min(1), summary: z.string().min(1).max(2000), detail: z.string().max(8000).optional() },
      async (args) => call(identity, 'fail_task', { taskId: args.task_id, summary: args.summary, detail: args.detail }),
    ),
    tool(
      'coord_finalize_run',
      'Lead-only: finalize the run with a concise synthesis once all tasks are terminal.',
      { summary: z.string().min(1).max(4000) },
      async (args) => call(identity, 'finalize_run', { summary: args.summary }),
    ),
  ]
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
