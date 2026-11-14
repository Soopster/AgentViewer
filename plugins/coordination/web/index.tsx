'use client'

// Web entry for the Coordination plugin: its own chunk, loaded on first open.
// The runs and teams are the server's; these views only read and act on them.
import { useEffect, useRef, useState as useLocalState } from 'react'
import { PLUGIN_API_VERSION, type PluginViewModule } from '@/lib/plugins/types'
import type { WebPluginView, WebPluginViewProps } from '@/components/shell/pluginTypes'
import AgentTeamCoordinator from './AgentTeamCoordinator'
import CoordinatorConversation from './CoordinatorConversation'
import PlaybookManager from './PlaybookManager'
import NewWorkflow, { captureRunLaunchDefaults } from './NewWorkflow'
import { sessionIdentityKey } from '@/lib/sessionIdentity'

const NOTHING = () => {}

function ControlCenterSurface({ services, useState, instanceId }: WebPluginViewProps) {
  const coordination = services.coordination!
  return (
    <AgentTeamCoordinator
      runLaunchService={services['run-launch']!}
      playbooksService={services.playbooks!}
      playbookState={useState}
      instanceId={instanceId}
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
      playbooksService={services.playbooks}
      onInspect={coordination.inspectTeammate ?? NOTHING}
      onReturnToChat={coordination.returnToChat ?? NOTHING}
      onAttentionChange={coordination.attentionChanged ?? NOTHING}
    />
  )
}

function PlaybooksSurface({ services, target, instanceId, useState, close, placement }: WebPluginViewProps) {
  const [notice, setNotice] = useLocalState<string | null>(null)
  const frame = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (placement !== 'overlay') return
    frame.current?.focus()
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault(); event.stopPropagation(); close()
    }
    document.addEventListener('keydown', escape)
    return () => document.removeEventListener('keydown', escape)
  }, [placement, close])
  const cwd = target.cwd ?? services.repository?.cwd
  if (!cwd) return <p role="alert">Open a repository to manage playbooks.</p>
  const view = <div style={{ height: '100%', overflow: 'auto' }}><PlaybookManager cwd={cwd} service={services.playbooks!}
    instanceId={instanceId} useScopedState={useState} onClose={close} onChanged={NOTHING}
    onNotice={setNotice} />{notice && <p role="status">{notice}</p>}</div>
  return placement === 'overlay' ? <div role="dialog" aria-modal="true" aria-label="Playbooks" tabIndex={-1} ref={frame}
    onPointerDown={event => { if (event.target === event.currentTarget) close() }}
    style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'grid', placeItems: 'center', background: 'rgba(0,0,0,0.35)', padding: 16 }}>
    <div style={{ width: 'min(1150px, 100%)', height: 'min(900px, 90vh)', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>{view}</div>
  </div> : view
}

function NewWorkflowSurface({ services, target, instanceId, useState, close, placement }: WebPluginViewProps) {
  const frame = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (placement !== 'overlay') return
    frame.current?.focus()
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault(); event.stopPropagation(); close()
    }
    document.addEventListener('keydown', escape)
    return () => document.removeEventListener('keydown', escape)
  }, [placement, close])
  const cwd = target.cwd ?? services.repository?.cwd
  const session = services.session?.session
  const launch = services['run-launch']!
  const defaults = session ? captureRunLaunchDefaults(launch.defaults, session.provider ?? launch.defaults?.provider ?? 'claude', session.providerInstanceId) : launch.defaults
  if (!cwd) return <p role="alert">Open a repository to start a workflow.</p>
  const view = <div style={{ height: '100%', overflow: 'auto' }}><NewWorkflow baseCwd={cwd}
    ownerKey={`${instanceId}:${session ? sessionIdentityKey(session) : 'repository'}`} useScopedState={useState}
    defaults={defaults} playbooksService={services.playbooks!} launchService={launch} /></div>
  return placement === 'overlay' ? <div role="dialog" aria-modal="true" aria-label="Start coordinated run" tabIndex={-1} ref={frame}
    onPointerDown={event => { if (event.target === event.currentTarget) close() }}
    style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'grid', placeItems: 'center', background: 'rgba(0,0,0,0.35)', padding: 16 }}>
    <div style={{ width: 'min(1300px, 100%)', height: 'min(1000px, 92vh)', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>{view}</div>
  </div> : view
}

export const module: PluginViewModule<WebPluginView> = {
  apiVersion: PLUGIN_API_VERSION,
  pluginId: 'coordination',
  views: { coordination: ControlCenterSurface, teammates: TeammatesSurface, playbooks: PlaybooksSurface, 'new-workflow': NewWorkflowSurface },
}
