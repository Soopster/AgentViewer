/** @jsxImportSource @opentui/react */
import { memo, useSyncExternalStore } from 'react'
import { getInteractiveCoordinatorAttention, openInteractiveCoordinatorAttention, subscribeInteractiveCoordinator } from './interactiveCoordinatorStore'
import type { TuiThemePalette } from '../theme'
import { fitText } from './textLayout'

export const TeammatesAttention = memo(function TeammatesAttention({ theme, width }: { theme: TuiThemePalette; width: number }) {
  const label = useSyncExternalStore(subscribeInteractiveCoordinator, getInteractiveCoordinatorAttention, getInteractiveCoordinatorAttention)
  if (!label) return null
  return <box id="teammates-attention" position="absolute" top={0} right={2} height={1} zIndex={5} backgroundColor={theme.surface2}
    onMouseDown={event => { if (event.button === 0) { event.stopPropagation(); openInteractiveCoordinatorAttention() } }}>
    <text fg={theme.amber} wrapMode="none">{fitText(label, Math.max(Math.min(width - 4, 48), 1)).trimEnd()}</text>
  </box>
})
