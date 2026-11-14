// The one call every provider's approval bridge makes before asking a person.
// It fills in the provider instance from the running-turn registry, maps a
// tool name to a coarse kind, and never throws: any failure means "ask".
import type { AgentProvider } from '../types'
import type { PluginPermissionRequest } from './behavior'

export type PluginPermissionDecision = { pluginId: string; decision: 'allow' | 'deny'; reason?: string }

const COMMAND_TOOLS = /^(bash|shell|run_shell_command|execute|exec|command|terminal|local_shell)$/i
const FILE_TOOLS = /^(edit|write|multiedit|notebookedit|apply_patch|patch|str_replace|create|delete|file)/i
const NETWORK_TOOLS = /^(webfetch|websearch|fetch|http|browser)/i

export function permissionKind(toolName: string | undefined): PluginPermissionRequest['kind'] {
  if (!toolName) return 'other'
  if (COMMAND_TOOLS.test(toolName)) return 'command'
  if (FILE_TOOLS.test(toolName)) return 'file'
  if (NETWORK_TOOLS.test(toolName)) return 'network'
  return 'tool'
}

export async function askPluginsAboutPermission(
  provider: AgentProvider,
  sessionId: string,
  request: Omit<PluginPermissionRequest, 'kind'> & { kind?: PluginPermissionRequest['kind'] },
  signal?: AbortSignal,
): Promise<PluginPermissionDecision | null> {
  try {
    const { getRunningSession } = await import('../sessionRuntime')
    const running = getRunningSession(sessionId)
    const { decidePermissionByPlugins } = await import('./serverBehaviors')
    return await decidePermissionByPlugins(
      { provider: running?.provider ?? provider, sessionId, ...(running?.providerInstanceId ? { providerInstanceId: running.providerInstanceId } : {}) },
      { ...request, kind: request.kind ?? permissionKind(request.toolName) },
      signal,
    )
  } catch (error) {
    console.error('[plugins] permission hook unavailable:', error)
    return null
  }
}
