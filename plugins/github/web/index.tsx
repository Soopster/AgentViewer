'use client'

// Web entry for the GitHub plugin: its own chunk, loaded on first open.
import { PLUGIN_API_VERSION, type PluginViewModule } from '@/lib/plugins/types'
import type { WebPluginView, WebPluginViewProps } from '@/components/shell/pluginTypes'
import { GitHubView } from './GitHubView'

const IGNORE_PROMPT = () => {}

function GitHubSurface({ services, placement, close }: WebPluginViewProps) {
  return (
    <GitHubView
      cwd={services.repository!.cwd}
      docked={placement !== 'overlay'}
      onClose={close}
      onAskAgent={services.composer?.insertText ?? IGNORE_PROMPT}
    />
  )
}

export const module: PluginViewModule<WebPluginView> = {
  apiVersion: PLUGIN_API_VERSION,
  pluginId: 'github',
  views: { github: GitHubSurface },
}
