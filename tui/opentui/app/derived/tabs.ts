/** @jsxImportSource @opentui/react */
import type { TeamAttention } from '../../teamAttentionStore'
import { tabStripName } from '../../tabStrip'
import { surfaceTitle } from '../../windowSurfaceNames'
import { type SurfaceMeta } from '../../popoverWindows'
import { formatSessionTitle } from '../../../format'
import { type Session } from '../../../../lib/types'
import { sessionKey } from '../sessionList'
import { sessionProviderLabel } from '../pickers'
import { DEFAULT_TAB_DISPLAY, type TabDisplay } from '../../../viewSpec'

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
      // tab-select draws a name in tabWidth - 2 cells from its second column,
      // so a label padded to tabWidth - 4 puts the × at TAB_CLOSE_COLUMN.
      // Only the selected tab carries it (tabCloseHit agrees).
      name: tabStripName(label, tabWidth, '', tabClosable(display, !shownPopoverTab && selectedSessionKey === sessionKey(s))),
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
  return { name: tabStripName(label, tabWidth, '', tabClosable(display, id === shownPopoverTab)), description: 'popover tab', value: `popover:${id}` }
}))
}
