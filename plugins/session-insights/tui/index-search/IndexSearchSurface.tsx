/** @jsxImportSource @opentui/react */
import type { TuiPluginView, TuiPluginViewProps } from '../../../../tui/opentui/shell/sdk'
import { SessionSearchPopover } from './SessionSearchPopover'

export function IndexSearchSurface({ services, theme, width, height, placement, registerKeys, close, detach }: TuiPluginViewProps) {
  const fleet = services['session-fleet']!
  return (
    <SessionSearchPopover
      docked={placement !== 'overlay'}
      theme={theme}
      width={width}
      height={height}
      sessions={fleet.sessions}
      insights={services['session-insights']!}
      onOpenSession={(session) => { if (placement === 'overlay') close(); fleet.open(session) }}
      onClose={close}
      onDetach={detach}
      onKeyHandlerReady={registerKeys}
    />
  )
}

