'use client'

import { useEffect, useState } from 'react'
import type { ThinkingBlock } from '../../lib/types'
import { latestReasoningSummary, reasoningLabel, hasReasoningContent, thinkingTranscriptText } from '../../lib/reasoningDisplay'

function useReasoningClock(block: ThinkingBlock) {
  const [now, setNow] = useState(() => Date.now())
  const active = !block.reasoning?.completed && block.reasoning?.completedAt === undefined
  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [active])
  return now
}

export function ReasoningStatus({ block }: { block: ThinkingBlock }) {
  const now = useReasoningClock(block)
  return <span title={latestReasoningSummary(block.thinking)}>{reasoningLabel(block, now)}</span>
}

export function ThinkingSummary({ block }: { block: ThinkingBlock }) {
  const [open, setOpen] = useState(false)
  const now = useReasoningClock(block)
  if (!hasReasoningContent(block)) return null
  return <div style={{ borderLeft: '2px solid var(--violet)', padding: '6px 10px', color: 'var(--text-2)', fontSize: 13 }}>
    <button type="button" aria-expanded={open} title={open ? 'Hide thinking transcript' : 'View thinking transcript'} onClick={() => setOpen(value => !value)} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', color: 'var(--violet)', cursor: 'pointer' }}>
      <span aria-hidden="true">{open ? '▾' : '▸'}</span>
      <span>{reasoningLabel(block, now)}</span>
    </button>
    {open ? <div style={{ whiteSpace: 'pre-wrap', marginTop: 6, maxHeight: 320, overflowY: 'auto', lineHeight: 1.6 }}>{thinkingTranscriptText(block) || 'No reasoning summary was provided.'}</div>
      : block.thinking.trim() ? <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 3 }}>{latestReasoningSummary(block.thinking)}</div> : null}
  </div>
}
