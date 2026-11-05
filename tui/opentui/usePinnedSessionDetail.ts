import { useEffect, useState } from 'react'
import type { Session } from '../../lib/types'
import type { TuiSessionDetail } from '../../lib/tui/service'
import type { TuiDensity } from '../theme'
import { useTranscriptSessionLoader } from './useTranscriptSessionLoader'
import { useWindowVisible } from './windowActivity'
import { useStableEvent } from './useStableEvent'
import { sessionTranscriptUpdatedAt } from './sessionRefreshPolicy'
import { sessionIdentityKey } from './sessionIdentity'

// Pinned tools keep their session identity while sharing payloads with transcript
// windows. Poll only when its revision changes, yielding to foreground work.
export function usePinnedSessionDetail(session: Session | null, density: TuiDensity, showToolCalls: boolean, shouldYield: () => boolean) {
  const loader = useTranscriptSessionLoader()
  const visible = useWindowVisible()
  const key = session ? sessionIdentityKey(session) : null
  const owner = JSON.stringify([key, density, showToolCalls])
  type State = { owner: string; detail: TuiSessionDetail | null; status: 'loading' | 'ready' | 'error' | 'gone' }
  const initial = (): State => {
    const detail = session ? loader.peek(session, density, showToolCalls)?.detail ?? null : null
    return { owner, detail, status: !session ? 'gone' : detail ? 'ready' : 'loading' }
  }
  const [state, setState] = useState<State>(initial)
  const latest = useStableEvent(() => session)
  useEffect(() => {
    if (!session || !key) { setState({ owner, detail: null, status: 'gone' }); return }
    if (!visible) return
    let cancelled = false
    setState(initial())
    const release = loader.observe({
      session, density, tools: showToolCalls,
      revision: () => { const current = latest(); return current ? sessionTranscriptUpdatedAt(current) : undefined },
      active: () => false, priority: () => 1, shouldYield,
      onDetail: detail => { if (!cancelled) setState(previous => previous.owner === owner && previous.detail === detail && previous.status === 'ready' ? previous : { owner, detail, status: 'ready' }) },
      onError: () => { if (!cancelled) setState(previous => ({ ...previous, owner, status: 'error' })) },
    })
    return () => { cancelled = true; release() }
  }, [owner, density, showToolCalls, loader, visible, shouldYield, latest])
  return state.owner === owner ? state : initial()
}

