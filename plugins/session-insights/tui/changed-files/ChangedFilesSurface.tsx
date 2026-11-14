/** @jsxImportSource @opentui/react */
import type { TuiPluginView, TuiPluginViewProps } from '../../../../tui/opentui/shell/sdk'
import { ChangedFilesPopover } from './ChangedFilesPopover'

export function ChangedFilesSurface({ services, theme, width, height, placement, registerKeys, close, detach }: TuiPluginViewProps) {
  const transcript = services['session-transcript']
  const docked = placement !== 'overlay'
  if (transcript?.status === 'gone') return <text fg={theme.dim}>  That session is no longer available.</text>
  return (
    <ChangedFilesPopover
      docked={docked}
      theme={theme}
      width={width}
      height={height}
      cards={transcript?.detail?.transcriptCards ?? null}
      session={services.session?.session ?? null}
      insights={services['session-insights']}
      loading={transcript?.status === 'loading'}
      onOpenFile={services['open-file']?.open}
      onClose={close}
      onDetach={detach}
      onKeyHandlerReady={registerKeys}
    />
  )
}

