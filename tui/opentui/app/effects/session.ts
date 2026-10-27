/** @jsxImportSource @opentui/react */
import type { RefObject } from 'react'
import { tabStripActivity } from '../../tabStrip'
import React from 'react'
import { type TabSelectOption, type TabSelectRenderable } from '@opentui/core'
import { TAB_SPINNER_FRAMES, TAB_SPINNER_INTERVAL_MS } from '../chrome'
import { type Dispatch, type SetStateAction } from 'react'
import { type TranscriptIndexLookup } from '../transcriptIndex'
import { type OpenCodeTodo } from '../../../../lib/taskRegistry'
import { type TuiTranscriptCard } from '../../../format'
import { type TuiSessionReaderState } from '../../../../lib/tuiState'
import { sessionKey } from '../sessionList'
import { keepEmpty } from '../collections'

export type OptionsEffectContext = {
  tabSelectRef: React.RefObject<TabSelectRenderable | null>
  runningTabKeys: Set<string>
  tabOptions: TabSelectOption[]
  tabWidth: number
}

export function runOptionsEffect(ctx: OptionsEffectContext) {
  const {
    tabSelectRef, runningTabKeys, tabOptions, tabWidth,
  } = ctx
  const instance = tabSelectRef.current
  if (!instance) return undefined
  if (runningTabKeys.size === 0) {
    // Nothing is running: hand back exactly what React rendered, or the last
    // frame drawn stays frozen on a tab that has finished.
    instance.setOptions(tabOptions)
    return undefined
  }
  let frame = 0
  const paint = () => {
    const target = tabSelectRef.current
    if (!target) return
    target.setOptions(tabOptions.map((option) => (
      option.value != null && runningTabKeys.has(option.value as string)
        ? { ...option, name: tabStripActivity(option.name, tabWidth, TAB_SPINNER_FRAMES[frame % TAB_SPINNER_FRAMES.length]) }
        : option
    )))
  }
  paint()
  const id = setInterval(() => {
    frame += 1
    paint()
  }, TAB_SPINNER_INTERVAL_MS)
  return () => clearInterval(id)
}

export type TranscriptScrollSyncEffectContext = {
  transcriptCards: TuiTranscriptCard[]
  previousTranscriptRef: React.RefObject<{ sessionKey: string | null; length: number; lastKey: string | null; }>
  committedSessionKey: string | null
  setTranscriptCursorKey: (action: string | null | ((previous: string | null) => string | null)) => void
  setPendingNewCount: React.Dispatch<React.SetStateAction<number>>
  setUnreadBoundaryKey: React.Dispatch<React.SetStateAction<string | null>>
  restoredReaderState: { sessionKey: string | null; loaded: boolean; state: TuiSessionReaderState | null; }
  transcriptIndexByKey: TranscriptIndexLookup
  visibleTranscriptCards: TuiTranscriptCard[]
  setFollowTail: React.Dispatch<React.SetStateAction<boolean>>
  setResumeMarkerKey: React.Dispatch<React.SetStateAction<string | null>>
  setComposerLiveTodos: React.Dispatch<React.SetStateAction<OpenCodeTodo[]>>
  followTail: boolean
  readCursorIndex: () => number
}

export function runTranscriptScrollSyncEffect(ctx: TranscriptScrollSyncEffectContext) {
  const {
    transcriptCards, previousTranscriptRef, committedSessionKey, setTranscriptCursorKey,
    setPendingNewCount, setUnreadBoundaryKey, restoredReaderState, transcriptIndexByKey,
    visibleTranscriptCards, setFollowTail, setResumeMarkerKey, setComposerLiveTodos, followTail,
    readCursorIndex,
  } = ctx
  const currentLength = transcriptCards.length
  const currentLastKey = transcriptCards.at(-1)?.key ?? null
  const previous = previousTranscriptRef.current
  const sameSession = previous.sessionKey === committedSessionKey

  if (currentLength === 0) {
    setTranscriptCursorKey(null)
    setPendingNewCount(0)
    setUnreadBoundaryKey(null)
    previousTranscriptRef.current = { sessionKey: committedSessionKey, length: 0, lastKey: null }
    return
  }

  if (!sameSession) {
    if (restoredReaderState.sessionKey !== committedSessionKey || !restoredReaderState.loaded) return
    const restoredState = restoredReaderState.state
    if (restoredState?.followTail === false) {
      const restoredIndex = restoredState.cursorKey ? (transcriptIndexByKey.get(restoredState.cursorKey) ?? -1) : -1
      const targetIndex = restoredIndex >= 0 ? restoredIndex : 0
      setTranscriptCursorKey(visibleTranscriptCards[targetIndex]?.key ?? visibleTranscriptCards[0].key)
      setFollowTail(false)
      setPendingNewCount(0)
      setUnreadBoundaryKey(null)
      setResumeMarkerKey(restoredState.cursorKey)
    } else {
      setTranscriptCursorKey(visibleTranscriptCards[visibleTranscriptCards.length - 1].key)
  setComposerLiveTodos(keepEmpty)
  setFollowTail(true)
  setPendingNewCount(0)
  setUnreadBoundaryKey(null)
      setResumeMarkerKey(null)
    }
    previousTranscriptRef.current = { sessionKey: committedSessionKey, length: currentLength, lastKey: currentLastKey }
    return
  }

  if (followTail) {
    setTranscriptCursorKey(visibleTranscriptCards[visibleTranscriptCards.length - 1].key)
    setPendingNewCount(0)
    setUnreadBoundaryKey(null)
    previousTranscriptRef.current = { sessionKey: committedSessionKey, length: currentLength, lastKey: currentLastKey }
    return
  }

  // Detached readers need append accounting, but do not allocate a second
  // full key array. The scan is limited to this paused-reader path; the
  // common tail-following live stream above remains O(1).
  const previousLastIndex = previous.lastKey
    ? transcriptCards.findIndex((card) => card.key === previous.lastKey)
    : -1
  const appendedCount = previousLastIndex >= 0
    ? currentLength - previousLastIndex - 1
    : 0

  if (appendedCount > 0) {
    setPendingNewCount(appendedCount)
    setUnreadBoundaryKey((current) => {
      if (current && transcriptCards.some((card) => card.key === current)) return current
      return transcriptCards[previousLastIndex + 1]?.key ?? null
    })
  }

  setTranscriptCursorKey((current) => {
    if (current && transcriptCards.some((card) => card.key === current)) return current
    return visibleTranscriptCards[Math.max(readCursorIndex(), 0)]?.key ?? visibleTranscriptCards[0].key
  })
  previousTranscriptRef.current = { sessionKey: committedSessionKey, length: currentLength, lastKey: currentLastKey }
  // cursorIndex is intentionally omitted from deps: the effect reconciles
  // cursor/pending state when transcriptCards changes, and the cursorIndex
  // fallback only fires when the current cursor key is missing from the new
  // card list. Re-running on every j/k keystroke would do O(n) indexOf +
  // includes work over the full transcript for a no-op setter result.
  // eslint-disable-next-line react-hooks/exhaustive-deps
}
