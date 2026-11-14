import type { GitSummary } from '../../lib/gitProvider'
import type { ShellOverviewAction, ShellOverviewSnapshot } from '../../lib/plugins/shellOverview'

export const OMNI_ACTIONS: readonly { id: ShellOverviewAction; label: string }[] = [
  { id: 'repository', label: 'Open Git status' },
  { id: 'session', label: 'Focus selected transcript' },
  { id: 'attention', label: 'Open attention inbox' },
  { id: 'commands', label: 'Open command palette' },
]

export function elapsedLabel(startedAt: number | null, now: number): string {
  if (startedAt === null) return ''
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000))
  const minutes = Math.floor(seconds / 60)
  return minutes ? `${minutes}m ${seconds % 60}s` : `${seconds}s`
}

export function overviewSegments(snapshot: ShellOverviewSnapshot, git: GitSummary | null, width: number, now: number) {
  const project = snapshot.cwd.replace(/\\/g, '/').split('/').filter(Boolean).at(-1) || snapshot.cwd || 'Workspace'
  const attention = width < 60 ? `! ${snapshot.attentionCount}` : `${snapshot.runningCount} running · ${snapshot.attentionCount} needs input`
  const commands = width < 40 ? 'Cmds' : 'Commands…'
  const right = [
    { action: 'attention' as const, text: attention },
    { action: 'commands' as const, text: commands },
  ]
  if (width < 60) return right
  const repository = width >= 100 && git
    ? `${project} / ${git.branch} · ${git.modified + git.untracked} changed`
    : `${project}${git ? ` / ${git.branch}` : ''}`
  const elapsed = snapshot.running ? elapsedLabel(snapshot.startedAt, now) : ''
  return [
    { action: 'repository' as const, text: repository },
    ...(width >= 100 ? [{ action: 'session' as const, text: `${snapshot.running ? '● ' : ''}${snapshot.activity}${elapsed ? ` · ${elapsed}` : ''}` }] : []),
    ...right,
  ]
}
