/** @jsxImportSource @opentui/react */
import React, { useState } from 'react'
import { TextAttributes } from '@opentui/core'
import type { TuiDensity, TuiThemePalette } from '../../theme'
import { fitText } from '../textLayout'
import { mixHexColor } from './transcriptStyle'

/** Shared navigation chrome for the standard and Engineering session rails. */
/** `+ New` at the right end of the Sessions / Coordinator row: a full-width block was the loudest thing in the
 * rail and took up to five rows for the action used least. */
/**
 * The rail's quiet colour, for chrome that should recede: date headers, counts, ages, chips at
 * their default, the inactive tab. Mixed from the theme's own text and surface rather than taken
 * from `dim`/`muted`, which some palettes (a terminal's own colours) fill with an accent — orange
 * there made every header and age look highlighted. Accent is left to focus and filtering.
 */
export function sidebarQuietColor(theme: TuiThemePalette): string {
  return mixHexColor(theme.text, theme.surface, 0.5) ?? theme.dim
}

export function SidebarNewSession({ theme, width, onPress }: { theme: TuiThemePalette; width: number; onPress: () => void }) {
  // Plain accent text, so it does not read as a third tab; it fills only under the pointer.
  const [hover, setHover] = useState(false)
  return <box id="sidebar-new-session" height={1} flexShrink={0} backgroundColor={hover ? mixHexColor(theme.cyan, theme.surface, 0.2) ?? theme.surface3 : undefined}
    onMouseOver={() => setHover(true)} onMouseOut={() => setHover(false)}
    onMouseDown={event => { if (event.button === 0) { event.stopPropagation(); onPress() } }}>
    <text fg={theme.cyan} attributes={hover ? TextAttributes.BOLD : 0} wrapMode="none" selectable={false}>{/* Narrow rails keep the tabs whole and the button to its glyph. */ width < 34 ? ' + ' : ' + New '}</text>
  </box>
}

/** The sort, painted into the rail's bottom border: clicking the SESSIONS title also toggles it, but nothing said so. */
export function SidebarSortToggle({ theme, width, sort, onPress }: { theme: TuiThemePalette; width: number; sort: 'project' | 'time'; onPress: () => void }) {
  const [hover, setHover] = useState(false)
  // A narrow rail keeps the glyph alone, leaving the right end to the count.
  const label = width < 40 ? ' ↕ ' : ` ↕ ${sort === 'project' ? 'by project' : 'recent'} `
  return <box id="sidebar-sort-toggle" position="absolute" bottom={-1} left={1} width={label.length} height={1} backgroundColor={theme.surface}
    onMouseOver={() => setHover(true)} onMouseOut={() => setHover(false)}
    onMouseDown={event => { if (event.button === 0) { event.stopPropagation(); onPress() } }}>
    <text fg={hover ? theme.cyan : sidebarQuietColor(theme)} wrapMode="none" selectable={false}>{label}</text>
  </box>
}

/** The bottom border's right end: how many sessions show (`58 of 59`) and, when filters hide some, why. A note
 *  that names a tag or activity filter ends in × and clears them on click; a bare hidden count is dimmer. */
export function SidebarStatus({ theme, count, note, onClearNote }: { theme: TuiThemePalette; count: string; note: string; onClearNote: () => void }) {
  const quiet = sidebarQuietColor(theme)
  const clearable = note.includes('×')
  return <box id="sidebar-status" position="absolute" bottom={-1} right={1} height={1} flexDirection="row" backgroundColor={theme.surface}>
    <text fg={quiet} wrapMode="none" selectable={false}>{` ${count}${note ? ' · ' : ' '}`}</text>
    {note ? <box id="sidebar-filter-note" height={1} flexShrink={0} onMouseDown={event => { if (event.button === 0 && clearable) { event.stopPropagation(); onClearNote() } }}>
      <text fg={clearable ? theme.cyan : mixHexColor(quiet, theme.surface, 0.7) ?? quiet} wrapMode="none" selectable={false}>{`${note} `}</text>
    </box> : null}
  </box>
}

export function SidebarHeading({ theme, width, text, prefixWidth, badge, accent, onPress }: {
  theme: TuiThemePalette; width: number; text: string; prefixWidth: number; badge: string; accent: string; onPress?: () => void
}) {
  return <box position="absolute" top={-1} left={1} width={Math.min(text.trimEnd().length + 2, width - 4)} height={1} paddingX={1}
    flexDirection="row" backgroundColor={theme.surface} overflow="hidden"
    onMouseDown={event => { if (event.button === 0 && onPress) { event.stopPropagation(); onPress() } }}>
    <text fg={theme.cyan} bg={theme.surface} wrapMode="none">{text.trimEnd()}</text>
    <box id="sidebar-provider-badge" position="absolute" top={0} left={prefixWidth + 1} width={badge.length} minWidth={badge.length} maxWidth={badge.length} height={1} overflow="hidden" backgroundColor={accent}>
      <text width={badge.length} minWidth={badge.length} maxWidth={badge.length} fg={theme.bg} attributes={TextAttributes.BOLD} wrapMode="none">{badge}</text>
    </box>
  </box>
}

export function SidebarGroupHeading({ id, label, count, width, dateGroup, inset = dateGroup ? 2 : 1, disclosure, first, afterHeading = false, selected = false, density, theme, onPress }: {
  id: string; label: string; count: number; width: number; dateGroup?: boolean
  /** Left padding. A date header sits a step inside its project; where dates are the top level (the
   *  Coordinator's runs) it sits at the edge. */
  inset?: number
  disclosure: string; first: boolean; afterHeading?: boolean; selected?: boolean
  density: TuiDensity; theme: TuiThemePalette; onPress?: () => void
}) {
  const countLabel = `${count}`
  const headingWidth = Math.max(width - inset - 1, 1)
  // Spacing steps up with density's opposite: dense leaves a blank row before a project only; balanced also
  // before a date header that follows sessions (not one directly under its project); comfortable rows already
  // end in a blank row, so a header there adds none.
  const labelWidth = Math.max(headingWidth - countLabel.length - 1, 1)
  const title = fitText(`${disclosure}${label}`, Math.max(labelWidth - 2, 1)).trimEnd()
  const rule = labelWidth - title.length > 1 ? ` ${'─'.repeat(labelWidth - title.length - 1)}` : ' '.repeat(Math.max(labelWidth - title.length, 0))
  const ruleColor = mixHexColor(sidebarQuietColor(theme), theme.surface, 0.55) ?? theme.border
  const gap = density === 'comfortable' || first ? 0 : !dateGroup ? 1 : density === 'balanced' && !afterHeading ? 1 : 0
  return <box id={id} paddingX={1} paddingLeft={inset} marginTop={gap}
    flexDirection="row" height={1} flexShrink={0} backgroundColor={selected ? theme.surface3 : theme.surface}
    onMouseDown={event => { if (event.button === 0 && onPress) { event.stopPropagation(); onPress() } }}>
    <text fg={selected || !dateGroup ? theme.text : sidebarQuietColor(theme)} attributes={dateGroup ? undefined : TextAttributes.BOLD} wrapMode="none" selectable={false}>
      {dateGroup ? fitText(`${disclosure}${label}`, labelWidth) : title}
    </text>
    {/* A project header is a section break: a rule runs from its name to its count, using no extra row. */}
    {dateGroup ? null : <text fg={ruleColor} wrapMode="none" selectable={false}>{rule}</text>}
    <text fg={sidebarQuietColor(theme)} wrapMode="none" selectable={false}>{` ${countLabel}`}</text>
  </box>
}
