import { useRef } from 'react'
import { type TimelineScrollAnchor } from '@/lib/timelineVirtualizer'

export function useScrollRafRefGroup() {
  const scrollRafRef = useRef<number | null>(null)
  const programmaticScrollUntilRef = useRef<number>(0)
  const wheelScrollCompensationUntilRef = useRef<number>(0)
  const timelineHeightOverrideRef = useRef<number | null>(null)
  const activeTimelineScrollAnchorRef = useRef<TimelineScrollAnchor | null>(null)
  const pendingTimelineAnchorRestoreRef = useRef(false)
  // Set true on each scroll event, cleared SCROLL_IDLE_MS after the last
  // event. Direct scrollbar/touch scrubbing suppresses scrollTop adjustment;
  // wheel/trackpad input opts back in via wheelScrollCompensationUntilRef.
  const userScrollingRef = useRef(false)
  const userScrollingTimerRef = useRef<number | null>(null)
  const suppressFollowEvalUntilRef = useRef<number>(0)

  return {
    scrollRafRef, programmaticScrollUntilRef, wheelScrollCompensationUntilRef,
    timelineHeightOverrideRef, activeTimelineScrollAnchorRef, pendingTimelineAnchorRestoreRef,
    userScrollingRef, userScrollingTimerRef, suppressFollowEvalUntilRef,
  }
}
