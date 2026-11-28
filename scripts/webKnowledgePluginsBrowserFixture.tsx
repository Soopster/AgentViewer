import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { module as memory } from '../plugins/project-memory/web'
import { module as packs } from '../plugins/workflow-packs/web'
import { webProjectMemory } from '../components/shell/projectMemoryService'
import { webPlaybooks } from '../components/shell/playbooksService'
import type { WebPluginViewProps } from '../components/shell/pluginTypes'
const cwd = (window as unknown as { KNOWLEDGE_CWD: string }).KNOWLEDGE_CWD
const useFixtureState: WebPluginViewProps['useState'] = (_name, initial) => useState(initial)
const target = { provider: 'codex' as const, providerInstanceId: 'work', sessionId: 'source-session' }
function Fixture() {
  const [view, setView] = useState<'memory' | 'packs'>('memory'), [open, setOpen] = useState(true), [source, setSource] = useState('')
  const View = view === 'memory' ? memory.views['project-memory']! : packs.views['workflow-packs']!, id = view === 'memory' ? 'project-memory' : 'workflow-packs'
  const services = { 'project-memory': webProjectMemory, playbooks: webPlaybooks, repository: { cwd, sessionId: target.sessionId }, session: { session: { ...target, cwd } }, 'session-transcript': { info: null, threadedMessages: [], rawMessages: [{ type: 'assistant' as const, uuid: 'source-reply', session_id: target.sessionId, parent_tool_use_id: null, message: { role: 'assistant' as const, content: 'Preserve provider-instance identity in asynchronous actions.' } }] }, 'session-navigation': { open: (session: unknown, message?: string) => setSource(JSON.stringify({ session, message })) } }
  return <><button onClick={() => { setView('memory'); setOpen(true) }}>Memory view</button><button onClick={() => { setView('packs'); setOpen(true) }}>Workflow view</button><button onClick={() => setOpen(!open)}>Toggle plugin</button><output aria-label="Opened source">{source}</output>{open ? <div style={{ height: 850 }}><View pluginId={id} surfaceId={id} instanceId="knowledge-fixture" placement="panel" target={{ cwd, sessionKey: 'source' }} services={services} close={() => setOpen(false)} useState={useFixtureState} onDispose={() => () => {}} /></div> : null}</>
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Fixture /></React.StrictMode>)
