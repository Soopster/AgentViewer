import { StrictMode, useCallback, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { useSessionTranscript } from '../components/session-reader/useSessionTranscript'
import { useProjectTranscript } from '../components/session-reader/useProjectTranscript'
import type { Session } from '../lib/types'

// Requests deliberately ignore cancellation so tests also exercise the guards
// after a fetch/body has already completed when navigation aborts its signal.
const requests: Array<{ url: string; init?: RequestInit; resolve: (body: unknown) => void }> = []
Object.assign(window, {
  __requests: requests,
  fetch: (url: string, init?: RequestInit) => new Promise<Response>(resolve => {
    requests.push({ url, init, resolve: body => resolve(new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })) })
  }),
})
class FixtureSource {
  static instances: FixtureSource[] = []
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  closed = false
  handlers = new Map<string, (event: { data: string }) => void>()
  constructor(readonly url: string) { FixtureSource.instances.push(this) }
  addEventListener(type: string, handler: (event: { data: string }) => void) { this.handlers.set(type, handler) }
  close() { this.closed = true }
  emit(type: string, data: unknown) { this.handlers.get(type)?.({ data: JSON.stringify(data) }) }
}
Object.assign(window, { EventSource: FixtureSource, __streams: FixtureSource.instances })
type Target = { kind: 'session'; session: Session } | { kind: 'project'; dir: string } | null
function Fixture() {
  const [target, setTarget] = useState<Target>(null)
  const [metadata, setMetadata] = useState('')
  const onSessions = useCallback((dir: string, sessions: Session[]) => setMetadata(`${dir}:${sessions[0]?.summary ?? ''}`), [])
  const session = useSessionTranscript({ session: target?.kind === 'session' ? target.session : null, visible: true })
  const project = useProjectTranscript({ dir: target?.kind === 'project' ? target.dir : null,
    provider: 'codex', providerInstanceId: 'work', includeWorktrees: true, visible: true, onSessions })
  const loadSession = (id: string, anchor?: string, pending = false) => {
    project.clear()
    const next: Session = { sessionId: id, provider: 'codex', providerInstanceId: 'work', isPending: pending }
    setTarget({ kind: 'session', session: next })
    void session.load(next, anchor)
  }
  const loadProject = async (dir: string) => {
    session.clear()
    setTarget({ kind: 'project', dir })
    const sessions = await project.load(dir)
    if (sessions) onSessions(dir, sessions)
  }
  const resource = target?.kind === 'project' ? project : session
  return <>
    <button onClick={() => loadSession('a')}>Session A</button>
    <button onClick={() => loadSession('b')}>Session B</button>
    <button onClick={() => loadSession('b', 'anchor')}>Deep link</button>
    <button onClick={() => loadSession('pending', undefined, true)}>Pending</button>
    <button onClick={() => { void loadProject('/alpha') }}>Project alpha</button>
    <button onClick={() => { void loadProject('/beta') }}>Project beta</button>
    <button onClick={() => { session.clear(); project.clear(); setTarget(null) }}>Clear</button>
    <output>{JSON.stringify({ target, loading: resource.loading, messages: resource.messages.map(message => message.uuid),
      externalWriter: session.externalWriter, metadata })}</output>
  </>
}
const root = createRoot(document.getElementById('root')!)
Object.assign(window, { __unmount: () => root.unmount() })
root.render(<StrictMode><Fixture /></StrictMode>)
