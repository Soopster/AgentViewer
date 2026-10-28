/** @jsxImportSource @opentui/react */
// TUI entry for the Git plugin: loaded on first open, never at boot.
import { useCallback, useRef } from 'react'
import { PLUGIN_API_VERSION, type PluginViewModule } from '../../../lib/plugins/types'
import type { TuiPluginKeyEvent, TuiPluginView, TuiPluginViewProps } from '../../../tui/opentui/shell/sdk'
import { GitPopover } from './GitPopover'

function GitSurface({ services, theme, width, height, placement, zIndex, registerKeys, setCapture, runCommand, close, detach }: TuiPluginViewProps) {
  const repository = services.repository!
  const composer = services.composer
  const capturing = useRef(false)
  const overlay = placement === 'overlay'
  const onKeyCaptureChange = useCallback((capture: boolean) => {
    capturing.current = capture
    setCapture(capture)
  }, [setCapture])
  const onKeyHandlerReady = useCallback((handler: (key: TuiPluginKeyEvent) => boolean | void) => {
    registerKeys((key) => {
      // p hops to pull requests: the reliable path on terminals whose legacy
      // encoding folds Ctrl+Shift+G into Ctrl+G (e.g. Windows).
      if (overlay && key.name === 'p' && !key.ctrl && !key.shift && !capturing.current && runCommand('pull-requests')) return true
      return handler(key)
    })
  }, [registerKeys, runCommand, overlay])
  return (
    <GitPopover
      docked={!overlay}
      cwd={repository.cwd}
      sessionId={repository.sessionId}
      {...(repository.label ? { scopeLabel: repository.label } : {})}
      zIndex={zIndex}
      theme={theme}
      width={width}
      height={height}
      onClose={close}
      onDetach={detach}
      onKeyHandlerReady={onKeyHandlerReady}
      onKeyCaptureChange={onKeyCaptureChange}
      onClipboardWrite={services.clipboard?.write}
      onSendDiffNoteToComposer={composer?.appendDiffNote}
      onAskAgent={composer?.askAboutSelection ? (request) => {
        composer.askAboutSelection!(request)
        // A full-screen overlay hides the composer the prompt just went to.
        if (overlay) close()
      } : undefined}
    />
  )
}

export const module: PluginViewModule<TuiPluginView> = {
  apiVersion: PLUGIN_API_VERSION,
  pluginId: 'git',
  views: { diff: GitSurface },
}
