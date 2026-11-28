import { useEffect, useState } from 'react'
import { teamAttentionMark } from '@/lib/coordinatorAttention'
import { readJsonResponse } from '@/lib/httpResponse'

type AttentionEntry = {
  sessionId: string
  provider: string
  waiting: number
  finished: number
  resultIds?: string[]
}
type TeamAttention = Record<string, NonNullable<ReturnType<typeof teamAttentionMark>>>
function sameAttention(previous: TeamAttention, next: TeamAttention): boolean {
  const keys = Object.keys(next)
  return keys.length === Object.keys(previous).length && keys.every(key =>
    previous[key]?.waiting === next[key].waiting && previous[key]?.finished === next[key].finished)
}

export function useTeamAttention(visible: boolean): TeamAttention {
  const [attention, setAttention] = useState<TeamAttention>({})
  // eslint-disable-next-line react-doctor/no-set-state-after-await-in-effect -- every awaited response is fenced by the effect's abort signal; visibility/unmount cleanup aborts it
  useEffect(() => {
    if (!visible) return
    const abort = new AbortController()
    let inFlight = false
    const read = async () => {
      if (inFlight || abort.signal.aborted) return
      inFlight = true
      try {
        const response = await fetch('/api/agent-protocol/attention', { signal: abort.signal })
        const data = await readJsonResponse<{ attention?: AttentionEntry[] }>(response)
        if (abort.signal.aborted) return
        const next: TeamAttention = {}
        for (const entry of data.attention ?? []) {
          let reviewed: string[] = []
          try {
            const stored: unknown = JSON.parse(localStorage.getItem(`coordinator:seen:v1:${entry.provider}:${entry.sessionId}`) || '[]')
            if (Array.isArray(stored)) reviewed = stored.filter((value): value is string => typeof value === 'string')
          } catch { /* unreadable markers re-show results */ }
          const mark = teamAttentionMark(entry, reviewed)
          if (mark) next[`${entry.provider}:${entry.sessionId}`] = mark
        }
        setAttention(previous => sameAttention(previous, next) ? previous : next)
      } catch { /* retain existing marks across transient failures */ }
      finally { inFlight = false }
    }
    void read()
    const timer = window.setInterval(() => { void read() }, 5000)
    return () => { abort.abort(); window.clearInterval(timer) }
  }, [visible])
  return attention
}
