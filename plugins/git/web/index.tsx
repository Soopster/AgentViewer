'use client'

// Web entry for the Git plugin: its own chunk, loaded on first open.
import { PLUGIN_API_VERSION, type PluginViewModule } from '@/lib/plugins/types'
import type { WebPluginView, WebPluginViewProps } from '@/components/shell/pluginTypes'
import GitPopover from './GitPopover'

function GitSurface({ services, placement, close }: WebPluginViewProps) {
  const repository = services.repository!
  return <GitPopover open variant={placement === 'overlay' ? undefined : 'docked'} cwd={repository.cwd} sessionId={repository.sessionId} onClose={close} />
}

export const module: PluginViewModule<WebPluginView> = {
  apiVersion: PLUGIN_API_VERSION,
  pluginId: 'git',
  views: { diff: GitSurface },
}
