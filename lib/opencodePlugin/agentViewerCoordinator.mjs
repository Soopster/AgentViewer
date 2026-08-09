// Agent Viewer's Coordinator tools for in-process OpenCode sessions.
//
// OpenCode's server is a genuinely separate OS process (createOpencodeServer
// shells out via cross-spawn — lib/opencodeClient.ts) and its plugin API has
// no per-session tool registration (Hooks.tool is one static map for the
// whole server), so every session sees this tool set, but a call only does
// anything for a session actually bound to a Coordinator run — everyone else
// gets a "not part of an active coordinator run" result. Identity resolution
// happens on the Agent Viewer side, keyed by OpenCode's own session id (see
// registerCoordinatorOpenCodeTools / dispatchCoordinatorOpenCodeToolCall in
// lib/agentCoordinationSdkTools.ts), reached over a small local HTTP bridge
// (lib/coordinatorBridgeServer.ts) since this process can't import that
// TypeScript module graph directly.
//
// Keep this tool table's names/descriptions/fields in sync with
// COORD_TOOL_SPECS in lib/agentCoordinationSdkTools.ts by hand — this file
// runs in a separate process spawned from a plain module specifier, so it
// can't share that table directly.
import { tool } from '@opencode-ai/plugin'

const z = tool.schema

const TOOL_SPECS = [
  {
    name: 'coord_wait',
    description: 'Block (up to timeout_ms) until the board changes — new mail, task state, findings. Use this only for a short, bounded wait on something specific (e.g. a reply you expect soon); when there is nothing actionable and nothing specific to wait for, just end your turn instead — the coordinator re-dispatches you when the board changes.',
    args: {
      cursor: z.string().optional(),
      timeout_ms: z.number().int().min(0).max(55_000).optional(),
    },
  },
  {
    name: 'coord_status',
    description: 'Read the full run snapshot: roster, task board, recent events.',
    args: {},
  },
  {
    name: 'coord_read_inbox',
    description: 'Read and acknowledge direct mailbox messages. Any message with replyRequired=true needs a coord_send_message reply before other work.',
    args: {
      after: z.string().optional(),
      limit: z.number().int().min(1).max(200).optional(),
      acknowledge: z.boolean().optional(),
    },
  },
  {
    name: 'coord_send_message',
    description: 'Send a typed direct message to a teammate by name, "lead", or "all".',
    args: {
      to: z.string().min(1),
      message: z.string().min(1).max(8000),
      kind: z.enum(['request', 'response', 'status', 'finding', 'handoff', 'review_request', 'review_result']).optional(),
      priority: z.enum(['status', 'normal', 'urgent']).optional(),
      reply_required: z.boolean().optional(),
      correlation_id: z.string().min(1).max(160).optional(),
      in_reply_to: z.string().optional(),
    },
  },
  {
    name: 'coord_create_task',
    description: 'Add a task with dependencies and expected write paths to the shared board. Optionally give it a role_name/role_description specialization for whoever claims it.',
    args: {
      title: z.string().min(1).max(160),
      detail: z.string().min(1).max(8000),
      paths: z.array(z.string().min(1)).max(100).optional(),
      depends_on: z.array(z.string().min(1)).max(100).optional(),
      phase: z.string().min(1).max(120).optional(),
      role: z.enum(['lead', 'teammate', 'any']).optional(),
      role_name: z.string().min(1).max(80).optional(),
      role_description: z.string().min(1).max(1000).optional(),
    },
  },
  {
    name: 'coord_claim_task',
    description: 'Atomically claim a specific pending task, or the next unblocked one when task_id is omitted.',
    args: { task_id: z.string().min(1).optional() },
  },
  {
    name: 'coord_release_task',
    description: 'Return a claimed task to the board without failing it.',
    args: {
      task_id: z.string().min(1),
      reason: z.string().max(1000).optional(),
    },
  },
  {
    name: 'coord_request_locks',
    description: 'Request write locks for paths needed by the current task.',
    args: { paths: z.array(z.string().min(1)).min(1).max(100) },
  },
  {
    name: 'coord_progress',
    description: 'Report status: agent.start_work / agent.stop_work / heartbeat / blocked / unblocked.',
    args: {
      status: z.enum(['ready', 'working', 'idle', 'blocked', 'heartbeat']),
      task_id: z.string().optional(),
      summary: z.string().max(2000).optional(),
      detail: z.string().max(8000).optional(),
    },
  },
  {
    name: 'coord_publish_finding',
    description: 'Publish a fact (`finding`) or reusable context (`learning`) other agents need.',
    args: {
      kind: z.enum(['finding', 'learning']),
      summary: z.string().min(1).max(2000),
      detail: z.string().max(8000).optional(),
      task_id: z.string().optional(),
    },
  },
  {
    name: 'coord_submit_plan',
    description: 'Submit an implementation plan for your claimed task before editing (when plan approval is required).',
    args: {
      task_id: z.string().min(1),
      summary: z.string().min(1).max(2000),
      detail: z.string().max(8000).optional(),
    },
  },
  {
    name: 'coord_review_plan',
    description: 'Lead-only: approve or reject a submitted plan.',
    args: {
      task_id: z.string().min(1),
      approved: z.boolean(),
      summary: z.string().max(2000).optional(),
      detail: z.string().max(8000).optional(),
    },
  },
  {
    name: 'coord_complete_task',
    description: 'Complete your claimed task. Rejected (with feedback) if changes fall outside your granted paths, the quality gate fails, or plan approval is outstanding.',
    args: {
      task_id: z.string().min(1),
      summary: z.string().min(1).max(2000),
      detail: z.string().max(8000).optional(),
    },
  },
  {
    name: 'coord_fail_task',
    description: 'Fail your claimed task with a reason.',
    args: {
      task_id: z.string().min(1),
      summary: z.string().min(1).max(2000),
      detail: z.string().max(8000).optional(),
    },
  },
  {
    name: 'coord_finalize_run',
    description: 'Lead-only: finalize the run with a concise synthesis once all tasks are terminal.',
    args: { summary: z.string().min(1).max(4000) },
  },
]

function bridgeUrl() {
  const url = process.env.AGENT_VIEWER_COORD_BRIDGE_URL
  if (!url) throw new Error('AGENT_VIEWER_COORD_BRIDGE_URL is not set — the Agent Viewer coordinator bridge was not started for this OpenCode server.')
  return url
}

function bridgeSecret() {
  const secret = process.env.AGENT_VIEWER_COORD_BRIDGE_SECRET
  if (!secret) throw new Error('AGENT_VIEWER_COORD_BRIDGE_SECRET is not set — the Agent Viewer coordinator bridge was not started for this OpenCode server.')
  return secret
}

async function callBridge(toolName, args, context) {
  const response = await fetch(bridgeUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bridgeSecret()}` },
    body: JSON.stringify({ sessionId: context.sessionID, tool: toolName, args }),
  })
  const body = await response.json().catch(() => ({ error: 'Invalid response from Agent Viewer coordinator bridge' }))
  if (response.status === 404) {
    return 'This session is not part of an active Agent Viewer Coordinator run.'
  }
  if (!response.ok) {
    throw new Error(body.error || 'Coordinator action failed')
  }
  return body.text
}

export const AgentViewerCoordinatorPlugin = async () => {
  const tools = {}
  for (const spec of TOOL_SPECS) {
    tools[spec.name] = tool({
      description: spec.description,
      args: spec.args,
      execute: (args, context) => callBridge(spec.name, args, context),
    })
  }
  return { tool: tools }
}
