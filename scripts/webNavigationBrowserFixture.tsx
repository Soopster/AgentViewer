import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import SessionList from '../components/SessionList'
import CommandPalette from '../components/CommandPalette'
import { SidebarProvider } from '../components/ui/sidebar'
import { RIGHT_PANEL_SURFACE_KINDS, type RightPanelSurfaceKind } from '../lib/rightPanel'
import type { Session } from '../lib/types'

const noop = () => {}
const availability = Object.fromEntries(RIGHT_PANEL_SURFACE_KINDS.map(kind => [kind, false])) as Record<RightPanelSurfaceKind, boolean>
const initialSessions: Session[] = [
  { sessionId: 'alpha', provider: 'claude', summary: 'Alpha session', firstPrompt: 'Alpha prompt', cwd: '/fixture/alpha', tag: 'review' },
  { sessionId: 'beta', provider: 'claude', summary: 'Beta session', cwd: '/fixture/beta', tag: 'work' },
]

function Fixture() {
  const [sessions, setSessions] = useState(initialSessions)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [scopeMode, setScopeMode] = useState<'all' | 'project'>('project')
  const [events, setEvents] = useState<string[]>([])
  const record = (event: string) => setEvents(previous => [...previous, event])
  return <SidebarProvider>
    <button data-testid="palette" onClick={() => setOpen(true)}>Open palette fixture</button>
    <output data-testid="events">{JSON.stringify(events)}</output>
    <div style={{ width: 340, height: 900 }}>
      <SessionList sessions={sessions} loading={false} error={null} provider="all" providerInstanceId="all"
        providerInstances={[]} switchingProvider={false} selectedId={selectedId} selectedProject={null}
        onSelect={session => { setSelectedId(`claude:${session.sessionId}`); record(`session:${session.sessionId}`) }}
        onSelectProject={noop} onOpenDashboard={noop}
        onRename={(sessionId, customTitle) => {
          setSessions(previous => previous.map(session => session.sessionId === sessionId ? { ...session, customTitle } : session))
          record(`rename:${sessionId}:${customTitle}`)
        }}
        onTag={(sessionId, tag) => {
          setSessions(previous => previous.map(session => session.sessionId === sessionId ? { ...session, tag } : session))
          record(`tag:${sessionId}:${tag}`)
        }}
        onChangeProvider={noop} scopeMode={scopeMode} scopeProjectName="alpha" canScopeToProject
        includeWorktrees onChangeScope={setScopeMode} onToggleWorktrees={noop}
        onOpenCommandPalette={() => setOpen(true)} onOpenCoordinator={noop} onOpenCrossSessionMessaging={noop}
        canOpenGit={false} onOpenGit={noop} />
    </div>
    <CommandPalette open={open} onOpenChange={setOpen} sessions={sessions} selectedSession={sessions[0]!}
      selectedProject={null} provider="all" providerInstanceId="all" providerInstances={[]}
      scopeMode={scopeMode} scopeProjectName="alpha" includeWorktrees
      messagePaneCollapsed={false} messageViewMaximized={false} messageViewFullscreen={false}
      canMaximizeMessageView={false} canOpenGit={false} canOpenTasks={false} canOpenPromptLibrary={false}
      canOpenChannelBridge={false} channelBridgeRouting={false} canOpenIdeBridge={false} ideBridgeRouting={false}
      onSelectSession={(session, messageId) => record(`message:${session.sessionId}:${messageId ?? ''}`)}
      onSelectProject={noop} onChangeProvider={noop} onChangeScope={setScopeMode} onToggleWorktrees={noop}
      onToggleMessagePane={noop} rightPanelOpen={false} rightPanelAvailability={availability}
      onToggleRightPanel={noop} onOpenRightPanelSurface={noop} onToggleMessageViewMaximized={noop}
      onEnterMessageViewFullscreen={noop} onOpenCrossSessionMessaging={noop} onOpenTasks={noop}
      onOpenPromptLibrary={noop} onOpenChannelBridge={noop} onToggleChannelBridgeRoute={noop}
      onOpenIdeBridge={noop} onToggleIdeBridgeRoute={noop} onOpenBookmarks={noop} onOpenProvenance={noop}
      onOpenRemoteAccess={noop} onOpenPlugins={noop} />
  </SidebarProvider>
}

createRoot(document.getElementById('root')!).render(<Fixture />)
