/** @jsxImportSource @opentui/react */
// TUI entry for the Terminal plugin: loaded on first open, never at boot. The
// processes and shells it shows are the host's (sdkTerminal): this view only
// watches and drives them, so closing it stops nothing.
import { PLUGIN_API_VERSION, type PluginViewModule } from '../../../lib/plugins/types'
import type { TuiPluginView, TuiPluginViewProps } from '../../../tui/opentui/shell/sdk'
import { ProcessPane } from './ProcessPane'

function TerminalSurface({ services, theme, width, height, focused, registerKeys, setCapture }: TuiPluginViewProps) {
  const composer = services.composer
  const notices = services.notices
  const openFile = services['open-file']
  const selection = services['window-selection']
  return (
    <ProcessPane
      theme={theme}
      width={width}
      height={height}
      focused={focused}
      cwd={services.repository?.cwd || process.cwd()}
      onKeyHandlerReady={registerKeys}
      // A new callback each render, as the host's always was: the pane then
      // re-reports its capture after the host drops it on a workspace switch.
      onCaptureChange={(capture) => setCapture(capture === 'none' ? false : capture)}
      initialSelectedId={selection?.initial ?? null}
      onSelectedChange={selection?.changed}
      onNotice={(tone, text, durationMs) => notices?.show(tone, text, durationMs)}
      onOpenFile={(path, line) => openFile?.open(path, line ?? null)}
      // The composer takes the keys from here; the process keeps running.
      onAskAgent={composer?.appendPrompt ? (prompt) => composer.appendPrompt!(prompt, 'Error added to composer') : undefined}
    />
  )
}

export const module: PluginViewModule<TuiPluginView> = {
  apiVersion: PLUGIN_API_VERSION,
  pluginId: 'terminal',
  views: { terminal: TerminalSurface },
}
