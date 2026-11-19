/** @jsxImportSource @opentui/react */
import { PLUGIN_API_VERSION, type PluginViewModule } from '../../../lib/plugins/types'
import type { TuiPluginView, TuiPluginViewProps } from '../../../tui/opentui/shell/sdk'
import { readTuiPrompts, readTuiPrompt, saveTuiPrompt, deleteTuiPrompt } from '../../../tui/opentui/shell/sdkPrompts'
import { PromptLibraryPopover } from './PromptLibraryPopover'
import { useCallback } from 'react'

function PromptLibrarySurface({ services, theme, accent, width, height, placement, focused, registerKeys, close, detach, useState }: TuiPluginViewProps) {
  const insertPrompt = services.composer?.insertPrompt ?? services.composer?.insertText
  const showNotice = services.notices?.show
  const onInsert = useCallback((text: string) => insertPrompt?.(text), [insertPrompt])
  const onNotice = useCallback((tone: 'info' | 'error', text: string) => showNotice?.(tone, text), [showNotice])
  return <PromptLibraryPopover
    theme={theme} accentColor={accent} width={width} height={height}
    activeProvider={services.session?.session?.provider}
    loadPrompts={readTuiPrompts} loadPrompt={readTuiPrompt} savePrompt={saveTuiPrompt} deletePrompt={deleteTuiPrompt}
    onInsert={onInsert}
    onNotice={onNotice}
    onClose={close} onDetach={detach} docked={placement !== 'overlay'} focused={focused}
    onKeyHandlerReady={handler => registerKeys(key => handler({ ...key, meta: Boolean(key.meta) }))} useState={useState}
  />
}

export const module: PluginViewModule<TuiPluginView> = {
  apiVersion: PLUGIN_API_VERSION, pluginId: 'prompt-library',
  views: { 'prompt-library': PromptLibrarySurface },
}
