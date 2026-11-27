/** @jsxImportSource @opentui/react */
import type { TuiPluginView, TuiPluginViewProps } from '../../../../tui/opentui/shell/sdk'
import { SessionSearchPopover } from './SessionSearchPopover'

export function IndexSearchSurface({ services, theme, width, height, placement, registerKeys, close, detach }: TuiPluginViewProps) {
  const navigation = services['session-navigation']
  const fleet = services['session-fleet']!
  return (
    <SessionSearchPopover
      docked={placement !== 'overlay'}
      theme={theme}
      width={width}
      height={height}
      sessions={fleet.sessions}
      insights={services['session-insights']!}
      onOpenSession={(session, uuid) => {
        if (placement === 'overlay') close()
        if (navigation && session.provider) navigation.open({
          provider: session.provider, providerInstanceId: session.providerInstanceId ?? session.provider, sessionId: session.sessionId,
        }, uuid)
        else fleet.open(session)
      }}
      onClose={close}
      onDetach={detach}
      onKeyHandlerReady={registerKeys}
    />
  )
}

