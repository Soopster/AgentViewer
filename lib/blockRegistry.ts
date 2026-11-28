// Plugin-defined transcript blocks. The built-in blocks (system reminders, bash
// output, coordinator mail …) are recognised by regions in lib/threading.ts; a
// plugin adds its own by registering a parser that finds regions in message
// text and answers with a card (the same data a tool card uses), which every
// renderer already draws: the Web, the terminal and the HTML export. A block
// is data, so the union stays closed: one `plugin_block` type, told apart by
// `kind`, and a kind nobody can draw falls back to its source text.
import type { PluginToolCard } from './types'

export type PluginBlock = {
  type: 'plugin_block'
  /** The parser's own name for what this block is (`<plugin>.<kind>`). */
  kind: string
  card: PluginToolCard
  /** The text the region came from, shown when nothing can draw the card. */
  text: string
}

export type PluginBlockRegion = { start: number; end: number; kind: string; card: PluginToolCard }
export type BlockRegionParser = {
  /** Stable; a second registration with the same id replaces the first. */
  readonly id: string
  /** Regions of `text` this parser claims. Must be pure and cheap: it runs on every text block of every transcript read. */
  find(text: string): readonly PluginBlockRegion[]
}

const parsers = new Map<string, BlockRegionParser>()
let version = 0

export function registerBlockParser(parser: BlockRegionParser): () => void {
  parsers.set(parser.id, parser)
  version++
  return () => {
    if (parsers.get(parser.id) === parser) { parsers.delete(parser.id); version++ }
  }
}

/** Changes whenever parsers change, so a cache of threaded transcripts can tell it is stale. */
export function blockParsersVersion(): number { return version }

/** Every plugin region in `text`, a parser that throws or answers badly contributing none. */
export function findPluginBlockRegions(text: string): PluginBlockRegion[] {
  if (!parsers.size) return []
  const regions: PluginBlockRegion[] = []
  for (const parser of parsers.values()) {
    try {
      for (const region of parser.find(text)) {
        if (Number.isInteger(region.start) && Number.isInteger(region.end) && region.start >= 0 && region.end > region.start && region.end <= text.length
          && typeof region.kind === 'string' && region.card && typeof region.card.title === 'string' && Array.isArray(region.card.lines)) regions.push(region)
      }
    } catch { /* a faulty parser must not blank a transcript */ }
  }
  return regions
}

const MAX_PATTERN_CHARS = 200
const MAX_TEXT_CHARS = 200_000
const MAX_MATCHES = 50
const SAFE_FLAGS = /^[imsu]*$/

/** Why a pattern spec is refused, or null. Patterns run on every transcript read, so they are bounded. */
export function blockPatternProblem(spec: { pattern: string; flags?: string }): string | null {
  if (typeof spec.pattern !== 'string' || !spec.pattern || spec.pattern.length > MAX_PATTERN_CHARS) return `pattern must be 1-${MAX_PATTERN_CHARS} characters`
  if (spec.flags !== undefined && !SAFE_FLAGS.test(spec.flags)) return 'flags may only be i, m, s or u'
  // A quantified group that is itself quantified is the classic runaway shape.
  if (/\([^)]*[+*][^)]*\)[+*{]/.test(spec.pattern)) return 'nested quantifiers are not allowed'
  try { new RegExp(spec.pattern, `g${spec.flags ?? ''}`) } catch (error) { return error instanceof Error ? error.message : 'invalid pattern' }
  return null
}

const fill = (template: string, match: RegExpMatchArray) => template.replace(/\{(\d{1,2})\}/g, (_all, index) => match[Number(index)] ?? '')

/** A parser for a declarative pattern spec: the card is the spec's title and lines with the match filled in. */
export function patternBlockParser(id: string, spec: { kind: string; pattern: string; flags?: string; title: string; lines?: readonly string[]; tone?: PluginToolCard['tone'] }, pluginId: string): BlockRegionParser | null {
  if (blockPatternProblem(spec)) return null
  const regex = new RegExp(spec.pattern, `g${spec.flags ?? ''}`)
  return {
    id,
    find(text) {
      if (text.length > MAX_TEXT_CHARS) return []
      const regions: PluginBlockRegion[] = []
      for (const match of text.matchAll(regex)) {
        if (!match[0] || match.index === undefined) continue
        regions.push({ start: match.index, end: match.index + match[0].length, kind: id, card: { pluginId, title: fill(spec.title, match).slice(0, 120), lines: (spec.lines ?? []).map(template => fill(template, match).slice(0, 500)), tone: spec.tone ?? 'info' } })
        if (regions.length >= MAX_MATCHES) break
      }
      return regions
    },
  }
}
