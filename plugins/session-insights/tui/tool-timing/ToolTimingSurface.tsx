/** @jsxImportSource @opentui/react */
import type { TuiPluginView, TuiPluginViewProps } from '../../../../tui/opentui/shell/sdk'
import { ToolTimingPopover } from './ToolTimingPopover'

export function ToolTimingSurface({ services, theme, width, height, placement, registerKeys, close, detach }: TuiPluginViewProps) {
  const transcript = services['session-transcript']
  if (transcript?.status === 'gone') return <text fg={theme.dim}>  That session is no longer available.</text>
  return (
    <ToolTimingPopover
      docked={placement !== 'overlay'}
      theme={theme}
      width={width}
      height={height}
      cards={transcript?.detail?.transcriptCards ?? null}
      loading={transcript?.status === 'loading'}
      onClose={close}
      onDetach={detach}
      onKeyHandlerReady={registerKeys}
    />
  )
}

