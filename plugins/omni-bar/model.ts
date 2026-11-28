import { DEFAULT_OMNI_LAYOUT, omniGlyph, type OmniItemId, type OmniLayout } from './layout'
import type { GitSummary } from '../../lib/gitProvider'
import type { PluginShellOverview, ShellOverviewAction, ShellOverviewSnapshot } from '../../lib/plugins/shellOverview'

/** Plugin commands the bar can offer: command id, bar label, menu label. Each shows only while its plugin is enabled. */
export const OMNI_COMMAND_SHORTCUTS = [
  { id: 'files', text: 'Files', label: 'Browse project files' },
  { id: 'processes', text: 'Terminal', label: 'Open terminal and processes' },
  { id: 'index-search', text: 'Search', label: 'Search session history' },
  { id: 'editor', text: 'Editor', label: 'Open project editor' },
  { id: 'pull-requests', text: 'PRs', label: 'Review pull requests' },
  { id: 'github', text: 'GitHub', label: 'Open GitHub inbox, issues and actions' },
  { id: 'checkpoints', text: 'Checkpoints', label: 'Review turn checkpoints' },
  { id: 'analytics', text: 'Analytics', label: 'Open analytics' },
] as const
export type OmniCommandId = typeof OMNI_COMMAND_SHORTCUTS[number]['id']
const COMMAND_IDS: readonly string[] = [...OMNI_COMMAND_SHORTCUTS.map(shortcut => shortcut.id), 'omni-bar-settings']
const isCommandAction = (action: OmniAction): action is OmniCommandId | 'omni-bar-settings' => COMMAND_IDS.includes(action)

export type OmniAction = ShellOverviewAction | OmniCommandId | 'omni-bar-settings'
export const OMNI_ACTIONS: readonly { id: OmniAction; label: string }[] = [
  { id: 'repository', label: 'Open Git status' },
  { id: 'session', label: 'Focus selected transcript' },
  { id: 'attention', label: 'Open attention inbox' },
  { id: 'commands', label: 'Open command palette' },
  { id: 'new-session', label: 'New session' },
  ...OMNI_COMMAND_SHORTCUTS.map(({ id, label }) => ({ id, label })),
  { id: 'omni-bar-settings', label: 'Customize omni bar' },
]

export function availableActions(overview: PluginShellOverview) {
  return OMNI_ACTIONS.filter(action => {
    if (action.id === 'session') return Boolean(overview.snapshot.sessionKey)
    return !isCommandAction(action.id) || overview.commands?.ids.includes(action.id)
  })
}

export function runOmniAction(overview: PluginShellOverview, action: OmniAction) {
  if (isCommandAction(action)) {
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
export function overviewSegments(snapshot: ShellOverviewSnapshot, git: GitSummary | null, width: number, now: number, commands: readonly string[] = [], layout: OmniLayout = DEFAULT_OMNI_LAYOUT, glyph: (id: OmniItemId | 'commands') => string = omniGlyph): OmniSegment[] {
  const project = snapshot.cwd.replace(/\\/g, '/').split('/').filter(Boolean).at(-1) || snapshot.cwd || 'Workspace'
  const enabled = layout.filter(item => item.enabled).map(item => item.id)
  // "0 running · 0 needs input" under a warning icon asks for attention nothing needs.
  const quiet = snapshot.runningCount === 0 && snapshot.attentionCount === 0
  const attention: OmniSegment = {
    action: 'attention',
    text: `${glyph('attention')}${width < 60 ? snapshot.attentionCount : ' ' + `${snapshot.runningCount} running · ${snapshot.attentionCount} needs input`}`,
  }
  // Command access is the way back to everything else: always present, always last.
  const commandsSegment: OmniSegment = { action: 'commands', text: `${glyph('commands')} ${width < 40 ? 'Cmds' : 'Commands…'}` }
  if (width < 60) return [...(!quiet && enabled.includes('attention') ? [attention] : []), commandsSegment]
  const changes = git ? git.modified + git.untracked : 0
  const repository = width >= 100 && git
    ? `${project} / ${git.branch} · ${changes ? `${changes} changed` : 'clean'}${git.stashes ? ` · ${git.stashes} stashed` : ''}`
    : `${project}${git ? ` / ${git.branch}` : ''}`
  const elapsed = snapshot.running ? elapsedLabel(snapshot.startedAt, now) : ''
  const label = (id: OmniCommandId) => OMNI_COMMAND_SHORTCUTS.find(shortcut => shortcut.id === id)!.text
  const candidate = (id: OmniItemId): OmniSegment | null => {
    if (id === 'repository') return { action: 'repository', text: `${glyph('repository')} ${repository}` }
    if (id === 'session') return width >= 100 ? { action: 'session', text: `${glyph('session')} ` + [snapshot.provider, snapshot.sessionTitle, `${snapshot.running ? '● ' : ''}${snapshot.activity}`, elapsed].filter(Boolean).join(' · ') } : null
    if (id === 'attention') return quiet ? null : attention
    if (id === 'new-session') return { action: 'new-session', text: `${glyph(id)} New` }
    return commands.includes(id) ? { action: id, text: `${glyph(id)} ${label(id)}` } : null
  }
  // Repository, activity, attention and commands are kept; shortcuts take what is left after those, in the user's order.
  let budget = width - (quiet ? 0 : attention.text.length) - commandsSegment.text.length - 4 - 90
  const out: OmniSegment[] = []
  for (const id of enabled) {
    const segment = candidate(id)
    if (!segment) continue
    if (id !== 'repository' && id !== 'session' && id !== 'attention') {
      const cells = segment.text.length + 2
      if (budget < cells) continue
      budget -= cells
    }
    out.push(segment)
  }
  return [...out, commandsSegment]
}
