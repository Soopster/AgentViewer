import type { Query } from '@anthropic-ai/claude-agent-sdk'
import { mcpAppHtml, mcpAppResourceUri } from './mcpArtifacts'

/** Read through the existing session's SDK connection, never an arbitrary URL. */
export async function readClaudeMcpApp(
  query: Pick<Query, 'mcpServerStatus' | 'readMcpResource'>,
  serverName: string,
  toolName: string,
): Promise<{ available: false } | { available: true; uri: string; html: string }> {
  if (!serverName || !toolName) throw new Error('serverName and toolName are required')
  const servers = await query.mcpServerStatus()
  const server = servers.find(item => item.name === serverName && item.status === 'connected')
  const tool = server?.tools?.find(item => item.name === toolName || item.name === `mcp__${serverName}__${toolName}`)
  const uri = mcpAppResourceUri(tool?._meta)
  if (!uri) return { available: false }
  const resource = await query.readMcpResource(serverName, uri)
  return { available: true, uri, html: mcpAppHtml(resource, uri) }
}
