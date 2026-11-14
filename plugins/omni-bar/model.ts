import type { GitSummary } from '../../lib/gitProvider'
import type { PluginShellOverview, ShellOverviewAction, ShellOverviewSnapshot } from '../../lib/plugins/shellOverview'

export type OmniAction = ShellOverviewAction | 'files' | 'processes' | 'index-search'
export const OMNI_ACTIONS: readonly { id: OmniAction; label: string }[] = [
  { id: 'repository', label: 'Open Git status' },
  { id: 'session', label: 'Focus selected transcript' },
  { id: 'attention', label: 'Open attention inbox' },
  { id: 'commands', label: 'Open command palette' },
  { id: 'new-session', label: 'New session' },
  { id: 'files', label: 'Browse project files' },
  { id: 'processes', label: 'Open terminal and processes' },
  { id: 'index-search', label: 'Search session history' },
]

export function availableActions(overview: PluginShellOverview) {
  return OMNI_ACTIONS.filter(action => {
    if (action.id === 'session') return Boolean(overview.snapshot.sessionKey)
    return !['files', 'processes', 'index-search'].includes(action.id) || overview.commands?.ids.includes(action.id)
  })
}

export function runOmniAction(overview: PluginShellOverview, action: OmniAction) {
  if (action === 'files' || action === 'processes' || action === 'index-search') {
    if (overview.commands?.ids.includes(action)) overview.commands.run(action)
  } else overview.run(action)
}

export function elapsedLabel(startedAt: number | null, now: number): string {
  if (startedAt === null) return ''
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000))
  const minutes = Math.floor(seconds / 60)
  return minutes ? `${minutes}m ${seconds % 60}s` : `${seconds}s`
}

export type OmniSegment = { action: OmniAction; text: string }
export function overviewSegments(snapshot: ShellOverviewSnapshot, git: GitSummary | null, width: number, now: number, commands: readonly string[] = []): OmniSegment[] {
  const project = snapshot.cwd.replace(/\\/g, '/').split('/').filter(Boolean).at(-1) || snapshot.cwd || 'Workspace'
  const attention = width < 60 ? `! ${snapshot.attentionCount}` : `${snapshot.runningCount} running · ${snapshot.attentionCount} needs input`
  const right: OmniSegment[] = [
    { action: 'attention', text: attention },
    { action: 'commands', text: width < 40 ? 'Cmds' : 'Commands…' },
  ]
  if (width < 60) return right
  const changes = git ? git.modified + git.untracked : 0
  const repository = width >= 100 && git
    ? `${project} / ${git.branch} · ${changes ? `${changes} changed` : 'clean'}${git.stashes ? ` · ${git.stashes} stashed` : ''}`
    : `${project}${git ? ` / ${git.branch}` : ''}`
  const elapsed = snapshot.running ? elapsedLabel(snapshot.startedAt, now) : ''
  const context: OmniSegment[] = [
    { action: 'repository', text: repository },
    ...(width >= 100 ? [{ action: 'session' as const, text: [snapshot.provider, snapshot.sessionTitle, `${snapshot.running ? '● ' : ''}${snapshot.activity}`, elapsed].filter(Boolean).join(' · ') }] : []),
  ]
  const shortcuts: OmniSegment[] = [{ action: 'new-session', text: '+ New' }]
  if (commands.includes('files')) shortcuts.push({ action: 'files', text: 'Files' })
  if (commands.includes('processes')) shortcuts.push({ action: 'processes', text: 'Terminal' })
  if (commands.includes('index-search')) shortcuts.push({ action: 'index-search', text: 'Search' })
  let budget = width - right.reduce((sum, segment) => sum + segment.text.length + 2, 0) - 64
  for (const shortcut of shortcuts) {
    const cells = shortcut.text.length + 2
    if (budget < cells) break
    context.push(shortcut)
    budget -= cells
  }
  return [...context, ...right]
}
