import { useEffect, useState } from 'react'
import type { Session } from '../../lib/types'
import type { TuiTranscriptCard } from '../format'
import type { TuiDensity } from '../theme'
import { attachedTranscriptCardsForVariant, formatTranscriptCardsAsync, getTranscriptCardsSync } from './sessionDetailWorkerClient'
import { preserveArrayIdentity } from './splitPaneState'
import { sessionIdentityKey } from './sessionIdentity'
import { sessionTranscriptUpdatedAt } from './sessionRefreshPolicy'
import { useStableEvent } from './useStableEvent'
import { useTranscriptSessionLoader } from './useTranscriptSessionLoader'
import { useWindowVisible } from './windowActivity'

/** A window owns its presentation; the loader owns shared payloads and reads.
 * Late formatting completions cannot publish into a newer variant or a hidden
 * window. Cached card arrays retain their identity on unchanged publications. */
export function useTranscriptCards({ session, density, showToolCalls, active, focused, shouldYield }: {
  session: Session; density: TuiDensity; showToolCalls: boolean
  active: boolean; focused: boolean; shouldYield: () => boolean
}) {
  const loader = useTranscriptSessionLoader()
  const visible = useWindowVisible()
  const key = sessionIdentityKey(session)
  const current = useStableEvent(() => ({ session, active, focused }))
  const owner = JSON.stringify([key, density, showToolCalls])
  const cachedCards = () => {
    const detail = loader.peek(session, density, showToolCalls)?.detail
    return detail ? attachedTranscriptCardsForVariant(detail, density, showToolCalls)
      ?? getTranscriptCardsSync(session, detail.threadedMessages, density, showToolCalls) : null
  }
  type State = { owner: string; cards: TuiTranscriptCard[]; status: 'loading' | 'ready' | 'error'; error: string | null }
  const initial = (): State => { const cards = cachedCards(); return { owner, cards: cards ?? [], status: cards ? 'ready' : 'loading', error: null } }
  const [state, setState] = useState<State>(initial)
  useEffect(() => {
    if (!visible) return
    let cancelled = false
    let version = 0
    if (!loader.peek(session, density, showToolCalls)) setState({ owner, cards: [], status: 'loading', error: null })
    const release = loader.observe({
      session, density, tools: showToolCalls,
      revision: () => sessionTranscriptUpdatedAt(current().session),
      active: () => current().active,
      priority: () => current().focused ? 0 : 1,
      shouldYield,
      onDetail: detail => {
        const request = ++version
        const accept = (next: TuiTranscriptCard[]) => {
          if (cancelled || request !== version) return
          setState(previous => {
            const cards = previous.owner === owner ? preserveArrayIdentity(previous.cards, next) : next
            return previous.owner === owner && previous.cards === cards && previous.status === 'ready' && previous.error === null
              ? previous : { owner, cards, status: 'ready', error: null }
          })
        }
        const cached = attachedTranscriptCardsForVariant(detail, density, showToolCalls)
          ?? getTranscriptCardsSync(session, detail.threadedMessages, density, showToolCalls)
        if (cached) accept(cached)
        else void formatTranscriptCardsAsync(session, detail.threadedMessages, density, showToolCalls).then(accept).catch(reason => {
          if (!cancelled && request === version) setState(previous => ({ ...previous, owner, status: 'error', error: String(reason) }))
        })
      },
      onError: reason => {
        if (!cancelled) setState(previous => ({ ...previous, owner, status: 'error', error: reason instanceof Error ? reason.message : 'Failed to load transcript' }))
      },
    })
    return () => { cancelled = true; release() }
  }, [visible, owner, density, showToolCalls, loader, shouldYield, current])
  return state.owner === owner ? state : initial()
}
