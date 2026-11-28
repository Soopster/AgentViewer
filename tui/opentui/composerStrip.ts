// The composer's bottom strip as the terminal draws it; the shaping rules are shared with the web.
import { TextAttributes } from '@opentui/core'
import type { ViewSpec } from '../viewSpec'
import type { InlineTextSegment } from './app/inlineText'
import { stripSeparatorText } from '../../lib/composerStrip'

export { isStripStat, orderStripGroups, shapeStripSegments, stripFolderLabel, stripSeparatorText } from '../../lib/composerStrip'

/** The provider chip, or null when the view hides it. */
export function stripBadgeSegment(style: ViewSpec['stripBadge'], label: string, accent: string, onAccent: string): InlineTextSegment | null {
  if (style === 'off') return null
  const name = label.toUpperCase()
  if (style === 'filled') return { text: ` ${name} `, fg: onAccent, bg: accent, attributes: TextAttributes.BOLD }
  return { text: style === 'brackets' ? `[${name}]` : style === 'dot' ? `● ${name}` : name, fg: accent, attributes: TextAttributes.BOLD }
}

export function joinStripSegments(segments: InlineTextSegment[], separator: ViewSpec['stripSeparator'], dim: string): InlineTextSegment[] {
  return segments.flatMap((segment, index) => index ? [{ text: stripSeparatorText(separator), fg: dim }, segment] : [segment])
}
