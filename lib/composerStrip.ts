// How a view shapes the composer's status strip. Shared by the TUI dock, the
// View Studio preview and the web composer, so they cannot disagree.
import type { ViewSpec } from '../tui/viewSpec'

export type ComposerStripSpec = Pick<ViewSpec, 'stripBadge' | 'stripSeparator' | 'stripColor' | 'stripModel' | 'stripEffort'
  | 'stripContext' | 'stripCost' | 'stripFolder' | 'stripGit' | 'stripLabels' | 'stripContextStyle'
  | 'stripLimits' | 'stripPr' | 'stripTokens' | 'stripCache' | 'stripLines' | 'stripDuration'>

export type ComposerStripPart = 'model' | 'effort' | 'context' | 'limit' | 'cost' | 'folder' | 'branch' | 'git-count'
  | 'pr' | 'tokens' | 'cache' | 'lines' | 'duration'

export function stripShows(spec: ComposerStripSpec, segment: { part?: ComposerStripPart; urgent?: boolean; tightest?: boolean }): boolean {
  if (segment.urgent) return true
  switch (segment.part) {
    case 'model': return spec.stripModel
    case 'effort': return spec.stripEffort
    case 'context': return spec.stripContext
    case 'limit': return spec.stripLimits === 'all' || (spec.stripLimits === 'tightest' && segment.tightest === true)
    case 'pr': return spec.stripPr
    case 'tokens': return spec.stripTokens
    case 'cache': return spec.stripCache
    case 'lines': return spec.stripLines
    case 'duration': return spec.stripDuration
    case 'cost': return spec.stripCost
    case 'folder': return spec.stripFolder
    case 'branch': return spec.stripGit !== 'off'
    case 'git-count': return spec.stripGit === 'full'
    default: return true
  }
}

const SHORT_LABELS: Partial<Record<ComposerStripPart, [string, string]>> = {
  model: ['model:', 'm:'], effort: ['effort:', 'e:'], context: ['ctx:', 'c:'], cost: ['cost:', '$:'],
}

/** Five steps, rounded up so any use at all shows. */
export function stripContextBar(percent: number): string {
  const filled = Math.min(5, Math.max(0, Math.ceil(percent / 20)))
  return `${'▰'.repeat(filled)}${'▱'.repeat(5 - filled)} ${Math.round(percent)}%`
}

function stripText(spec: ComposerStripSpec, segment: { text: string; part?: ComposerStripPart; percent?: number }): string {
  let text = segment.text
  if (segment.part === 'context' && segment.percent !== undefined && spec.stripContextStyle !== 'default') {
    text = `ctx:${spec.stripContextStyle === 'bar' ? stripContextBar(segment.percent) : `${Math.round(segment.percent)}%`}`
  }
  const label = segment.part ? SHORT_LABELS[segment.part] : undefined
  if (!label || spec.stripLabels === 'full' || !text.startsWith(label[0])) return text
  const value = text.slice(label[0].length)
  // A bare "auto" would not say whether it is the model or the effort.
  if (spec.stripLabels === 'none') return value === 'auto' && segment.part === 'effort' ? 'effort:auto' : value
  return `${label[1]}${value}`
}

export type StripPalette = { muted: string; accent: string; bright: string }

/**
 * Drops hidden entries, rewrites their text and recolours the rest. Entries
 * without a `part` (modes and warnings) are left as they are.
 */
export function shapeStripSegments<T extends { text: string; fg: string; part?: ComposerStripPart; urgent?: boolean; percent?: number; tightest?: boolean }>(
  segments: T[], spec: ComposerStripSpec, palette: StripPalette,
): T[] {
  const colour = spec.stripColor === 'default' ? null : palette[spec.stripColor]
  return segments.filter(segment => stripShows(spec, segment))
    .map(segment => segment.part
      ? { ...segment, text: stripText(spec, segment), fg: colour && !segment.urgent ? colour : segment.fg }
      : segment)
}

/**
 * The strip's entries in the view's order. With the folder first, a permission
 * warning (the leading entry without a `part`) still leads: the border cuts off
 * whatever does not fit.
 */
export function orderStripGroups<T extends { part?: ComposerStripPart }>(order: ViewSpec['stripOrder'], settings: T[], location: T[]): [T[], T[], T[]] {
  if (order === 'settings') return [settings, location, []]
  const warnings = settings.findIndex(segment => segment.part !== undefined)
  const lead = warnings === -1 ? settings.length : warnings
  return [settings.slice(0, lead), location, settings.slice(lead)]
}

export function stripFolderLabel(cwd: string, style: ViewSpec['stripFolderStyle'], name: string): string {
  if (style === 'name') return name
  const parts = cwd.split(/[\\/]+/).filter(Boolean)
  return parts.length > 1 ? parts.slice(-2).join('/') : name
}

/** The readings a two-row strip moves to its second row. */
const STAT_PARTS: ReadonlySet<ComposerStripPart> = new Set<ComposerStripPart>(['limit', 'pr', 'tokens', 'cache', 'lines', 'duration'])
export function isStripStat(segment: { part?: ComposerStripPart }): boolean {
  return segment.part !== undefined && STAT_PARTS.has(segment.part)
}

/** Whether the view asks for any reading taken from the transcript, so it is only computed when shown. */
export function stripWantsStats(spec: Pick<ViewSpec, 'stripTokens' | 'stripCache' | 'stripLines' | 'stripDuration'>): boolean {
  return spec.stripTokens || spec.stripCache || spec.stripLines || spec.stripDuration
}

export function stripSeparatorText(separator: ViewSpec['stripSeparator']): string {
  return separator === 'space' ? '  ' : ` ${separator} `
}
