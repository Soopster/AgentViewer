import type { McpServerConfigForProcessTransport, McpServerToolPolicy } from '@anthropic-ai/claude-agent-sdk'

type DynamicMcpServers = Record<string, McpServerConfigForProcessTransport>

const RESERVED_SERVER_NAMES = new Set(['agent-viewer', 'agent-viewer-messaging'])

declare global {
  // eslint-disable-next-line no-var
  var __agentViewerClaudeDynamicMcp: Map<string, DynamicMcpServers> | undefined
}

const bySession = globalThis.__agentViewerClaudeDynamicMcp
  ?? (globalThis.__agentViewerClaudeDynamicMcp = new Map<string, DynamicMcpServers>())
const MAX_TRACKED_SESSIONS = 256

function stringRecord(value: unknown): Record<string, string> | undefined {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('MCP env/headers must be an object of strings')
  const entries = Object.entries(value)
  if (entries.some(([, item]) => typeof item !== 'string')) throw new Error('MCP env/headers values must be strings')
  return Object.fromEntries(entries) as Record<string, string>
}

function toolPolicies(value: unknown): McpServerToolPolicy[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new Error('MCP tools must be an array')
  return value.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('Each MCP tool policy must be an object')
    const input = entry as Record<string, unknown>
    const name = typeof input.name === 'string' ? input.name.trim() : ''
    if (!name) throw new Error('Each MCP tool policy requires name')
    const permissionPolicy = input.permission_policy
    if (permissionPolicy !== undefined && permissionPolicy !== 'always_allow' && permissionPolicy !== 'always_ask' && permissionPolicy !== 'always_deny') {
      throw new Error('MCP tool permission_policy must be always_allow, always_ask, or always_deny')
    }
    const orgMaxPermission = input.org_max_permission
    if (orgMaxPermission !== undefined && orgMaxPermission !== 'allow' && orgMaxPermission !== 'ask' && orgMaxPermission !== 'blocked') {
      throw new Error('MCP tool org_max_permission must be allow, ask, or blocked')
    }
    return {
      name,
      ...(permissionPolicy ? { permission_policy: permissionPolicy as McpServerToolPolicy['permission_policy'] } : {}),
      ...(orgMaxPermission ? { org_max_permission: orgMaxPermission as McpServerToolPolicy['org_max_permission'] } : {}),
    }
  })
}

function parseServer(value: unknown): McpServerConfigForProcessTransport {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Each MCP server must be a configuration object')
  const input = value as Record<string, unknown>
  const timeout = typeof input.timeout === 'number' && Number.isFinite(input.timeout) && input.timeout >= 1000
    ? Math.floor(input.timeout)
    : undefined
  const alwaysLoad = typeof input.alwaysLoad === 'boolean' ? input.alwaysLoad : undefined
  if (input.type === 'http' || input.type === 'sse') {
    const url = typeof input.url === 'string' ? input.url.trim() : ''
    if (!url) throw new Error(`${input.type} MCP server requires url`)
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error('MCP URL must use http or https')
    const headers = stringRecord(input.headers)
    const tools = toolPolicies(input.tools)
    const shared = {
      url,
      ...(headers ? { headers } : {}),
      ...(tools ? { tools } : {}),
      ...(timeout ? { timeout } : {}),
      ...(alwaysLoad !== undefined ? { alwaysLoad } : {}),
    }
    return input.type === 'http' ? { type: 'http', ...shared } : { type: 'sse', ...shared }
  }
  if (input.type === 'sdk') {
    const name = typeof input.name === 'string' ? input.name.trim() : ''
    if (!name) throw new Error('sdk MCP server requires name')
    return { type: 'sdk', name }
  }
  if (input.type !== undefined && input.type !== 'stdio') throw new Error('MCP type must be stdio, http, sse, or sdk')
  const command = typeof input.command === 'string' ? input.command.trim() : ''
  if (!command) throw new Error('stdio MCP server requires command')
  const args = input.args === undefined
    ? undefined
    : Array.isArray(input.args) && input.args.every((item) => typeof item === 'string')
      ? input.args as string[]
      : (() => { throw new Error('MCP args must be an array of strings') })()
  const env = stringRecord(input.env)
  return {
    type: 'stdio',
    command,
    ...(args ? { args } : {}),
    ...(env ? { env } : {}),
    ...(timeout ? { timeout } : {}),
    ...(alwaysLoad !== undefined ? { alwaysLoad } : {}),
  }
}

export function parseClaudeDynamicMcpServers(value: unknown): DynamicMcpServers {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('servers must be an object keyed by server name')
  const result: DynamicMcpServers = {}
  for (const [rawName, config] of Object.entries(value)) {
    const name = rawName.trim()
    if (!name || !/^[A-Za-z0-9._-]{1,80}$/.test(name)) throw new Error(`Invalid MCP server name: ${rawName}`)
    if (RESERVED_SERVER_NAMES.has(name)) throw new Error(`MCP server name is reserved by Agent Viewer: ${name}`)
    result[name] = parseServer(config)
  }
  return result
}

export function getClaudeDynamicMcpServers(sessionId: string): DynamicMcpServers {
  return { ...(bySession.get(sessionId) ?? {}) }
}

export function setClaudeDynamicMcpServers(sessionId: string, servers: DynamicMcpServers): void {
  if (Object.keys(servers).length === 0) bySession.delete(sessionId)
  else {
    bySession.delete(sessionId)
    bySession.set(sessionId, { ...servers })
    while (bySession.size > MAX_TRACKED_SESSIONS) {
      const oldest = bySession.keys().next().value
      if (oldest === undefined) break
      bySession.delete(oldest)
    }
  }
}

export function clearClaudeDynamicMcpServers(sessionId: string): void {
  bySession.delete(sessionId)
}

export function claudeDynamicMcpServerNames(sessionId: string): string[] {
  return Object.keys(bySession.get(sessionId) ?? {}).sort()
}
