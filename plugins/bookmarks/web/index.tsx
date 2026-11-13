'use client'

// Web entry for the Bookmarks plugin: its own chunk, loaded on first open.
import { PLUGIN_API_VERSION, type PluginViewModule } from '@/lib/plugins/types'
import type { WebPluginView, WebPluginViewProps } from '@/components/shell/pluginTypes'
import BookmarksPanel from './BookmarksPanel'

function BookmarksView({ services, close }: WebPluginViewProps) {
  const navigation = services['session-navigation']!
  return (
    <BookmarksPanel
      open
      service={services.bookmarks!}
      onClose={close}
      onSelect={({ sessionId, provider, uuid }) => navigation.open({ sessionId, provider }, uuid)}
    />
  )
}

export const module: PluginViewModule<WebPluginView> = {
  apiVersion: PLUGIN_API_VERSION,
  pluginId: 'bookmarks',
  views: { bookmarks: BookmarksView },
}
