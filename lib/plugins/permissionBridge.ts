import { currentProviderInstanceId } from '../providerInstances'
// The one call every provider's approval bridge makes before asking a person.
// It fills in the provider instance from the running-turn registry, maps a
// tool name to a coarse kind, and never throws: any failure means "ask".
import { hasResearchToolPolicy, isResearchSession, RESEARCH_FILE_TOOLS } from '../sessionResearchPolicy'
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
    const instance = currentProviderInstanceId(provider)
    let running = getRunningSession(sessionId, { provider, providerInstanceId: instance })
    if (!running && instance === provider) {
      // Some SDK event callbacks lose ambient instance context. A unique running
      // match is safe only for this provider; ambiguous native IDs stay unresolved.
      try { const unique = getRunningSession(sessionId); if (unique?.provider === provider) running = unique } catch { return null /* ambiguous instance: ask instead of guessing */ }
    }
    let researchAllows = false
    if (hasResearchToolPolicy(provider, sessionId) || (running?.provider === provider && isResearchSession({ provider, sessionId, providerInstanceId: running.providerInstanceId }))) {
      const tool = request.toolName?.toLowerCase() ?? ''
      const read = (RESEARCH_FILE_TOOLS as readonly string[]).includes(tool)
      // Codex runs these commands inside its enforced read-only, offline sandbox.
      const sandboxedCommand = provider === 'codex' && (request.kind === 'command' || COMMAND_TOOLS.test(tool))
      if (!read && !sandboxedCommand) return { pluginId: 'research', decision: 'deny', reason: 'Research sessions may only read and search; implementation tools are disabled.' }
      researchAllows = true
    }
    const { decidePermissionByPlugins, pluginBehaviorHost } = await import('./serverBehaviors')
    // Preserve research read auto-approval only when every plugin abstains.
    // A deny, ask, failure or cancellation must never fall through to this allow.
    if (researchAllows) return pluginBehaviorHost().permission({
      target: { provider, sessionId, providerInstanceId: running?.providerInstanceId ?? instance },
      request: { ...request, kind: request.kind ?? permissionKind(request.toolName) }, signal,
      fallbackAllow: { pluginId: 'research', reason: 'Research read-only tool' },
    })
    return await decidePermissionByPlugins(
      { provider, sessionId, providerInstanceId: running?.providerInstanceId ?? instance },
      { ...request, kind: request.kind ?? permissionKind(request.toolName) },
      signal,
    )
  } catch (error) {
    console.error('[plugins] permission hook unavailable:', error)
    return null
  }
}
