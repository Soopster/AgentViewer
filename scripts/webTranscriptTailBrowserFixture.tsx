import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import MessageView from '../components/MessageView'
import type { Session, SessionMessage } from '../lib/types'

const session: Session = { sessionId: 'tail-fixture', provider: 'codex', summary: 'Transcript tail fixture', cwd: '/fixture' }
const initialMessages: SessionMessage[] = Array.from({ length: 60 }, (_, index) => ({
  uuid: `message-${index}`, session_id: session.sessionId, provider: 'codex',
  type: index % 2 === 0 ? 'user' : 'assistant', parent_tool_use_id: null,
  message: { role: index % 2 === 0 ? 'user' : 'assistant', content: [
    { type: 'text', text: `Message ${index}: ${'Transcript content for measuring stable bottom alignment. '.repeat(index % 5 + 1)}` },
  ] },
}))

function Fixture() {
  const [messages, setMessages] = useState(initialMessages)
  useEffect(() => {
    const timer = window.setInterval(() => setMessages(previous => structuredClone(previous)), 200)
    const append = () => setMessages(previous => [...previous, {
      ...initialMessages[1]!, uuid: `message-${previous.length}`,
      message: { role: 'assistant', content: [{ type: 'text', text: 'A new message at the live edge. '.repeat(10) }] },
    }])
    const grow = () => setMessages(previous => previous.map((message, index) => index === previous.length - 1 ? {
      ...message, timestamp: new Date().toISOString(),
      message: { role: 'assistant', content: [{ type: 'text', text: `Growing final response.\n${'Another line of the streamed response.\n'.repeat(growth++)}` }] },
    } : message))
    let growth = 8
    window.addEventListener('fixture-append', append)
    window.addEventListener('fixture-grow', grow)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('fixture-append', append)
      window.removeEventListener('fixture-grow', grow)
    }
  }, [])
  return <div style={{ height: '100vh', display: 'flex', minHeight: 0 }}>
    <MessageView messages={messages} loading={false} session={session} hideCoordinator />
  </div>
}

createRoot(document.getElementById('root')!).render(<Fixture />)
