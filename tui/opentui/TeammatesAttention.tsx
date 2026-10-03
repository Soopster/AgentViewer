/** @jsxImportSource @opentui/react */
import { memo, useEffect, useState, useSyncExternalStore } from 'react'
import { readTuiHasSessionCoordinator } from '../../lib/tui/service'
import { getInteractiveCoordinatorAttention, observeInteractiveCoordinator, openInteractiveCoordinatorAttention, subscribeInteractiveCoordinator } from './interactiveCoordinatorStore'
import type { Session } from '../../lib/types'
import type { TuiThemePalette } from '../theme'
import { fitText } from './textLayout'

const TEAM_RECHECK_MS = 5_000

export const TeammatesAttention = memo(function TeammatesAttention({ theme, width, session }: { theme: TuiThemePalette; width: number; session?: Session | null }) {
  const sessionId = session?.isPending ? undefined : session?.sessionId
  const provider = session?.provider ?? 'claude'
  const cwd = session?.cwd
  const title = session?.customTitle ?? session?.summary ?? '(untitled session)'
  // Observing loads lib/agentCoordination.ts, and with it the whole send path —
  // every provider SDK and the Coordinator schema, evaluated on the render
  // thread. Doing that for whichever conversation happened to be selected made
  // it part of every launch (the TUI's longest frames, ~130ms, plus ~40MB) for
  // a badge that is empty unless the conversation has a team. The read-only
  // ledger answers that in one row; re-asked when the Coordinator store moves
  // (a team enabled from the panel) and on a slow timer (one enabled elsewhere).
  const [hasTeam, setHasTeam] = useState(false)
  useEffect(() => {
    setHasTeam(false)
    if (!sessionId) return
    let cancelled = false
    const check = () => {
      void readTuiHasSessionCoordinator(sessionId, provider)
        .then((present) => { if (!cancelled && present) setHasTeam(true) })
        .catch(() => {})
    }
    check()
    const unsubscribe = subscribeInteractiveCoordinator(check)
    const timer = setInterval(check, TEAM_RECHECK_MS)
    return () => { cancelled = true; unsubscribe(); clearInterval(timer) }
  }, [sessionId, provider])
  useEffect(() => {
    if (!sessionId || !hasTeam) return
    return observeInteractiveCoordinator({ sessionId, provider, cwd, title })
  }, [sessionId, provider, cwd, title, hasTeam])
  const label = useSyncExternalStore(subscribeInteractiveCoordinator, getInteractiveCoordinatorAttention, getInteractiveCoordinatorAttention)
  if (!label) return null
  return <box id="teammates-attention" position="absolute" top={0} right={2} height={1} zIndex={5} backgroundColor={theme.surface2}
    onMouseDown={event => { if (event.button === 0) { event.stopPropagation(); openInteractiveCoordinatorAttention() } }}>
    <text fg={label.startsWith('!') ? theme.amber : theme.green} wrapMode="none">{fitText(label, Math.max(Math.min(width - 4, 48), 1)).trimEnd()}</text>
  </box>
})
