'use client'

import { PLUGIN_API_VERSION, type PluginViewModule } from '../../../lib/plugins/types'
import type { WebPluginView, WebPluginViewProps } from '../../../components/shell/pluginTypes'
import PromptLibrary from './PromptLibrary'
import { getProviderComposer } from '../../../lib/providerComposer'

function PromptLibrarySurface({ services, close, placement, useState }: WebPluginViewProps) {
  const provider = services.session?.session?.provider
  const composer = getProviderComposer(provider)
  const view = <PromptLibrary
    accent={{ cssVar: composer.cssAccentVar, cssRgb: composer.cssAccentRgb, label: composer.label }}
    activeProvider={provider}
    onInsert={text => services.composer?.insertText?.(text)}
    onClose={close}
    useState={useState}
    docked={placement !== 'overlay'}
  />
  return placement === 'overlay'
    ? <div onPointerDown={event => { if (event.target === event.currentTarget) close() }} style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'grid', placeItems: 'center', background: 'rgba(0,0,0,0.35)' }}>{view}</div>
    : view
}

export const module: PluginViewModule<WebPluginView> = {
  apiVersion: PLUGIN_API_VERSION, pluginId: 'prompt-library',
  views: { 'prompt-library': PromptLibrarySurface },
}
