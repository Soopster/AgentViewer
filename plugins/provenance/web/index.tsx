'use client'

// Web entry for the Code provenance plugin: its own chunk, loaded on first open.
import { PLUGIN_API_VERSION, type PluginViewModule } from '@/lib/plugins/types'
import type { WebPluginView, WebPluginViewProps } from '@/components/shell/pluginTypes'
import ProvenancePopover from './ProvenancePopover'

function ProvenanceView({ services, close }: WebPluginViewProps) {
  const session = services.session?.session ?? null
  const navigation = services['session-navigation']!
  return (
    <ProvenancePopover
      open
      onClose={close}
      session={session && !session.isPending ? { sessionId: session.sessionId, provider: session.provider, providerInstanceId: session.providerInstanceId } : null}
      cwd={services.repository?.cwd ?? session?.cwd ?? null}
      onOpenSession={({ sessionId, provider, uuid }) => { close(); navigation.open({ sessionId, provider }, uuid) }}
    />
  )
}

export const module: PluginViewModule<WebPluginView> = {
  apiVersion: PLUGIN_API_VERSION,
  pluginId: 'provenance',
  views: { provenance: ProvenanceView },
}
