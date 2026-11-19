import type { ChiefOfStaffState } from '../../lib/chiefOfStaff/service'
import type { CosRule } from '../../lib/chiefOfStaff/rules'

export type PanelLine = { text: string; tone: 'text' | 'dim' | 'bad'; /** Position in `ruleList` for a routing rule's row. */ rule?: number }
export type PanelSection = { id: 'needs' | 'work' | 'rules' | 'report'; title: string; lines: PanelLine[] }

/** What both renderers show, in order: needs-you first, then the board, then the rules and their problems. */
export function panelSections(state: ChiefOfStaffState): PanelSection[] {
  const sections: PanelSection[] = []
  const { board } = state
  if (board?.needsYou.length) sections.push({ id: 'needs', title: 'NEEDS YOU', lines: board.needsYou.map(text => ({ text, tone: 'bad' as const })) })
  sections.push({
    id: 'work',
    title: 'WORKSTREAMS',
    lines: !state.session ? [{ text: 'Type a request and press Enter to start one.', tone: 'dim' }]
      : board?.workstreams.length ? board.workstreams.map(item => ({ text: `${item.title} · ${item.status}${item.owner ? ` · ${item.owner}${item.provider ? ` (${item.provider})` : ''}` : ''}`, tone: 'text' as const }))
      : [{ text: 'Nothing open.', tone: 'dim' }],
  })
  sections.push({
    id: 'rules',
    title: `ROUTING RULES (${state.ruleList.length})`,
    lines: [
      ...state.ruleList.map((rule, index) => ({ rule: index, text: `${rule.match} → ${rule.provider}${rule.model ? ` ${rule.model}` : ''}${rule.effort ? ` · ${rule.effort}` : ''}`, tone: 'text' as const })),
      ...(state.ruleList.length === 0 && state.problems.length === 0 ? [{ text: 'None yet. Press Tab, then a to add one.', tone: 'dim' as const }] : []),
      ...state.problems.map(problem => ({ text: `✗ ${problem.rule ? `#${problem.rule} ` : ''}${problem.message}`, tone: 'bad' as const })),
    ],
  })
  if (state.report) sections.push({ id: 'report', title: `LATEST REPORT · ${new Date(state.report.at).toLocaleString()}`, lines: reportLines(state.report.text) })
  return sections
}

export const REPORT_MAX_LINES = 12

/** The latest reply, as many lines as the panel gives it; a longer one says so rather than looking complete. */
export function reportLines(text: string): PanelLine[] {
  const lines = text.split('\n').map(line => line.trimEnd()).filter(line => line.trim())
  const shown = lines.slice(0, REPORT_MAX_LINES).map(line => ({ text: line, tone: 'text' as const }))
  return lines.length > REPORT_MAX_LINES ? [...shown, { text: `… ${lines.length - REPORT_MAX_LINES} more lines in the chat`, tone: 'dim' }] : shown
}

/** A rule as one editable line: match | provider[:instance] | model | effort | role | no-worktree */
export function formatRuleLine(rule: CosRule): string {
  const provider = rule.instance ? `${rule.provider}:${rule.instance}` : rule.provider
  const fields = [rule.match, provider, rule.model ?? '', rule.effort ?? '', rule.role ?? '']
  while (fields.length > 2 && !fields[fields.length - 1]) fields.pop()
  return [...fields, ...(rule.worktree === false ? ['no-worktree'] : [])].join(' | ')
}

export function parseRuleLine(line: string): { rule: CosRule } | { error: string } {
  const parts = line.split('|').map(part => part.trim())
  const noWorktree = parts.length > 2 && parts[parts.length - 1] === 'no-worktree'
  if (noWorktree) parts.pop()
  const [match, providerField, model, effort, role] = parts
  if (!match) return { error: 'Start with what kind of work it is for: match | provider | model | effort | role' }
  if (!providerField) return { error: 'Add a provider after the match, like: frontend | claude' }
  const [provider, instance] = providerField.split(':')
  return { rule: { match, provider, ...(instance ? { instance } : {}), ...(model ? { model } : {}), ...(effort ? { effort } : {}), ...(role ? { role } : {}), ...(noWorktree ? { worktree: false } : {}) } }
}
