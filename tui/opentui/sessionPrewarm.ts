import type { AgentProvider } from '../../lib/types'

/**
 * Decide whether selecting a session may warm its provider runtime.
 *
 * Existing Claude sessions are the important exception: resuming the SDK
 * query rewrites the transcript even before a turn is sent, moving the file
 * mtime that both Agent Viewer and `claude --resume` use as last activity.
 * Merely reading a transcript must stay read-only, so wait until the user
 * engages the composer. Pending Claude sessions have no transcript to touch
 * and still benefit from adopting their reserved id before the first send.
 */
export function shouldPrewarmTuiRuntime(
  provider: AgentProvider | undefined,
  isPending: boolean,
  composerActive: boolean,
): boolean {
  const resolvedProvider = provider ?? 'claude'
  if (!isPending) return resolvedProvider !== 'claude' || composerActive
  return resolvedProvider === 'pi'
    || resolvedProvider === 'claude'
    || resolvedProvider === 'claude-acp'
    || resolvedProvider === 'codex-acp'
}
