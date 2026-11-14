'use client'

// Web entry for the pull-requests plugin: its own chunk, loaded on first open.
import { PLUGIN_API_VERSION, type PluginViewModule } from '@/lib/plugins/types'
import type { WebPluginView, WebPluginViewProps } from '@/components/shell/pluginTypes'
import PullRequestView from './PullRequestView'

const IGNORE_PROMPT = () => {}

function PullRequestSurface({ services, placement, close }: WebPluginViewProps) {
  const repository = services.repository!
  const link = services['session-pull-request']
  return (
    <PullRequestView
      open
      variant={placement === 'overlay' ? undefined : 'docked'}
      cwd={repository.cwd}
      onClose={close}
      onAskAgent={services.composer?.insertText ?? IGNORE_PROMPT}
      linkedPrNumber={link?.linkedNumber}
      // Linking is offered from the full view; the docked panel only shows the link.
      onLinkToSession={placement === 'overlay' ? link?.link : undefined}
    />
  )
}

export const module: PluginViewModule<WebPluginView> = {
  apiVersion: PLUGIN_API_VERSION,
  pluginId: 'pull-requests',
  views: { 'pull-request': PullRequestSurface },
}
