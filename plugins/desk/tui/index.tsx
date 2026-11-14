/** @jsxImportSource @opentui/react */
// TUI entry for the Desk plugin: loaded on first open, never at boot.
import { PLUGIN_API_VERSION, type PluginViewModule } from '../../../lib/plugins/types'
import type { Session } from '../../../lib/types'
import type { TuiPluginView, TuiPluginViewProps } from '../../../tui/opentui/shell/sdk'
import { DeskView, type DeskViewProps } from './DeskView'

function DeskSurface({ services, width, height, placement, registerKeys, close }: TuiPluginViewProps) {
  const fleet = services['session-fleet']!
  const themes = services.themes
  // Full screen, leaving for a session closes the desk; a window stays where it is.
  const overlay = placement === 'overlay'
  return (
    <DeskView
      sessions={fleet.sessions}
      activity={fleet.activity}
      alerts={fleet.alerts as DeskViewProps['alerts']}
      loaded={fleet.selected}
      loadedCards={fleet.selectedCards}
      loadedContext={fleet.selectedContext}
      loadedModel={fleet.selectedModel}
      loadedMessageCount={fleet.selectedMessageCount}
      themeActive={themes ? themes.mode === 'bloomberg-dark' || themes.mode === 'bloomberg-light' : false}
      width={width}
      height={height}
      docked={!overlay}
      onLoadSession={fleet.select}
      onOpenSession={(session: Session) => {
        if (overlay) close()
        fleet.open(session)
      }}
      onOpenAlert={(alertKey) => {
        if (fleet.openAlert(alertKey) && overlay) close()
      }}
      onApplyTheme={() => themes?.choose(themes.light ? 'bloomberg-light' : 'bloomberg-dark')}
      onClose={close}
      onKeyHandlerReady={registerKeys}
    />
  )
}

export const module: PluginViewModule<TuiPluginView> = {
  apiVersion: PLUGIN_API_VERSION,
  pluginId: 'desk',
  views: { desk: DeskSurface },
}
