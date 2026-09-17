/** @jsxImportSource @opentui/react */
import { memo, useEffect, useSyncExternalStore } from 'react'
import { getInteractiveCoordinatorAttention, observeInteractiveCoordinator, openInteractiveCoordinatorAttention, subscribeInteractiveCoordinator } from './interactiveCoordinatorStore'
import type { Session } from '../../lib/types'
import type { TuiThemePalette } from '../theme'
import { fitText } from './textLayout'

export const TeammatesAttention = memo(function TeammatesAttention({ theme, width, session }: { theme: TuiThemePalette; width: number; session?: Session | null }) {
  const sessionId = session?.isPending ? undefined : session?.sessionId
  const provider = session?.provider ?? 'claude'
  const cwd = session?.cwd
  const title = session?.customTitle ?? session?.summary ?? '(untitled session)'
  useEffect(() => {
    if (!sessionId) return
    return observeInteractiveCoordinator({ sessionId, provider, cwd, title })
  }, [sessionId, provider, cwd, title])
  const label = useSyncExternalStore(subscribeInteractiveCoordinator, getInteractiveCoordinatorAttention, getInteractiveCoordinatorAttention)
  if (!label) return null
  return <box id="teammates-attention" position="absolute" top={0} right={2} height={1} zIndex={5} backgroundColor={theme.surface2}
    onMouseDown={event => { if (event.button === 0) { event.stopPropagation(); openInteractiveCoordinatorAttention() } }}>
    <text fg={label.startsWith('!') ? theme.amber : theme.green} wrapMode="none">{fitText(label, Math.max(Math.min(width - 4, 48), 1)).trimEnd()}</text>
  </box>
})
