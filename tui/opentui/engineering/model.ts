import type { Session } from '../../../lib/types'
import type { TuiTranscriptCard } from '../../format'

export type EngineeringPreset = 'focus' | 'build' | 'review' | 'multi-agent'
export type InspectorTab = 'changes' | 'checks' | 'tasks' | 'context' | 'attention' | 'handoff'
export function engineeringSelectedFile<T extends { path: string }>(files: readonly T[], preferredPath: string | null): T | null {
  return files.find(file => file.path === preferredPath) ?? files[0] ?? null
}
export type EngineeringPreferences = {
  preset: EngineeringPreset
  inspector: InspectorTab
  inspectorOpen: boolean
  inspectorWidth: number
  sidebarWidth: number
  drawerOpen: boolean
  drawerRows: number
  fileListRows?: number
  /** The changes tab lists every change, or only the files this session edited. */
  changesScope?: 'all' | 'session'
  /** The inspector diff wraps long lines (z), or cuts them at the pane edge. */
  diffWrap?: boolean
  composerRows?: number
  query: string
  filter: 'repo' | 'all' | 'attention' | 'running' | 'pinned'
  pinned: string[]
  collapsed: string[]
}
export const ENGINEERING_DEFAULTS: EngineeringPreferences = {
  preset: 'build', inspector: 'changes', inspectorOpen: true, inspectorWidth: 48,
  sidebarWidth: 28, drawerOpen: false, drawerRows: 12, query: '', filter: 'repo', pinned: [], collapsed: [],
}
export function engineeringHeaderRows(width: number): number { return width >= 132 ? 1 : 2 }
export function engineeringGeometry(width: number, height: number, preferences: EngineeringPreferences) {
  const inspectorWidth = preferences.inspectorOpen && preferences.preset !== 'focus' && width >= 132
    ? Math.min(Math.max(32, preferences.inspectorWidth), Math.max(32, width - Math.max(24, preferences.sidebarWidth) - 48)) : 0
  const drawerRows = preferences.drawerOpen && preferences.preset !== 'focus' && height >= 32
    ? Math.min(Math.max(8, preferences.drawerRows), height - 20) : 0
  const headerRows = engineeringHeaderRows(width)
  return { inspectorWidth, drawerRows, headerRows, width: width - inspectorWidth, height: height - headerRows - drawerRows }
}
export function engineeringPreset(preferences: EngineeringPreferences, preset: EngineeringPreset): EngineeringPreferences {
  return { ...preferences, preset, inspectorOpen: preset !== 'focus',
    inspector: preset === 'review' ? 'changes' : preset === 'multi-agent' ? 'attention' : preferences.inspector,
    inspectorWidth: preset === 'review' ? 64 : 48, drawerOpen: false }
}
export function engineeringSessionTitle(session: Session): string {
  const candidates = [session.summary, session.firstPrompt].filter((value): value is string => Boolean(value?.trim()))
  return candidates.find(value => !/^\/(?:goal|clear)\b/.test(value.trim()))?.split('\n')[0] ?? candidates[0] ?? session.sessionId
}
/** A session belongs to the repository when it ran in it or below it. */
export function engineeringSessionInRepo(session: Session, root: string | null | undefined): boolean {
  if (!root) return true
  const cwd = session.cwd?.replace(/\/+$/, '')
  return !!cwd && (cwd === root || cwd.startsWith(`${root.replace(/\/+$/, '')}/`))
}
export function engineeringEvidence(cards: readonly TuiTranscriptCard[]) {
  return cards.filter(card => card.category === 'technical' && /\b(test|tests|check|tsc|build|smoke|lint)\b/i.test(card.searchText || card.compactSummary))
}
function repoRelative(path: string, root: string): string {
  const trimmed = root.replace(/\/+$/, '')
  return path.replace(/^\.\//, '').replace(`${trimmed}/`, '')
}
export function engineeringFileEvidence(cards: readonly TuiTranscriptCard[], path: string, root: string) {
  const normalized = path.replace(/^\.\//, '')
  return cards.filter(card => card.category === 'diff' && card.fileEdits?.some(edit => repoRelative(edit.path, root) === normalized))
}
/** Repository-relative paths the loaded transcript's own edits touched: "which of these changes are this session's". */
export function engineeringSessionFiles(cards: readonly TuiTranscriptCard[], root: string): Set<string> {
  const paths = new Set<string>()
  for (const card of cards) for (const edit of card.fileEdits ?? []) paths.add(repoRelative(edit.path, root))
  return paths
}

export function engineeringHandoff(input: { title: string; identity: string; cwd: string; branch?: string; cards: readonly TuiTranscriptCard[]; files: readonly { path: string }[]; checks: readonly string[]; attention: readonly string[] }) {
  const user = input.cards.find(card => card.role === 'user')
  const replies = input.cards.filter(card => card.role === 'assistant' && card.category === 'conversation').slice(-3)
  return [
    `# ${input.title}`, `Session: ${input.identity}`, `Workspace: ${input.cwd}`, `Branch: ${input.branch ?? 'unavailable'}`,
    '\n## Objective', user?.compactSummary ?? 'No objective recorded.',
    '\n## Recent responses and decisions (recorded excerpts)',
    ...replies.map(card => `[${card.key}] ${card.compactSummary}`),
    '\n## Repository changes', ...input.files.map(file => `- ${file.path}`),
    '\n## Verification', ...(input.checks.length ? input.checks : ['No application-recorded checks.']),
    ...engineeringEvidence(input.cards).slice(-5).map(card => `Transcript evidence [${card.key}]: ${card.compactSummary} (working state unknown)`),
    '\n## Unresolved attention', ...(input.attention.length ? input.attention : ['No attention items recorded.']),
  ].join('\n')
}
