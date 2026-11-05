import { useEffect, useRef } from 'react'
import type { Session } from '../../../../lib/types'
import { readTuiSessionRecapsEnabled } from '../../../../lib/tui/service'
import { sessionKey } from '../sessionList'

/**
 * Offers an idle recap's suggested next message through the composer's
 * existing suggestion slot, so the hint row and Tab-to-accept are the ones a
 * live SDK suggestion already uses. The switch itself belongs to the recaps
 * plugin; a session only carries `recap` while it is on.
 *
 * Reading the switch once at boot also arms the engine in this process, which
 * is where turns settle when the TUI owns them.
 *
 * A recap is offered once. Sending, accepting or clearing the suggestion sets
 * the slot back to null, and without the `offered` guard the same recap would
 * be put straight back on the next render.
 */
export function useSessionRecapSuggestion(input: {
  session: Session | null
  draft: string
  sending: boolean
  livePromptSuggestion: string | null
  setLivePromptSuggestion: (value: string | null) => void
}) {
  const { session, draft, sending, livePromptSuggestion, setLivePromptSuggestion } = input
  const offeredRef = useRef(new Set<string>())

  useEffect(() => { void readTuiSessionRecapsEnabled().catch(() => undefined) }, [])

  const recap = session?.recap
  const offerKey = session && recap?.suggestion ? `${sessionKey(session)}|${recap.at}` : null
  useEffect(() => {
    if (!offerKey || !recap?.suggestion) return
    if (offeredRef.current.has(offerKey) || livePromptSuggestion || sending || draft.trim()) return
    offeredRef.current.add(offerKey)
    setLivePromptSuggestion(recap.suggestion)
  }, [offerKey, recap?.suggestion, livePromptSuggestion, sending, draft, setLivePromptSuggestion])
}
