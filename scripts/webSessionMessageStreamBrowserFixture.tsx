import { StrictMode, useCallback, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { useSessionMessageStream } from '../components/session-reader/useSessionMessageStream'
import type { MessageStreamPayload } from '../components/session-reader/messageStream'
import type { Session } from '../lib/types'

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
const poll = async () => {}
function Fixture() {
  const [instance, setInstance] = useState('work')
  const [enabled, setEnabled] = useState(true)
  const [pending, setPending] = useState(false)
  const [title, setTitle] = useState('Initial')
  const [messages, setMessages] = useState(0)
  const count = useRef(100)
  const onMessages = useCallback((_payload: MessageStreamPayload) => setMessages(value => value + 1), [])
  const session: Session = { sessionId: 'same-id', provider: 'codex', providerInstanceId: instance, customTitle: title, isPending: pending }
  const { todos, plan } = useSessionMessageStream({ session, enabled, messageCountRef: count, onMessages, poll })
  return <>
    <button onClick={() => setInstance(value => value === 'work' ? 'personal' : 'work')}>Switch instance</button>
    <button onClick={() => setEnabled(value => !value)}>Toggle visibility</button>
    <button onClick={() => setPending(value => !value)}>Toggle pending</button>
    <button onClick={() => setTitle(value => value + '!')}>Refresh metadata</button>
    <output>{JSON.stringify({ instance, todos, plan, messages })}</output>
  </>
}
const root = createRoot(document.getElementById('root')!)
Object.assign(window, { __unmount: () => root.unmount() })
root.render(<StrictMode><Fixture /></StrictMode>)
