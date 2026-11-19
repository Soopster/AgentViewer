'use client'
import { PLUGIN_API_VERSION, type PluginViewModule } from '../../../lib/plugins/types'
import type { WebPluginView, WebPluginViewProps } from '../../../components/shell/pluginTypes'
import CrossSessionMessaging from './CrossSessionMessaging'
import StandaloneMessaging from './StandaloneMessaging'

function MessagingSurface({ services, useState, placement, close }: WebPluginViewProps) {
  const location = services['page-location']
  const view = location
    ? <StandaloneMessaging initialRecipient={new URL(location.url).searchParams.get('to') ?? undefined}
        onRecipientChange={id => location.replaceQuery('to', id)} useState={useState} service={services.messaging!} />
    : <CrossSessionMessaging useState={useState} service={services.messaging!} />
  return placement === 'overlay' ? <div role="dialog" aria-modal="true" aria-label="Cross-session messaging"
    onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); close() } }}
    style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'var(--bg)', overflow: 'auto' }}>
    <button type="button" onClick={close}>Close</button>{view}
  </div> : view
}
export const module: PluginViewModule<WebPluginView> = {
  apiVersion: PLUGIN_API_VERSION, pluginId: 'messaging', views: { messaging: MessagingSurface },
}
