/** @jsxImportSource @opentui/react */
// TUI entry for the Files plugin: loaded on first open, never at boot.
import { PLUGIN_API_VERSION, type PluginViewModule } from '../../../lib/plugins/types'
import type { TuiPluginView, TuiPluginViewProps } from '../../../tui/opentui/shell/sdk'
import { FileViewerPopover } from './FileViewerPopover'

const NO_SCROLL_PREFERENCES = { velocity: false, toggleVelocity: () => {} }

function FilesSurface({ services, theme, syntaxStyle, width, height, placement, registerKeys, close, detach }: TuiPluginViewProps) {
  const repository = services.repository!
  const picker = services['directory-picker']
  const composer = services.composer
  const openFile = services['open-file']
  const scroll = services['scroll-preferences'] ?? NO_SCROLL_PREFERENCES
  if (!syntaxStyle) return null
  return (
    <FileViewerPopover
      docked={placement !== 'overlay'}
      cwd={repository.cwd}
      theme={theme}
      width={width}
      height={height}
      syntaxStyle={syntaxStyle}
      velocityScrollEnabled={scroll.velocity}
      onToggleVelocityScroll={scroll.toggleVelocity}
      onClose={close}
      onKeyHandlerReady={registerKeys}
      // Choosing a folder for the host is all a picker does: no break-out, no editing.
      onDetach={picker ? undefined : detach}
      onSelectDirectory={picker?.choose}
      onEditPath={picker || !openFile ? undefined : (path) => {
        // A full-screen overlay would hide the editor it opens.
        if (placement === 'overlay') close()
        openFile.open(path)
      }}
      onInsertPath={picker || !composer?.insertText ? undefined : (path) => {
        composer.insertText!(`@${path} `)
      }}
    />
  )
}

export const module: PluginViewModule<TuiPluginView> = {
  apiVersion: PLUGIN_API_VERSION,
  pluginId: 'files',
  views: { files: FilesSurface },
}
