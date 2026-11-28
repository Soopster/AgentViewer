/** @jsxImportSource @opentui/react */
import type { TeamAttention } from '../../teamAttentionStore'
import { tabPaintWidth, tabStripName } from '../../tabStrip'
import { tuiIcon } from '../../icons'
import { surfaceTitle } from '../../windowSurfaceNames'
import { type SurfaceMeta } from '../../popoverWindows'
import { formatSessionTitle } from '../../../format'
import { type Session } from '../../../../lib/types'
import { sessionKey } from '../sessionList'
import { sessionProviderLabel } from '../pickers'
import { DEFAULT_TAB_DISPLAY, type TabDisplay } from '../../../viewSpec'
import { mixHexColor } from '../transcriptStyle'
import { getProviderAccent, type TuiThemePalette } from '../../../theme'

/**
 * The strip behind inactive tabs. `bg` alone read as a dark gutter cut into the
 * window area, since every frame and the rail are `surface`; `blend` keeps the
 * active tab a step above its neighbours without that band.
 */
export function tabStripColor(theme: TuiThemePalette, fill: TabDisplay['tabStripFill']): string {
  if (fill === 'surface') return theme.surface
  if (fill === 'bg') return theme.bg
  if (fill === 'raised') return mixHexColor(theme.surface2, theme.surface, 0.6) ?? theme.surface2
  if (fill === 'tinted') return mixHexColor(theme.cyan, theme.bg, 0.1) ?? theme.surface2
  if (fill === 'deep') return mixHexColor('#000000', theme.bg, isLightThemeColor(theme.bg) ? 0.06 : 0.3) ?? theme.bg
  return mixHexColor(theme.surface, theme.bg, 0.5) ?? theme.surface2
}

/**
 * The theme the session rail draws with: its `surface` replaced by the view's
 * `railFill`, so every row, heading and chip inside paints the same fill.
 * `surface` returns the theme itself, so memos keyed on it hold.
 */
export function railThemeFor(theme: TuiThemePalette, fill: TabDisplay['tabStripFill']): TuiThemePalette {
  if (fill === 'surface') return theme
  return { ...theme, surface: tabStripColor(theme, fill) }
}

const transcriptThemes = new WeakMap<TuiThemePalette, Map<TabDisplay['tabStripFill'], TuiThemePalette>>()

/** `railThemeFor` for transcript windows. Cached: panes and cards are memoized on the theme's identity. */
export function transcriptThemeFor(theme: TuiThemePalette, fill: TabDisplay['tabStripFill']): TuiThemePalette {
  let byFill = transcriptThemes.get(theme)
  if (!byFill) transcriptThemes.set(theme, byFill = new Map())
  let filled = byFill.get(fill)
  if (!filled) byFill.set(fill, filled = railThemeFor(theme, fill))
  return filled
}

/** An inactive tab under the pointer: most of the way from the strip to the active tab's surface, never a coloured tint. */
export function tabHoverColor(theme: TuiThemePalette, strip: string): string {
  if (strip === theme.surface) return mixHexColor(theme.surface2, strip, 0.7) ?? theme.surface2
  return mixHexColor(theme.surface, strip, 0.6) ?? theme.surface2
}

function isLightThemeColor(hex: string): boolean {
  const value = Number.parseInt(hex.replace('#', '').slice(0, 6), 16)
  if (!Number.isFinite(value)) return false
  return ((value >> 16 & 255) * 299 + (value >> 8 & 255) * 587 + (value & 255) * 114) / 1000 > 140
}

/** The colour a tab is drawn in under `tabAccent`: its provider's, or the theme's accent. */
export function tabAccentColor(theme: TuiThemePalette, display: TabDisplay, session: Session | null | undefined): string {
  return display.tabAccent !== 'off' && session?.provider ? getProviderAccent(session.provider) : theme.cyan
}

/** A session's tab title as the view asks for it: its title, its folder, or both. */
export function tabTitleText(session: Session, display: TabDisplay): string {
  const title = formatSessionTitle(session)
  const folder = session.cwd ? session.cwd.split(/[\\/]/).filter(Boolean).at(-1) ?? '' : ''
  if (display.tabTitle === 'folder') return folder || title
  if (display.tabTitle === 'folder-title' && folder) return `${folder} · ${title}`
  return title
}

function tabClosable(display: TabDisplay, selected: boolean): boolean {
  return display.tabClose === 'all' || (display.tabClose === 'active' && selected)
}

export type TabOptionsContext = {
  visibleTabSessions: Session[]
  splitPinnedKeys: string[]
  splitPaneCount: number
  teamAttention: TeamAttention
  coordinatorBadges: Map<string, string>
  tabStateGlyphs: Map<string, string>
  /** Pinned tabs, drawn with a leading mark (empty when the Tab manager plugin is off). */
  pinnedTabs?: ReadonlySet<string>
  isPreviewMode: boolean
  selectedSessionKey: string | null
  /** The popover tab shown in place of the selected session, which then owns the strip's selection. */
  shownPopoverTab?: string | null
  tabWidth: number
  popoverTabs: string[]
  windowSurfaceMeta: Record<string, SurfaceMeta>
  openTabByKey: Map<string, Session>
  sessions: Session[]
  /** How the view draws tabs (tui/viewSpec.ts); the defaults when omitted. */
  display?: TabDisplay
  /** Strip position of the first tab here, so numbers count the pinned row's tabs too. */
  numberOffset?: number
}

export function runTabOptions(ctx: TabOptionsContext) {
  const {
    visibleTabSessions, splitPinnedKeys, splitPaneCount, teamAttention, coordinatorBadges,
    tabStateGlyphs, isPreviewMode, selectedSessionKey, tabWidth, popoverTabs, windowSurfaceMeta,
    openTabByKey, sessions, pinnedTabs, shownPopoverTab = null, display = DEFAULT_TAB_DISPLAY, numberOffset = 0,
  } = ctx
  const number = (index: number) => display.tabNumbers ? `${numberOffset + index + 1} ` : ''
  const closeIcon = tuiIcon(display.iconSet, 'error', '×')
  const nameWidth = tabPaintWidth(display.tabStyle, tabWidth)
return (
  visibleTabSessions.map((s, index) => {
    // Every open session can be on screen, so the strip marks none of them;
    // its description says which window shows it.
    const splitPosition = splitPinnedKeys.indexOf(sessionKey(s))
    const inSplit = splitPosition >= 0 && splitPosition < splitPaneCount
    // Herdr's rollup reaches the tab too. Leading, so a narrow tab's
    // truncation cuts the title rather than the mark.
    const team = teamAttention.get(sessionKey(s))
    const teamPrefix = (coordinatorBadges.has(sessionKey(s)) ? `${coordinatorBadges.get(sessionKey(s))} ` : '') + (team ? (team.waiting > 0 ? `!${team.waiting} ` : `✓${team.finished} `) : '')
    const stateGlyph = tabStateGlyphs.get(sessionKey(s))
    const icons = display.tabIcons === 'none' ? ''
      : (display.tabIcons === 'provider' ? `${sessionProviderLabel(s).charAt(0).toUpperCase()} ` : '') + (stateGlyph ? `${stateGlyph} ` : '') + teamPrefix
    const title = tabTitleText(s, display)
    const label = number(index) + (pinnedTabs?.has(sessionKey(s)) ? '◆ ' : '') + icons + (isPreviewMode && selectedSessionKey === sessionKey(s)
      ? `PREVIEW · ${title}`
      : title)
    return {
      name: tabStripName(label, nameWidth, '', tabClosable(display, !shownPopoverTab && selectedSessionKey === sessionKey(s)), display.tabTruncate, closeIcon),
      description: isPreviewMode && selectedSessionKey === sessionKey(s)
        ? 'Preview tab'
        : inSplit
          ? `in window ${splitPosition + 1}`
          : sessionProviderLabel(s),
      value: sessionKey(s),
    }
  })
).concat(popoverTabs.map((id, popoverIndex) => {
  // Popover tabs follow the session tabs, each naming what it is pinned to.
  const pinned = windowSurfaceMeta[id]?.session
  const pinnedSession = pinned ? openTabByKey.get(pinned) ?? sessions.find((entry) => sessionKey(entry) === pinned) : null
  const label = `${number(visibleTabSessions.length + popoverIndex)}${surfaceTitle(id)}${pinnedSession ? ` · ${formatSessionTitle(pinnedSession)}` : ''}`
  return { name: tabStripName(label, nameWidth, '', tabClosable(display, id === shownPopoverTab), display.tabTruncate, closeIcon), description: 'popover tab', value: `popover:${id}` }
}))
}
