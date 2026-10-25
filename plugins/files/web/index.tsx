'use client'

// Web entry for the Files plugin: its own chunk, loaded on first open.
import { PLUGIN_API_VERSION, type PluginViewModule } from '@/lib/plugins/types'
import type { WebPluginView, WebPluginViewProps } from '@/components/shell/pluginTypes'
import FileViewer from './FileViewer'

function FilesSurface({ services, placement, close }: WebPluginViewProps) {
  const repository = services.repository!
  const composer = services.composer
  return (
    <FileViewer
      open
      variant={placement === 'overlay' ? undefined : 'docked'}
      cwd={repository.cwd}
      canInsert={Boolean(composer)}
      sessionId={repository.sessionId ?? undefined}
      provider={repository.provider ?? undefined}
      onOpenChange={(next) => { if (!next) close() }}
      onInsertPath={composer?.insertPath}
    />
  )
}

export const module: PluginViewModule<WebPluginView> = {
  apiVersion: PLUGIN_API_VERSION,
  pluginId: 'files',
  views: { files: FilesSurface },
}
