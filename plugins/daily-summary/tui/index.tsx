/** @jsxImportSource @opentui/react */
// TUI entry for the Daily summary plugin: loaded on first open, never at boot.
import { PLUGIN_API_VERSION, type PluginViewModule } from '../../../lib/plugins/types'
import type { TuiPluginView, TuiPluginViewProps } from '../../../tui/opentui/shell/sdk'
import { DailySummaryPopover } from './DailySummaryPopover'

const NO_NOTICES = () => {}
const STATUS_UPDATE_NOTICE = 'Status update draft added to the composer'

function DailySummarySurface({ services, theme, accent, width, height, placement, registerKeys, close, detach }: TuiPluginViewProps) {
  const clipboard = services.clipboard
  const composer = services.composer
  return (
    <DailySummaryPopover
      docked={placement !== 'overlay'}
      theme={theme}
      accentColor={accent}
      width={width}
      height={height}
      read={services['daily-summary']!.read}
      onClose={close}
      onNotice={services.notices?.show ?? NO_NOTICES}
      onKeyHandlerReady={registerKeys}
      onDetach={detach}
      onCopy={clipboard ? (text) => { void clipboard.write(text) } : undefined}
      onSendToComposer={composer?.appendPrompt ? (text) => {
        composer.appendPrompt!(text, STATUS_UPDATE_NOTICE)
        if (placement === 'overlay') close()
      } : undefined}
    />
  )
}

export const module: PluginViewModule<TuiPluginView> = {
  apiVersion: PLUGIN_API_VERSION,
  pluginId: 'daily-summary',
  views: { 'daily-summary': DailySummarySurface },
}
