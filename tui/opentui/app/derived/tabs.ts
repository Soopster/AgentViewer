/** @jsxImportSource @opentui/react */
import type { TeamAttention } from '../../teamAttentionStore'
import { tabStripName } from '../../tabStrip'
import { surfaceTitle } from '../../windowSurfaceNames'
import { type SurfaceMeta } from '../../popoverWindows'
import { formatSessionTitle } from '../../../format'
import { type Session } from '../../../../lib/types'
import { sessionKey } from '../sessionList'
import { sessionProviderLabel } from '../pickers'

export type TabOptionsContext = {
  visibleTabSessions: Session[]
  splitPinnedKeys: string[]
  splitPaneCount: number
  teamAttention: TeamAttention
  coordinatorBadges: Map<string, string>
  tabStateGlyphs: Map<string, string>
  isPreviewMode: boolean
  selectedSessionKey: string | null
  tabWidth: number
  popoverTabs: string[]
  windowSurfaceMeta: Record<string, SurfaceMeta>
  openTabByKey: Map<string, Session>
  sessions: Session[]
}

export function runTabOptions(ctx: TabOptionsContext) {
  const {
    visibleTabSessions, splitPinnedKeys, splitPaneCount, teamAttention, coordinatorBadges,
    tabStateGlyphs, isPreviewMode, selectedSessionKey, tabWidth, popoverTabs, windowSurfaceMeta,
    openTabByKey, sessions,
  } = ctx
return (
  visibleTabSessions.map((s) => {
    // Every open session can be on screen, so the strip marks none of them;
    // its description says which window shows it.
    const splitPosition = splitPinnedKeys.indexOf(sessionKey(s))
    const inSplit = splitPosition >= 0 && splitPosition < splitPaneCount
    // Herdr's rollup reaches the tab too. Leading, so a narrow tab's
    // truncation cuts the title rather than the mark.
    const team = teamAttention.get(sessionKey(s))
    const teamPrefix = (coordinatorBadges.has(sessionKey(s)) ? `${coordinatorBadges.get(sessionKey(s))} ` : '') + (team ? (team.waiting > 0 ? `!${team.waiting} ` : `✓${team.finished} `) : '')
    const stateGlyph = tabStateGlyphs.get(sessionKey(s))
    const label = (stateGlyph ? `${stateGlyph} ` : '') + teamPrefix + (isPreviewMode && selectedSessionKey === sessionKey(s)
      ? `PREVIEW · ${formatSessionTitle(s)}`
      : formatSessionTitle(s))
    return {
      // tab-select draws a name in tabWidth - 2 cells from its second column,
      // so a label padded to tabWidth - 4 puts the × at TAB_CLOSE_COLUMN.
      name: tabStripName(label, tabWidth),
      description: isPreviewMode && selectedSessionKey === sessionKey(s)
        ? 'Preview tab'
        : inSplit
          ? `in window ${splitPosition + 1}`
          : sessionProviderLabel(s),
      value: sessionKey(s),
    }
  })
).concat(popoverTabs.map((id) => {
  // Popover tabs follow the session tabs, each naming what it is pinned to.
  const pinned = windowSurfaceMeta[id]?.session
  const pinnedSession = pinned ? openTabByKey.get(pinned) ?? sessions.find((entry) => sessionKey(entry) === pinned) : null
  const label = `${surfaceTitle(id)}${pinnedSession ? ` · ${formatSessionTitle(pinnedSession)}` : ''}`
  return { name: tabStripName(label, tabWidth), description: 'popover tab', value: `popover:${id}` }
}))
}
