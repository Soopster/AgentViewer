/** @jsxImportSource @opentui/react */
// TUI entry for the View Studio: loaded the first time it opens.
import { useEffect, useRef } from 'react'
import { PLUGIN_API_VERSION, type PluginViewModule } from '../../../lib/plugins/types'
import type { TuiPluginView, TuiPluginViewProps } from '../../../tui/opentui/shell/sdk'
import { ViewStudioOverlay, type ViewStudioKeyHandler } from './ViewStudio'

function ViewStudioSurface({ services, theme, registerKeys }: TuiPluginViewProps) {
  const studio = services['view-studio']!
  // The studio's own handler is assigned on every render (it reads the current draft); the host's key routing calls through this ref.
  const keyHandlerRef = useRef<ViewStudioKeyHandler | null>(null)
  useEffect(() => {
    registerKeys((key) => keyHandlerRef.current?.({ name: key.name, sequence: key.sequence, ctrl: key.ctrl, meta: Boolean((key as { meta?: boolean }).meta), shift: key.shift }) ?? false)
    return () => registerKeys(null)
  }, [registerKeys])
  return (
    <ViewStudioOverlay
      theme={theme}
      top={studio.layout.top}
      width={studio.layout.width}
      height={studio.layout.height}
      draft={studio.draft}
      saved={studio.saved}
      globalDensity={studio.density}
      onChange={studio.change}
      onSave={studio.save}
      onDiscard={studio.discard}
      onDelete={studio.remove}
      keyHandlerRef={keyHandlerRef}
    />
  )
}

export const module: PluginViewModule<TuiPluginView> = {
  apiVersion: PLUGIN_API_VERSION,
  pluginId: 'view-studio',
  views: { 'view-studio': ViewStudioSurface },
}
