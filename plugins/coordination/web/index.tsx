'use client'

// Web entry for the Coordination plugin: its own chunk, loaded on first open.
// The runs and teams are the server's; these views only read and act on them.
import { PLUGIN_API_VERSION, type PluginViewModule } from '@/lib/plugins/types'
import type { WebPluginView, WebPluginViewProps } from '@/components/shell/pluginTypes'
import AgentTeamCoordinator from './AgentTeamCoordinator'
import CoordinatorConversation from './CoordinatorConversation'

const NOTHING = () => {}

function ControlCenterSurface({ services }: WebPluginViewProps) {
  const coordination = services.coordination!
  return (
    <AgentTeamCoordinator
      provider={coordination.provider}
      selectedSession={coordination.selectedSession}
      onOpenSession={coordination.openSession}
      onSessionsChanged={coordination.sessionsChanged ?? NOTHING}
    />
  )
}

function TeammatesSurface({ services }: WebPluginViewProps) {
  const coordination = services.coordination!
  const session = coordination.selectedSession
  if (!session) return null
  return (
    <CoordinatorConversation
      key={`${session.providerInstanceId ?? session.provider}:${session.sessionId}`}
      session={session}
      onInspect={coordination.inspectTeammate ?? NOTHING}
      onReturnToChat={coordination.returnToChat ?? NOTHING}
      onAttentionChange={coordination.attentionChanged ?? NOTHING}
    />
  )
}

export const module: PluginViewModule<WebPluginView> = {
  apiVersion: PLUGIN_API_VERSION,
  pluginId: 'coordination',
  views: { coordination: ControlCenterSurface, teammates: TeammatesSurface },
}
