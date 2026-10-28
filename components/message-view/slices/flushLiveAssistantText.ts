import type { MutableRefObject } from 'react'
import type { Dispatch } from 'react'
import type { SetStateAction } from 'react'
import { useCallback } from 'react'

export type UseFlushLiveAssistantTextGroupContext = {
  liveAssistantFlushFrameRef: MutableRefObject<number | null>
  pendingLiveAssistantTextRef: MutableRefObject<string | null>
  setLiveAssistantText: Dispatch<SetStateAction<string>>
  pendingLiveReasoningTextRef: MutableRefObject<string | null>
  setLiveReasoningText: Dispatch<SetStateAction<string>>
  liveAssistantTextRef: MutableRefObject<string>
  liveReasoningTextRef: MutableRefObject<string>
  setLiveThinkingTokens: Dispatch<SetStateAction<number>>
  liveSubagentFlushFrameRef: MutableRefObject<number | null>
  setLiveSubagentText: Dispatch<SetStateAction<Record<string, string>>>
  liveSubagentTextRef: MutableRefObject<Record<string, string>>
}

export function useFlushLiveAssistantTextGroup(ctx: UseFlushLiveAssistantTextGroupContext) {
  const {
    liveAssistantFlushFrameRef, pendingLiveAssistantTextRef, setLiveAssistantText,
    pendingLiveReasoningTextRef, setLiveReasoningText, liveAssistantTextRef, liveReasoningTextRef,
    setLiveThinkingTokens, liveSubagentFlushFrameRef, setLiveSubagentText, liveSubagentTextRef,
  } = ctx

  const flushLiveAssistantText = useCallback(() => {
    liveAssistantFlushFrameRef.current = null
    const nextText = pendingLiveAssistantTextRef.current
    if (nextText != null) {
      pendingLiveAssistantTextRef.current = null
      setLiveAssistantText(nextText)
    }
    const nextReasoning = pendingLiveReasoningTextRef.current
    if (nextReasoning != null) {
      pendingLiveReasoningTextRef.current = null
      setLiveReasoningText(nextReasoning)
    }
  }, [pendingLiveAssistantTextRef, liveAssistantFlushFrameRef, pendingLiveReasoningTextRef, setLiveAssistantText, setLiveReasoningText])

  const flushLiveAssistantTextNow = useCallback(() => {
    if (liveAssistantFlushFrameRef.current != null) {
      window.cancelAnimationFrame(liveAssistantFlushFrameRef.current)
      liveAssistantFlushFrameRef.current = null
    }
    flushLiveAssistantText()
  }, [flushLiveAssistantText, liveAssistantFlushFrameRef])

  const clearLiveAssistantText = useCallback(() => {
    if (liveAssistantFlushFrameRef.current != null) {
      window.cancelAnimationFrame(liveAssistantFlushFrameRef.current)
      liveAssistantFlushFrameRef.current = null
    }
    liveAssistantTextRef.current = ''
    pendingLiveAssistantTextRef.current = null
    setLiveAssistantText('')
    liveReasoningTextRef.current = ''
    pendingLiveReasoningTextRef.current = null
    setLiveReasoningText('')
    setLiveThinkingTokens(0)
  }, [liveAssistantTextRef, pendingLiveAssistantTextRef, liveAssistantFlushFrameRef, liveReasoningTextRef, pendingLiveReasoningTextRef, setLiveAssistantText, setLiveReasoningText, setLiveThinkingTokens])

  const queueLiveAssistantText = useCallback((deltaText: string, replace: boolean) => {
    const nextText = replace ? deltaText : `${liveAssistantTextRef.current}${deltaText}`
    liveAssistantTextRef.current = nextText
    pendingLiveAssistantTextRef.current = nextText
    if (liveAssistantFlushFrameRef.current == null) {
      liveAssistantFlushFrameRef.current = window.requestAnimationFrame(flushLiveAssistantText)
    }
  }, [flushLiveAssistantText, liveAssistantTextRef, pendingLiveAssistantTextRef, liveAssistantFlushFrameRef])

  // Reasoning is always append-only (no replace semantics like the codex
  // realtime answer transcript), and piggybacks on the assistant flush frame.
  const queueLiveReasoningText = useCallback((deltaText: string) => {
    const nextText = `${liveReasoningTextRef.current}${deltaText}`
    liveReasoningTextRef.current = nextText
    pendingLiveReasoningTextRef.current = nextText
    if (liveAssistantFlushFrameRef.current == null) {
      liveAssistantFlushFrameRef.current = window.requestAnimationFrame(flushLiveAssistantText)
    }
  }, [flushLiveAssistantText, liveAssistantFlushFrameRef, liveReasoningTextRef, pendingLiveReasoningTextRef])

  const flushLiveSubagentText = useCallback(() => {
    liveSubagentFlushFrameRef.current = null
    // Snapshot the ref into a fresh object so context consumers see one new
    // identity per frame; the ref keeps mutating in place between flushes.
    setLiveSubagentText({ ...liveSubagentTextRef.current })
  }, [liveSubagentTextRef, liveSubagentFlushFrameRef, setLiveSubagentText])

  const scheduleLiveSubagentFlush = useCallback(() => {
    if (liveSubagentFlushFrameRef.current == null) {
      liveSubagentFlushFrameRef.current = window.requestAnimationFrame(flushLiveSubagentText)
    }
  }, [flushLiveSubagentText, liveSubagentFlushFrameRef])

  const queueLiveSubagentDelta = useCallback((parentId: string, delta: string) => {
    const map = liveSubagentTextRef.current
    map[parentId] = (map[parentId] ?? '') + delta
    scheduleLiveSubagentFlush()
  }, [scheduleLiveSubagentFlush, liveSubagentTextRef])

  const removeLiveSubagentEntry = useCallback((parentId: string) => {
    const map = liveSubagentTextRef.current
    if (!(parentId in map)) return
    delete map[parentId]
    scheduleLiveSubagentFlush()
  }, [scheduleLiveSubagentFlush, liveSubagentTextRef])

  const clearLiveSubagentText = useCallback(() => {
    if (liveSubagentFlushFrameRef.current != null) {
      window.cancelAnimationFrame(liveSubagentFlushFrameRef.current)
      liveSubagentFlushFrameRef.current = null
    }
    liveSubagentTextRef.current = {}
    setLiveSubagentText({})
  }, [liveSubagentTextRef, liveSubagentFlushFrameRef, setLiveSubagentText])

  return {
    flushLiveAssistantTextNow, clearLiveAssistantText, queueLiveAssistantText,
    queueLiveReasoningText, queueLiveSubagentDelta, removeLiveSubagentEntry, clearLiveSubagentText,
  }
}
