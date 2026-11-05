/** @jsxImportSource @opentui/react */
import { useRef } from 'react'
import { type TuiDensity, type TuiThemeMode, type TuiTranscriptView } from '../../../theme'
import { type RunningSessionRef, type Session } from '../../../../lib/types'

export function useNavigationRefs() {
  const loadingDetailRef = useRef(false)
  // Single-flight coalescing for foreground detail loads. The threading worker
  // processes transcripts serially and can't cancel in-flight work, so firing a
  // load per settled session while scrubbing backs its queue up — opens start
  // fast then get progressively slower as the backlog grows. We run at most one
  // foreground load at a time and remember only the latest target requested
  // while it's busy; the in-flight load picks that up when it frees, skipping
  // every fly-by session in between.
  const foregroundLoadInFlightRef = useRef(false)
  const pendingForegroundLoadRef = useRef<Session | null>(null)
  // Open-path latency bookkeeping (metrics only — see noteTuiNavLatency).
  const navSelectStartRef = useRef<{ key: string; at: number } | null>(null)
  const navPaintedKeyRef = useRef<string | null>(null)
  const navDetailSetAtRef = useRef<{ key: string; at: number } | null>(null)
  const backgroundRefreshInFlightRef = useRef(new Set<string>())
  const sessionDetailMtimeRef = useRef(new Map<string, number>())
  const selectedSessionKeyRef = useRef<string | null>(null)
  const openTabSessionsRef = useRef<Session[]>([])
  const runningSessionsRef = useRef<RunningSessionRef[]>([])
  const tabsEnabledRef = useRef(true)
  const themeMenuOriginRef = useRef<TuiThemeMode | null>(null)
  const transcriptViewMenuOriginRef = useRef<TuiTranscriptView | null>(null)
  const currentThemeRef = useRef<TuiThemeMode>('light')
  const exitConfirmOpenRef = useRef(false)
  const exitInProgressRef = useRef(false)
  const densityRef = useRef<TuiDensity>('balanced')
  const showToolCallsRef = useRef(true)
  const transcriptDiffHoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Tracked for the detail-poll skip path (proposal 6): the 2s background
  // refresh fires startTransition work that can interleave with keystroke
  // handling during active typing or searching, causing visible stutter.
  const composerActiveRef = useRef(false)
  const composerDraftRef = useRef('')
  const searchModeRef = useRef(false)
  const sessionSearchModeRef = useRef(false)

  return {
    loadingDetailRef, foregroundLoadInFlightRef, pendingForegroundLoadRef, navSelectStartRef,
    navPaintedKeyRef, navDetailSetAtRef, backgroundRefreshInFlightRef, sessionDetailMtimeRef,
    selectedSessionKeyRef, openTabSessionsRef, runningSessionsRef, tabsEnabledRef,
    themeMenuOriginRef, transcriptViewMenuOriginRef, currentThemeRef, exitConfirmOpenRef,
    exitInProgressRef, densityRef, showToolCallsRef, transcriptDiffHoverTimeoutRef,
    composerActiveRef, composerDraftRef, searchModeRef, sessionSearchModeRef,
  }
}
