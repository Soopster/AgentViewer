import type { RefObject } from 'react'
import type { Dispatch } from 'react'
import type { SetStateAction } from 'react'
import { useCallback } from 'react'
import { type TimelineRowLayout, type TimelineScrollAnchor } from '@/lib/timelineVirtualizer'
import { PROGRAMMATIC_SCROLL_SUPPRESSION_MS, TIMELINE_BOTTOM_GUTTER_PX, FAST_SCROLL_ENTER_PX_PER_S, FAST_SCROLL_EXIT_PX_PER_S, TIMELINE_TARGET_TOP_GUTTER_PX } from '../constants'

export type UseMarkProgrammaticTimelineScrollGroupContext = {
  programmaticScrollUntilRef: RefObject<number>
  timelineRef: RefObject<HTMLDivElement | null>
  activeTimelineScrollAnchorRef: RefObject<TimelineScrollAnchor | null>
  rowLayoutRef: { current: TimelineRowLayout; }
  suppressFollowEvalUntilRef: RefObject<number>
  commitTimelineScrollTop: (value: number) => void
  autoFollow: boolean
  setAutoFollow: Dispatch<SetStateAction<boolean>>
  markTimelineUserScrolling: () => void
  pendingMountedAnchorCaptureRef: RefObject<boolean>
  scrollRafRef: RefObject<number | null>
  scheduleTimelineMeasurementFlushRef: RefObject<() => void>
  scrollVelocitySampleRef: RefObject<{ top: number; time: number; } | null>
  setFastScrollingMode: (value: boolean) => void
  commitTimelineScrollTopIfDrifted: (value: number) => void
  autoFollowRef: RefObject<boolean>
}

export function useMarkProgrammaticTimelineScrollGroup(ctx: UseMarkProgrammaticTimelineScrollGroupContext) {
  const {
    programmaticScrollUntilRef, timelineRef, activeTimelineScrollAnchorRef, rowLayoutRef,
    suppressFollowEvalUntilRef, commitTimelineScrollTop, autoFollow, setAutoFollow,
    markTimelineUserScrolling, pendingMountedAnchorCaptureRef, scrollRafRef,
    scheduleTimelineMeasurementFlushRef, scrollVelocitySampleRef, setFastScrollingMode,
    commitTimelineScrollTopIfDrifted, autoFollowRef,
  } = ctx

  const markProgrammaticTimelineScroll = useCallback((duration = PROGRAMMATIC_SCROLL_SUPPRESSION_MS) => {
    programmaticScrollUntilRef.current = Math.max(programmaticScrollUntilRef.current, performance.now() + duration)
  }, [])

  const restoreTimelineScrollAnchor = useCallback(() => {
    const node = timelineRef.current
    const anchor = activeTimelineScrollAnchorRef.current
    activeTimelineScrollAnchorRef.current = null
    if (!node || !anchor) return

    const layout = rowLayoutRef.current
    const index = layout.indexByKey.get(anchor.key)
    if (index == null) return

    const maxScrollTop = Math.max(node.scrollHeight - node.clientHeight, 0)
    const targetTop = Math.max(0, Math.min(layout.tops[index] + anchor.offset, maxScrollTop))
    if (Math.abs(node.scrollTop - targetTop) < 1) return

    suppressFollowEvalUntilRef.current = performance.now() + 200
    markProgrammaticTimelineScroll()
    node.scrollTop = targetTop
    commitTimelineScrollTop(node.scrollTop)
  }, [commitTimelineScrollTop, markProgrammaticTimelineScroll])

  const scrollTimelineToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    const node = timelineRef.current
    if (!node) return
    const targetTop = Math.max(node.scrollHeight - node.clientHeight, 0)
    commitTimelineScrollTop(targetTop)
    suppressFollowEvalUntilRef.current = performance.now() + 200
    markProgrammaticTimelineScroll(behavior === 'smooth' ? 700 : undefined)
    node.scrollTo({ top: targetTop, behavior })
  }, [commitTimelineScrollTop, markProgrammaticTimelineScroll])

  const toggleLiveFollow = useCallback(() => {
    const next = !autoFollow
    setAutoFollow(next)
    if (next) {
      window.requestAnimationFrame(() => scrollTimelineToBottom())
    }
  }, [autoFollow, scrollTimelineToBottom])

  const handleTimelineScroll = useCallback(() => {
    const isProgrammaticScroll = performance.now() < programmaticScrollUntilRef.current
    if (!isProgrammaticScroll) {
      markTimelineUserScrolling()
      pendingMountedAnchorCaptureRef.current = true
    }
    if (scrollRafRef.current != null) return
    scrollRafRef.current = window.requestAnimationFrame(() => {
      scrollRafRef.current = null
      const node = timelineRef.current
      if (!node) return
      scheduleTimelineMeasurementFlushRef.current()
      const now = performance.now()
      if (now < programmaticScrollUntilRef.current) {
        // A programmatic jump teleports scrollTop; reset the sample so the
        // jump doesn't read as fling velocity on the next real scroll.
        scrollVelocitySampleRef.current = { top: node.scrollTop, time: now }
      } else {
        const sample = scrollVelocitySampleRef.current
        scrollVelocitySampleRef.current = { top: node.scrollTop, time: now }
        if (sample && now > sample.time) {
          const velocity = (Math.abs(node.scrollTop - sample.top) / (now - sample.time)) * 1000
          if (velocity >= FAST_SCROLL_ENTER_PX_PER_S) setFastScrollingMode(true)
          else if (velocity <= FAST_SCROLL_EXIT_PX_PER_S) setFastScrollingMode(false)
        }
      }
      // Quantized: re-render only once the window has meaningfully moved.
      // The exact resting position is committed by the scroll-idle timer in
      // markTimelineUserScrolling.
      commitTimelineScrollTopIfDrifted(node.scrollTop)
      if (now < suppressFollowEvalUntilRef.current) return
      const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight
      setAutoFollow(distanceFromBottom <= TIMELINE_BOTTOM_GUTTER_PX + 16)
    })
  }, [commitTimelineScrollTopIfDrifted, markTimelineUserScrolling, setFastScrollingMode])

  const scrollMountedTimelineRowIntoView = useCallback((messageId: string): boolean => {
    const node = timelineRef.current
    if (!node) return false

    let rowNode: HTMLElement | null = null
    for (const candidate of Array.from(node.querySelectorAll<HTMLElement>('.timeline-row[data-message-id]'))) {
      if (candidate.dataset.messageId === messageId) {
        rowNode = candidate
        break
      }
    }
    if (!rowNode) return false

    const nodeRect = node.getBoundingClientRect()
    const rowRect = rowNode.getBoundingClientRect()
    const targetTop = Math.max(node.scrollTop + rowRect.top - nodeRect.top - TIMELINE_TARGET_TOP_GUTTER_PX, 0)
    suppressFollowEvalUntilRef.current = performance.now() + 300
    autoFollowRef.current = false
    setAutoFollow(false)
    if (Math.abs(node.scrollTop - targetTop) > 1) {
      markProgrammaticTimelineScroll()
      node.scrollTop = targetTop
      commitTimelineScrollTop(targetTop)
    }
    return true
  }, [commitTimelineScrollTop, markProgrammaticTimelineScroll])

  return {
    markProgrammaticTimelineScroll, restoreTimelineScrollAnchor, scrollTimelineToBottom,
    toggleLiveFollow, handleTimelineScroll,
    scrollMountedTimelineRowIntoView,
  }
}
