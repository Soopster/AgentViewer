import { TextAttributes } from '@opentui/core'
import type { AnsiRun } from '../../../lib/ansiOutput'
import type { TuiThemePalette } from '../../theme'
import type { InlineTextSegment } from './inlineText'

const PALETTE_NAME = /^var\(--hls-terminal-ansi-([a-z-]+)\)$/

/** The theme colour for an ANSI palette name. The theme has no blue or yellow, so
 *  blue takes violet, yellow takes amber, magenta takes pink; bright variants share
 *  their hue and black/white map to the dim and text tones. */
function paletteColor(name: string, theme: TuiThemePalette): string {
  switch (name.replace(/^bright-/, '')) {
    case 'red': return theme.red
    case 'green': return theme.green
    case 'yellow': return theme.amber
    case 'blue': return theme.violet
    case 'magenta': return theme.pink
    case 'cyan': return theme.cyan
    case 'black': return name === 'bright-black' ? theme.muted : theme.dim
    default: return theme.text
  }
}

function resolveColor(color: string | undefined, theme: TuiThemePalette): string | undefined {
  if (!color) return undefined
  const named = PALETTE_NAME.exec(color)
  if (named) return paletteColor(named[1]!, theme)
  return color.startsWith('#') ? color : undefined
}

/** A coloured tool-output line as drawable segments in the current theme. */
export function ansiRunSegments(runs: readonly AnsiRun[], theme: TuiThemePalette): InlineTextSegment[] {
  return runs.map(run => {
    let attributes = 0
    if (run.bold) attributes |= TextAttributes.BOLD
    if (run.italic) attributes |= TextAttributes.ITALIC
    if (run.underline) attributes |= TextAttributes.UNDERLINE
    if (run.strike) attributes |= TextAttributes.STRIKETHROUGH
    const segment: InlineTextSegment = { text: run.text.replace(/\t/g, '  '), fg: resolveColor(run.color, theme) ?? theme.text }
    const bg = resolveColor(run.background, theme)
    if (bg) segment.bg = bg
    if (attributes) segment.attributes = attributes
    return segment
  })
}
