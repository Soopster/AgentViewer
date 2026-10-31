import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import CrossSessionMessaging from '../components/cross-session-messaging/CrossSessionMessaging'
import StandaloneMessaging from '../components/cross-session-messaging/StandaloneMessaging'

const requests: Array<{ url: string; init?: RequestInit; resolve: (body: unknown, status?: number) => void }> = []
let visible = true
Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visible ? 'visible' : 'hidden' })
Object.assign(window, { __requests: requests,
  fetch: (url: string, init?: RequestInit) => new Promise<Response>(resolve => {
    requests.push({ url, init, resolve: (body, status = 200) => resolve(new Response(JSON.stringify(body), { status })) })
  }),
})
const params = new URLSearchParams(location.search)
const root = createRoot(document.getElementById('root')!)
root.render(<StrictMode>
  <button onClick={() => { visible = !visible; document.dispatchEvent(new Event('visibilitychange')) }}>Toggle visibility</button>
  {params.has('standalone') ? <StandaloneMessaging initialRecipient={params.get('to') ?? undefined} /> : <CrossSessionMessaging />}
</StrictMode>)
Object.assign(window, { __unmount: () => root.unmount() })
