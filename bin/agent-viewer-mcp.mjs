#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const PROVIDERS = ['claude', 'codex', 'opencode', 'copilot', 'pi']
const baseUrl = normalizeBaseUrl(
  process.env.AGENT_VIEWER_MCP_URL
    ?? process.env.AGENT_VIEWER_ATTACH
    ?? 'http://127.0.0.1:3000',
)
const bridgeCwd = process.env.CLAUDE_PROJECT_DIR?.trim() || process.cwd()
let coordinatorIdentity = (() => {
  const runId = process.env.AGENT_VIEWER_COORD_RUN_ID?.trim()
  const agentId = process.env.AGENT_VIEWER_COORD_AGENT_ID?.trim()
  const token = process.env.AGENT_VIEWER_COORD_TOKEN?.trim()
  return runId && agentId && token ? { runId, agentId, token } : null
})()

function normalizeBaseUrl(value) {
  const trimmed = String(value ?? '').trim().replace(/\/+$/, '')
  if (/^\d+$/.test(trimmed)) return `http://127.0.0.1:${trimmed}`
  if (!/^https?:\/\//i.test(trimmed)) return `http://${trimmed}`
  return trimmed
}

function textResult(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] }
}

async function requestJson(path, init) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10_000)
  timer.unref?.()
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init?.headers ?? {}),
      },
    })
    const payload = await response.json().catch(() => null)
    if (!response.ok) {
      const detail = payload && typeof payload.error === 'string'
        ? payload.error
        : `${response.status} ${response.statusText}`
      throw new Error(`Agent Viewer request failed: ${detail}`)
    }
    return payload
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Agent Viewer did not respond at ${baseUrl}`)
    }
    if (error instanceof TypeError) {
      throw new Error(`Cannot reach Agent Viewer at ${baseUrl}. Start \`npx agent-viewer web\` first.`)
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

function resolveSessionId(value) {
  const explicit = typeof value === 'string' ? value.trim() : ''
  const configured = process.env.AGENT_VIEWER_SESSION_ID?.trim() ?? ''
  const sessionId = explicit || configured
  if (!sessionId) {
    throw new Error('session_id is required for the CLI bridge (or set AGENT_VIEWER_SESSION_ID)')
  }
  return sessionId
}

function bindCoordinatorParticipant(result) {
  const participant = result?.participant
  if (participant?.runId && participant?.agentId && participant?.token) {
    coordinatorIdentity = {
      runId: participant.runId,
      agentId: participant.agentId,
      token: participant.token,
    }
  }
  return result
}

async function coordinatorRequest(action, payload = {}, requireIdentity = true) {
  if (requireIdentity && !coordinatorIdentity) {
    throw new Error('Join, create, or resume a Coordinator run before using participant tools')
  }
  return requestJson('/api/agent-protocol/external', {
    method: 'POST',
    body: JSON.stringify({
      action,
      ...(coordinatorIdentity ?? {}),
      ...payload,
    }),
  })
}

const server = new McpServer(
  { name: 'agent-viewer', version: '1.2.0' },
  {
    instructions: [
      'Agent Viewer Coordinator is a shared multi-CLI task board and mailbox.',
      'Use coord_create_run to lead a new run, coord_join_run to join an existing run, or coord_resume to restore a capability.',
      'After joining: read coord_status, claim one task, request locks before editing, report progress, read the inbox, and complete through coord_complete_task.',
      'Never invent agent ids or bypass Coordinator completion gates.',
    ].join(' '),
  },
)

server.registerTool('search_sessions', {
  description: 'Search Agent Viewer\'s persistent cross-provider session index. Returns session IDs and matching transcript snippets.',
  inputSchema: {
    query: z.string().min(1).describe('Text to search for'),
    limit: z.number().int().min(1).max(20).optional(),
    provider: z.enum(['all', ...PROVIDERS]).optional(),
    current_project_only: z.boolean().optional().describe('Restrict results to the bridge process working directory'),
  },
  annotations: { readOnlyHint: true },
}, async ({ query, limit, provider, current_project_only }) => {
  const params = new URLSearchParams({
    q: query,
    limit: String(limit ?? 10),
    includeWorktrees: 'true',
  })
  if (provider) params.set('provider', provider)
  if (current_project_only) params.set('dir', process.cwd())
  const result = await requestJson(`/api/session-index/search?${params}`)
  return textResult({
    total: result.total,
    results: Array.isArray(result.results)
      ? result.results.map(({ session, matches }) => ({
          provider: session?.provider,
          session_id: session?.sessionId,
          title: session?.customTitle ?? session?.title,
          cwd: session?.cwd,
          matches: Array.isArray(matches)
            ? matches.map((match) => ({
                message_uuid: match.uuid,
                role: match.type,
                snippet: match.snippet,
                timestamp: match.timestamp,
              }))
            : [],
        }))
      : [],
  })
})

server.registerTool('get_session_transcript', {
  description: 'Read a session transcript from any Agent Viewer provider. Returns full-fidelity canonical messages, including text, reasoning, tool calls, tool results, and system events.',
  inputSchema: {
    session_id: z.string().min(1).optional().describe('Required unless AGENT_VIEWER_SESSION_ID is configured'),
    provider: z.enum(PROVIDERS).optional().describe('Provider returned by search_sessions; defaults to Agent Viewer\'s active provider'),
    offset: z.number().int().min(0).optional().describe('Zero-based message offset; defaults to 0'),
    limit: z.number().int().min(1).max(500).optional().describe('Messages to return; defaults to 100'),
    tail: z.boolean().optional().describe('Read the newest messages instead of starting at offset'),
  },
  annotations: { readOnlyHint: true },
}, async ({ session_id, provider, offset, limit, tail }) => {
  const sessionId = resolveSessionId(session_id)
  const params = new URLSearchParams({
    offset: String(offset ?? 0),
    limit: String(limit ?? 100),
  })
  if (provider) params.set('provider', provider)
  if (tail) params.set('tail', '1')

  const result = await requestJson(
    `/api/sessions/${encodeURIComponent(sessionId)}/messages?${params}`,
  )
  const messages = Array.isArray(result.messages) ? result.messages : []
  const resultOffset = Number.isFinite(result.offset) ? result.offset : (offset ?? 0)
  const total = Number.isFinite(result.total) ? result.total : resultOffset + messages.length
  const nextOffset = resultOffset + messages.length

  return textResult({
    session_id: sessionId,
    provider: provider ?? result.provider,
    offset: resultOffset,
    total,
    has_more: nextOffset < total,
    next_offset: nextOffset < total ? nextOffset : null,
    messages,
  })
})

server.registerTool('set_bookmark', {
  description: 'Add or remove a local Agent Viewer bookmark for a transcript message.',
  inputSchema: {
    message_uuid: z.string().min(1),
    session_id: z.string().optional().describe('Required unless AGENT_VIEWER_SESSION_ID is configured'),
    provider: z.enum(PROVIDERS).optional(),
    bookmarked: z.boolean().optional().describe('False removes the bookmark; defaults to true'),
    label: z.string().max(120).optional(),
    preview: z.string().max(500).optional(),
  },
}, async ({ message_uuid, session_id, provider, bookmarked, label, preview }) => {
  const sessionId = resolveSessionId(session_id)
  const result = await requestJson(`/api/sessions/${encodeURIComponent(sessionId)}/bookmarks`, {
    method: 'POST',
    body: JSON.stringify({
      provider,
      uuid: message_uuid,
      bookmarked: bookmarked !== false,
      meta: { label, preview },
    }),
  })
  return textResult({
    session_id: sessionId,
    message_uuid,
    bookmarked: Array.isArray(result.ids) && result.ids.includes(message_uuid),
  })
})

server.registerTool('post_attention', {
  description: 'Post an item to the live Agent Viewer human-attention inbox.',
  inputSchema: {
    title: z.string().min(1).max(160),
    detail: z.string().max(1000).optional(),
    session_id: z.string().optional().describe('Required unless AGENT_VIEWER_SESSION_ID is configured'),
    provider: z.enum(PROVIDERS).optional(),
  },
}, async ({ title, detail, session_id, provider }) => {
  const sessionId = resolveSessionId(session_id)
  const result = await requestJson('/api/sessions/running', {
    method: 'POST',
    body: JSON.stringify({
      sessionId,
      provider: provider ?? 'claude',
      title,
      detail,
    }),
  })
  return textResult(result.attention)
})

server.registerTool('coord_list_runs', {
  description: 'List recent Agent Viewer Coordinator runs that an external CLI can join.',
  inputSchema: { limit: z.number().int().min(1).max(100).optional() },
  annotations: { readOnlyHint: true },
}, async ({ limit }) => {
  const result = await requestJson(`/api/agent-protocol/runs?limit=${limit ?? 20}`)
  return textResult(result)
})

server.registerTool('coord_create_run', {
  description: 'Create a ledger-only Coordinator run and bind this CLI as its lead. Add tasks next with coord_create_task.',
  inputSchema: {
    prompt: z.string().min(1),
    name: z.string().min(1).max(80).describe('Human-readable name for this CLI participant'),
    provider: z.enum(PROVIDERS).optional().describe('Defaults to codex'),
    max_agents: z.number().int().min(2).max(16).optional(),
    cwd: z.string().min(1).optional().describe('Working checkout; defaults to this CLI project directory'),
    gate_command: z.string().max(1000).optional(),
    require_plan_approval: z.boolean().optional(),
  },
}, async ({ prompt, name, provider, max_agents, cwd, gate_command, require_plan_approval }) => {
  const result = bindCoordinatorParticipant(await coordinatorRequest('create_run', {
    prompt,
    name,
    provider: provider ?? 'codex',
    maxAgents: max_agents,
    cwd: cwd ?? bridgeCwd,
    gateCommand: gate_command,
    requirePlanApproval: require_plan_approval,
  }, false))
  return textResult(result)
})

server.registerTool('coord_join_run', {
  description: 'Join an existing Coordinator run and bind this CLI as a named teammate.',
  inputSchema: {
    run_id: z.string().min(1),
    name: z.string().min(1).max(80),
    provider: z.enum(PROVIDERS).optional().describe('Defaults to codex'),
    cwd: z.string().min(1).optional().describe('Working checkout; defaults to this CLI project directory'),
  },
}, async ({ run_id, name, provider, cwd }) => {
  const result = bindCoordinatorParticipant(await coordinatorRequest('join_run', {
    runId: run_id,
    name,
    provider: provider ?? 'codex',
    cwd: cwd ?? bridgeCwd,
  }, false))
  return textResult(result)
})

server.registerTool('coord_resume', {
  description: 'Restore this MCP bridge participant identity after reconnecting or restarting a CLI.',
  inputSchema: {
    run_id: z.string().min(1),
    agent_id: z.string().min(1),
    token: z.string().min(1),
  },
}, async ({ run_id, agent_id, token }) => {
  coordinatorIdentity = { runId: run_id, agentId: agent_id, token }
  try {
    const result = bindCoordinatorParticipant(await coordinatorRequest('resume'))
    return textResult(result)
  } catch (error) {
    coordinatorIdentity = null
    throw error
  }
})

server.registerTool('coord_status', {
  description: 'Read the current shared task board, roster, locks, relevant events, and this participant\'s mailbox state.',
  annotations: { readOnlyHint: true },
}, async () => textResult(await coordinatorRequest('status')))

server.registerTool('coord_create_task', {
  description: 'Lead-only: add a task with dependencies and expected write paths to the shared board.',
  inputSchema: {
    title: z.string().min(1).max(160),
    detail: z.string().min(1).max(8000),
    paths: z.array(z.string().min(1)).max(100).optional(),
    depends_on: z.array(z.string().min(1)).max(100).optional(),
  },
}, async ({ title, detail, paths, depends_on }) => textResult(await coordinatorRequest('create_task', {
  title,
  detail,
  paths,
  dependsOn: depends_on,
})))

server.registerTool('coord_claim_task', {
  description: 'Atomically claim a specific pending task, or the next unblocked task when task_id is omitted.',
  inputSchema: { task_id: z.string().min(1).optional() },
}, async ({ task_id }) => textResult(await coordinatorRequest('claim_task', { taskId: task_id })))

server.registerTool('coord_read_inbox', {
  description: 'Read and acknowledge direct Coordinator mailbox messages for this participant.',
  inputSchema: {
    after: z.string().min(1).optional().describe('Message cursor returned by the previous call'),
    limit: z.number().int().min(1).max(200).optional(),
    acknowledge: z.boolean().optional().describe('Defaults to true'),
  },
}, async ({ after, limit, acknowledge }) => textResult(await coordinatorRequest('read_inbox', {
  after,
  limit,
  acknowledge,
})))

server.registerTool('coord_send_message', {
  description: 'Send a direct message to a teammate name, agent id, lead, or all participants.',
  inputSchema: {
    to: z.string().min(1),
    message: z.string().min(1).max(8000),
  },
}, async ({ to, message }) => textResult(await coordinatorRequest('send_message', { to, message })))

server.registerTool('coord_request_locks', {
  description: 'Request write locks for paths needed by the current task. Conflicting locks are denied atomically.',
  inputSchema: { paths: z.array(z.string().min(1)).min(1).max(100) },
}, async ({ paths }) => textResult(await coordinatorRequest('request_locks', { paths })))

server.registerTool('coord_progress', {
  description: 'Report working, idle, blocked, ready, or heartbeat state for this participant.',
  inputSchema: {
    status: z.enum(['ready', 'working', 'idle', 'blocked', 'heartbeat']),
    task_id: z.string().min(1).optional(),
    summary: z.string().max(1000).optional(),
    detail: z.string().max(8000).optional(),
  },
}, async ({ status, task_id, summary, detail }) => textResult(await coordinatorRequest('progress', {
  status,
  taskId: task_id,
  summary,
  detail,
})))

server.registerTool('coord_publish_finding', {
  description: 'Publish reusable knowledge, a handoff, or a review request into the shared Coordinator event log.',
  inputSchema: {
    kind: z.enum(['finding', 'learning', 'handoff', 'review.requested']),
    summary: z.string().min(1).max(1000),
    detail: z.string().max(8000).optional(),
    task_id: z.string().min(1).optional(),
  },
}, async ({ kind, summary, detail, task_id }) => textResult(await coordinatorRequest('finding', {
  kind,
  summary,
  detail,
  taskId: task_id,
})))

server.registerTool('coord_submit_plan', {
  description: 'Submit the plan for a claimed task when the run requires lead approval.',
  inputSchema: {
    task_id: z.string().min(1),
    summary: z.string().min(1).max(1000),
    detail: z.string().max(8000).optional(),
  },
}, async ({ task_id, summary, detail }) => textResult(await coordinatorRequest('submit_plan', {
  taskId: task_id,
  summary,
  detail,
})))

server.registerTool('coord_review_plan', {
  description: 'Lead-only: approve or reject a teammate plan and notify its owner.',
  inputSchema: {
    task_id: z.string().min(1),
    approved: z.boolean(),
    summary: z.string().max(1000).optional(),
    detail: z.string().max(8000).optional(),
  },
}, async ({ task_id, approved, summary, detail }) => textResult(await coordinatorRequest('review_plan', {
  taskId: task_id,
  approved,
  summary,
  detail,
})))

server.registerTool('coord_complete_task', {
  description: 'Complete an owned task through plan approval, path-lock, and quality-gate validation.',
  inputSchema: {
    task_id: z.string().min(1),
    summary: z.string().min(1).max(1000),
    detail: z.string().max(8000).optional(),
  },
}, async ({ task_id, summary, detail }) => textResult(await coordinatorRequest('complete_task', {
  taskId: task_id,
  summary,
  detail,
})))

server.registerTool('coord_fail_task', {
  description: 'Mark an owned task failed with a reason so the board can continue to synthesis.',
  inputSchema: {
    task_id: z.string().min(1),
    summary: z.string().min(1).max(1000),
    detail: z.string().max(8000).optional(),
  },
}, async ({ task_id, summary, detail }) => textResult(await coordinatorRequest('fail_task', {
  taskId: task_id,
  summary,
  detail,
})))

server.registerTool('coord_finalize_run', {
  description: 'Lead-only: finalize a run after every task is completed, failed, or cancelled.',
  inputSchema: { summary: z.string().min(1).max(16000) },
}, async ({ summary }) => textResult(await coordinatorRequest('finalize_run', { summary })))

const transport = new StdioServerTransport()
await server.connect(transport)
