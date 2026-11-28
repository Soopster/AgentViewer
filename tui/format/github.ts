// A call that did something on GitHub or to git history, as terminal card lines:
// what happened first, then what it touched. URLs are printed whole on their own
// line so the transcript's link detection makes them clickable. Shared by both
// TUIs; the parsing is lib/github/activity.ts, the same one the Web uses.
import { detectGithubActivities, describeGithubActivity, type GithubActivity, type GithubCheckRow } from '../../lib/github/activity'
import { scrubGithubText } from '../../lib/github/text'
import type { ToolThread } from '../../lib/threading'
import type { TuiTranscriptCardLine, TuiTranscriptLineTone } from './types'

const PREVIEW_CHECKS = 4
const PREVIEW_ROWS = 4
const MAX_ACTIVITIES = 6

const CHECK_GLYPHS: Record<GithubCheckRow['state'], [string, TuiTranscriptLineTone]> = {
  failure: ['✗', 'result_error'], pending: ['●', 'system'], success: ['✓', 'result_ok'], neutral: ['○', 'dim'],
}
const CHECK_ORDER: GithubCheckRow['state'][] = ['failure', 'pending', 'success', 'neutral']

const compact = (value: string, max = 160) => {
  const flat = value.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

function activityLines(activity: GithubActivity, expanded: boolean): TuiTranscriptCardLine[] {
  const tone: TuiTranscriptLineTone = activity.tone === 'danger' ? 'result_error' : activity.tone === 'success' ? 'result_ok' : activity.tone === 'warning' || activity.tone === 'merged' ? 'system' : 'muted'
  const glyph = activity.failed ? '✗' : activity.kind === 'commit' ? '◆' : activity.kind === 'push' ? '↑' : activity.tone === 'merged' ? '⑃' : '⑂'
  const lines: TuiTranscriptCardLine[] = [{ text: compact(`${glyph} ${describeGithubActivity(activity)}`), tone }]
  if (activity.facts.length) lines.push({ text: `  ${compact(activity.facts.join(' · '))}`, tone: 'dim' })
  if (activity.checks?.length) {
    // The preview shows only what needs attention; passing checks are already counted in the facts.
    const checks = [...activity.checks].sort((a, b) => CHECK_ORDER.indexOf(a.state) - CHECK_ORDER.indexOf(b.state))
    const shown = expanded ? checks : checks.filter(check => check.state === 'failure' || check.state === 'pending').slice(0, PREVIEW_CHECKS)
    for (const check of shown) {
      const [mark, checkTone] = CHECK_GLYPHS[check.state]
      lines.push({ text: `  ${mark} ${compact(check.name, 90)}${check.duration ? `  ${check.duration}` : ''}`, tone: checkTone })
      if (expanded && check.url && check.state === 'failure') lines.push({ text: `    ${check.url}`, tone: 'dim' })
    }
  }
  if (activity.rows?.length) {
    const shown = expanded ? activity.rows : activity.rows.slice(0, PREVIEW_ROWS)
    for (const row of shown) lines.push({ text: compact(`  ${row.number ? `#${row.number} ` : ''}${row.title}${row.meta ? ` — ${row.meta}` : ''}`), tone: 'muted' })
    if (activity.rows.length > shown.length) lines.push({ text: `  + ${activity.rows.length - shown.length} more`, tone: 'dim' })
  }
  if (expanded && activity.body) for (const line of activity.body.split('\n')) lines.push({ text: `  │ ${line}`, tone: 'muted' })
  if (activity.url) lines.push({ text: `  ${activity.url}`, tone: 'dim' })
  return lines
}

/** The card for a GitHub call, or null for every other call (and for one still running). */
export function formatGithubTool(thread: ToolThread, expanded: boolean, command: string | undefined, output: string): TuiTranscriptCardLine[] | null {
  if (!thread.result) return null
  const input = command === undefined ? thread.toolUse.input : { ...thread.toolUse.input, command }
  const activities = detectGithubActivities(thread.toolUse.name, input, output, !!thread.result.is_error)
  if (!activities.length) return null
  const lines: TuiTranscriptCardLine[] = [{ text: `tool GitHub: ${compact(activities.map(describeGithubActivity).join('; '), 120)}`, tone: 'tool' }]
  for (const activity of activities.slice(0, MAX_ACTIVITIES)) lines.push(...activityLines(activity, expanded))
  if (expanded) {
    if (command) lines.push({ text: `$ ${compact(command, 400)}`, tone: 'dim' })
    for (const line of scrubGithubText(output).split('\n')) if (line.trim()) lines.push({ text: line.replace(/\t/g, '  ').trimEnd().slice(0, 400), tone: 'muted' })
  }
  return lines
}
