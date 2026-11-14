// Restoring a checkpoint for a session: the files, then the provider's own
// notion of them (Claude's file-history), so a later turn does not "remember"
// edits that are no longer on disk. Shared by the TUI service and the Web route.
import { restoreCheckpoint } from './checkpoints'
import { isAgentProvider } from './provider'
import { getProviderManifest } from './extensions/providers/catalog'
import { withSessionInstance } from './sessionInstances'

export async function restoreCheckpointForSession(
  cwd: string,
  sha: string,
  paths?: string[],
  context?: { sessionId?: string; provider?: string; providerInstanceId?: string },
): Promise<{ restored: number; deleted: number }> {
  const result = await restoreCheckpoint(cwd, sha, paths)
  if (context?.sessionId && isAgentProvider(context.provider) && getProviderManifest(context.provider).fileRestoreHook) {
    const provider = context.provider
    const sessionId = context.sessionId
    const { currentProviderInstanceId, withProviderInstance } = await import('./providerInstances')
    const run = async () => {
      const runtime = await (await import('./extensions/providers/registry')).getProviderRuntime(provider)
      await runtime.afterFileRestore?.({ sessionId, cwd, paths, provider, providerInstanceId: currentProviderInstanceId(provider) })
    }
    if (context.providerInstanceId) await withProviderInstance(context.providerInstanceId, provider, run)
    else await withSessionInstance(provider, sessionId, run)
  }
  return result
}
