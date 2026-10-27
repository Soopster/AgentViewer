/** @jsxImportSource @opentui/react */
import { useRef } from 'react'
import { type TabSelectRenderable } from '@opentui/core'
import { sessionKey } from '../sessionList'

export function useSelectionRefs() {
  const prevFollowTailRef = useRef(true)
  // Velocity scroll: ramps the per-tick cursor step up smoothly the longer j/k/↑/↓
  // is held, by tracking how recently the same-direction key keeps repeating.
  // A gap longer than VELOCITY_SCROLL_RESET_MS means the key was released (or
  // re-pressed deliberately), so the streak — and the speed — resets to base.
  const velocityScrollStateRef = useRef<{ direction: -1 | 1; streakStart: number; lastEventTime: number } | null>(null)
  const tabSelectRef = useRef<TabSelectRenderable>(null)
  const syncingTabSelectionRef = useRef(false)
  const sessionRequestRef = useRef(0)
  const detailRequestRef = useRef(0)
  const backgroundMetadataCursorRef = useRef(0)
  const providerSwitchRef = useRef(false)
  const readerStateWriteTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const readerStatePersistSignatureRef = useRef<string | null>(null)
  const expandedKeysRevisionRef = useRef(0)
  const collapsedKeysRevisionRef = useRef(0)
  const previousTranscriptRef = useRef<{ sessionKey: string | null; length: number; lastKey: string | null }>({
    sessionKey: null,
    length: 0,
    lastKey: null,
  })

  return {
    velocityScrollStateRef, tabSelectRef, syncingTabSelectionRef, sessionRequestRef,
    detailRequestRef, backgroundMetadataCursorRef, providerSwitchRef, readerStateWriteTimeoutRef,
    readerStatePersistSignatureRef, expandedKeysRevisionRef, collapsedKeysRevisionRef,
    previousTranscriptRef,
  }
}
