import { getCodexClient } from './codexClient'
import { readCodexThreadWithFullTurns } from './codexThreads'
import { mcpAppHtml, mcpAppResourceUri } from './mcpArtifacts'
import type { CodexThread, CodexResponseFor, CodexRequestParams } from './codexProtocol'

// Resource provenance comes from native history, never from a browser-supplied URI.
export async function readCodexMcpApp(
  sessionId: string, serverName: string, toolName: string, originCallId: string,
  dependencies: {
    readThread: (id: string) => Promise<CodexThread>
    list: (params: CodexRequestParams<'mcpServerStatus/list'>) => Promise<CodexResponseFor<'mcpServerStatus/list'>>
    readResource: (params: CodexRequestParams<'mcpServer/resource/read'>) => Promise<CodexResponseFor<'mcpServer/resource/read'>>
  } = {
    readThread: readCodexThreadWithFullTurns,
    list: params => getCodexClient().request('mcpServerStatus/list', params),
    readResource: params => getCodexClient().request('mcpServer/resource/read', params),
  },
) {
  const thread = await dependencies.readThread(sessionId)
  const call = thread.turns.flatMap(turn => turn.items).find(item => item.id === originCallId)
  if (call?.type !== 'mcpToolCall' || call.server !== serverName || call.tool !== toolName) {
    throw new Error('The originating MCP tool call was not found in this session.')
  }
  const validatedUri = (uri: string | undefined) => mcpAppResourceUri({ ui: { resourceUri: uri } })
  let uri = validatedUri(call.mcpAppUi?.resourceUri)
    ?? validatedUri(call.mcpAppResourceUri) ?? mcpAppResourceUri(call.result?._meta)
  if (!uri) {
    let cursor: string | null = null
    const seen = new Set<string>()
    do {
      const page: CodexResponseFor<'mcpServerStatus/list'> = await dependencies.list({
        threadId: sessionId, serverName, cursor, limit: 100,
      })
      const server = page.data.find(server => server.name === serverName)
      uri = mcpAppResourceUri(server?.tools[toolName]?._meta)
      if (uri || !page.nextCursor || seen.has(page.nextCursor)) break
      seen.add(page.nextCursor)
      cursor = page.nextCursor
    } while (cursor)
  }
  if (!uri) return { available: false as const }
  const resource = await dependencies.readResource({ threadId: sessionId, originCallId, server: call.server, uri })
  if (resource.originCallId != null && resource.originCallId !== originCallId) {
    throw new Error('The MCP App resource belongs to a different tool call.')
  }
  return { available: true as const, uri, html: mcpAppHtml(resource, uri),
    preferredModelDisplayMode: call.mcpAppUi?.preferredModelDisplayMode ?? 'inline' as const }
}
