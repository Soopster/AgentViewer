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

const server = new McpServer({ name: 'agent-viewer', version: '1.1.0' })

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

const transport = new StdioServerTransport()
await server.connect(transport)
