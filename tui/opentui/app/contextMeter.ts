import type { ClaudePlanLimits } from '../../../lib/claudePlanLimits'
import { stripLimitEntries, type StripStatEntry } from '../../../lib/sessionStripStats'
import type { ContextUsage } from '../../../lib/types'
import type { TuiThemePalette } from '../../theme'
import type { InlineTextSegment } from './inlineText'
import { fitText } from '../textLayout'

export function fmtTokens(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}
function renderContextBar(totalTokens: number, maxTokens: number, percentage: number, barWidth = 10): string {
  const filled = Math.round((percentage / 100) * barWidth)
  const bar = '▓'.repeat(filled) + '░'.repeat(barWidth - filled)
  return `${fmtTokens(totalTokens)} / ${fmtTokens(maxTokens)}  ${bar}  ${percentage}%`
}
// Segmented context gauge: the filled portion takes the threshold color (green →
// amber → red), the track stays dim, and the numbers read muted — so context
// pressure registers as a glanceable color, not a number you have to parse.
export function contextBarSegments(
  totalTokens: number,
  maxTokens: number,
  percentage: number,
  theme: TuiThemePalette,
  barWidth = 18): InlineTextSegment[] {
  const pct = Math.max(0, Math.min(100, Math.round(percentage)))
  const filled = Math.round((pct / 100) * barWidth)
  const fillColor = contextBarColor(pct, theme)
  return [
    { text: `${fmtTokens(totalTokens)}/${fmtTokens(maxTokens)}  `, fg: theme.muted },
    { text: '▕', fg: theme.dim },
    { text: '█'.repeat(filled), fg: fillColor },
    { text: '░'.repeat(barWidth - filled), fg: theme.dim },
    { text: '▏', fg: theme.dim },
    { text: ` ${pct}%`, fg: fillColor },
  ]
}
// The composer border's limit chip, coloured as it nears the limit; null with
// no reading, or when the reading's window has already reset.
export function planLimitSegments(limits: ClaudePlanLimits | null, theme: TuiThemePalette, now = Date.now()): InlineTextSegment[] {
  return stripLimitEntries(limits?.windows ?? [], now).map((entry) => stripEntrySegment(entry, theme))
}
export function stripEntrySegment({ tone, ...entry }: StripStatEntry, theme: TuiThemePalette): InlineTextSegment {
  return { ...entry, fg: tone === 'bad' ? theme.red : tone === 'warn' ? theme.amber : tone === 'good' ? theme.green : theme.dim }
}
export function formatContextUsageChip(usage: Pick<ContextUsage, 'totalTokens' | 'maxTokens' | 'percentage'>): string {
  const total = fmtTokens(usage.totalTokens)
  if (usage.maxTokens <= 0) return total
  const percentage = Number.isFinite(usage.percentage) ? Math.round(usage.percentage) : 0
  return `${total}/${fmtTokens(usage.maxTokens)} ${percentage}%`
}
export function formatLiveOutputTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}
export function formatTuiComposerIdleHint(baseHint: string, historyCount: number): string {
  const cleaned = baseHint
    .replace(/\s*·\s*(?:↑↓|⌃P\/⌃N|\^P\/\^N|\^R|⌃R)\s+(?:search\s+)?history(?:\s*\(\d+\))?/g, '')
    .trim()
  const withSettings = cleaned.replace('⏎ send', '⏎ send · ⌥M settings')
  const historyHint = historyCount > 0
    ? `⌃P/⌃N history (${historyCount})`
    : '⌃P/⌃N history'
  return `${withSettings} · ${historyHint}`
}
// Columns the composer dock's bottom border keeps for its own stats when it
// also carries the key hints.
// — less on a narrow dock, where the full reserve would leave the keys no room.
const FOOTER_DOCK_STATS_RESERVE = 24
export function footerDockStatsReserve(dockWidth: number): number {
  return Math.min(FOOTER_DOCK_STATS_RESERVE, Math.floor(dockWidth * 0.35))
}
export function contextBarColor(percentage: number, theme: TuiThemePalette): string {
  if (percentage >= 80) return theme.red
  if (percentage >= 60) return theme.amber
  return theme.green
}
// Composer hint rows are ' · '-joined key/label pairs (e.g. "⏎ send · ⇧⏎
// newline · ⌃O expand"). A plain char-slice truncation lands mid-key ("⌃…"),
// which reads as broken rather than cut off. Drop whole segments from the
// end instead so the ellipsis always follows a complete " · "-separated hint.
export function fitHintText(value: string, width: number): string {
  if (width <= 0) return ''
  if (value.length <= width) return value.padEnd(width, ' ')
  const segments = value.split(' · ')
  if (segments.length <= 1) return fitText(value, width)
  let kept = segments.length
  while (kept > 1) {
    const candidate = `${segments.slice(0, kept).join(' · ')} …`
    if (candidate.length <= width) return candidate.padEnd(width, ' ')
    kept -= 1
  }
  return fitText(value, width)
}
