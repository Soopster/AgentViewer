/** @jsxImportSource @opentui/react */
import type { CliRenderer } from '@opentui/core'
import { useMemo, useRef } from 'react'
import { getThemePalette, type TuiDensity, type TuiThemeMode } from '../../../theme'
import { type Session } from '../../../../lib/types'
import { resolveSelectedSessionIndex } from '../../splitPaneState'
import { type PaneFocus } from '../types'
import { sessionKey } from '../sessionList'
import { buildComposerSyntaxStyle, densityConfig } from '../transcriptStyle'

export type UseThemeGroupContext = {
  themeMode: TuiThemeMode
  terminalPaletteEpoch: number
  renderer: CliRenderer
  density: TuiDensity
  focusMode: boolean
  fullscreenMode: boolean
  railVisible: boolean
  focusedPane: PaneFocus
  selectedSessionKey: string | null
  sessions: Session[]
}

export function useThemeGroup(ctx: UseThemeGroupContext) {
  const {
    themeMode, terminalPaletteEpoch, renderer, density, focusMode, fullscreenMode, railVisible,
    focusedPane, selectedSessionKey, sessions,
  } = ctx

  // The epoch is what changes the terminal theme's colours.
  const theme = useMemo(() => getThemePalette(themeMode), [themeMode, terminalPaletteEpoch])
  const composerSyntaxStyle = useMemo(() => buildComposerSyntaxStyle(theme, renderer.nativeScene), [theme, renderer])
  const densityState = useMemo(() => densityConfig(density), [density])
  const presentationFocusMode = focusMode || fullscreenMode
  const showRail = railVisible && !fullscreenMode
  const effectiveFocus: PaneFocus = showRail ? focusedPane : 'messages'
  const selectedIndex = useMemo(
    () => resolveSelectedSessionIndex(selectedSessionKey, sessions, sessionKey),
    [selectedSessionKey, sessions],
  )
  // Latest sessions list keyed for ref-time lookups. refreshSelectedSessionDetail
  // receives identity-stable SKELETON sessions ({sessionId, provider} — see
  // selectedSessionTarget), so it must resolve list-level metadata like
  // transcript update time here; reading it off the passed session disabled the
  // mtime guards (typeof undefined !== 'number') and made every 2s poll and
  // every scrub settle re-read the full session file.
  const sessionsByKeyRef = useRef(new Map<string, Session>())

  return {
    theme, composerSyntaxStyle, densityState, presentationFocusMode, showRail, effectiveFocus,
    selectedIndex, sessionsByKeyRef,
  }
}
