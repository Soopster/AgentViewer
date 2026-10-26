/** @jsxImportSource @opentui/react */
// TUI entry for the editor plugin: loaded on first open, never at boot.
import { PLUGIN_API_VERSION, type PluginViewModule } from '../../../lib/plugins/types'
import type { TuiPluginView, TuiPluginViewProps } from '../../../tui/opentui/shell/sdk'
import { disposeEditorProjectSearchWorker } from './editorProjectSearchWorkerClient'
import { clearEditorSyntaxCache } from './editorSyntaxContext'
import { clearEditorCellMeasureCache } from './editorCells'
import { clearEditorLspConfigCache } from './editorLspServers'
import { EditorPopover } from './EditorPopover'

function EditorSurface({ services, target, theme, syntaxStyle, width, height, placement, focused, registerKeys, close, detach }: TuiPluginViewProps) {
  const repository = services.repository!
  const composer = services.composer
  const fileHistory = services['file-history']
  const overlay = placement === 'overlay'
  if (!syntaxStyle) return null
  return (
    <EditorPopover
      docked={!overlay}
      // A window that is not focused must not take the terminal's one focus slot.
      active={overlay || focused}
      cwd={repository.cwd}
      initialPath={target.path ?? null}
      initialLine={target.line ?? null}
      theme={theme}
      width={width}
      height={height}
      syntaxStyle={syntaxStyle}
      onClose={close}
      onKeyHandlerReady={registerKeys}
      onDetach={detach}
      onNotice={services.notices?.show}
      onClipboardRead={services.clipboard?.read}
      onClipboardWrite={services.clipboard?.write}
      onAskAgent={composer?.askAboutSelection ? (request) => {
        composer.askAboutSelection!({ ...request, filePath: request.path, origin: 'editor selection' })
        // Only a full-screen overlay hides the composer the prompt went to.
        return overlay
      } : undefined}
      onOpenFileHistory={fileHistory?.open}
    />
  )
}

export const module: PluginViewModule<TuiPluginView> = {
  apiVersion: PLUGIN_API_VERSION,
  pluginId: 'editor',
  views: { editor: EditorSurface },
  deactivate() { disposeEditorProjectSearchWorker(); clearEditorLspConfigCache(); clearEditorCellMeasureCache(); clearEditorSyntaxCache() },
}
