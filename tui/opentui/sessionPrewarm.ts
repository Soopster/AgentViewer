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
  // OpenCode's prewarm starts a server (~500MB) and Pi's loads its SDK into
  // this isolate beside the worker's copy (~130MB, plus ~1.2s of boot CPU) —
  // costs a browse-only session never needed. Both wait for the composer, as
  // Claude does. Pi's cold open measured 0.2-0.6s (2026-09), which typing
  // covers; pending Pi sessions still warm at once, below.
  if (!isPending && (resolvedProvider === 'opencode' || resolvedProvider === 'pi')) return composerActive
  if (!isPending) return resolvedProvider !== 'claude' || composerActive
  return resolvedProvider === 'pi'
    || resolvedProvider === 'claude'
    || resolvedProvider === 'claude-acp'
    || resolvedProvider === 'codex-acp'
}
