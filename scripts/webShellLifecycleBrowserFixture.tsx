import { StrictMode, useCallback, useEffect, useState } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { useReaderPresentation } from '../components/shell/useReaderPresentation'
import { useShellShortcuts } from '../components/shell/useShellShortcuts'
import { useDocumentVisible } from '../components/shell/useDocumentVisible'
import { useTeamAttention } from '../components/shell/useTeamAttention'
import { subscribePluginCommands } from '../lib/plugins/commandBus'

const requests: Array<{ signal?: AbortSignal | null; resolve: (body: unknown) => void }> = []
const events: string[] = []
const hydrationErrors: string[] = []
let visible = !new URLSearchParams(location.search).has('hidden')
let nativeFullscreen: Element | null = null
let rejectFullscreen = false
Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visible ? 'visible' : 'hidden' })
Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => nativeFullscreen })
document.documentElement.requestFullscreen = async () => {
  if (rejectFullscreen) throw new Error('Fixture rejected fullscreen')
  nativeFullscreen = document.documentElement
  document.dispatchEvent(new Event('fullscreenchange'))
}
document.exitFullscreen = async () => {
  await Promise.resolve()
  nativeFullscreen = null
  document.dispatchEvent(new Event('fullscreenchange'))
}
Object.assign(window, { __requests: requests, __events: events, __hydrationErrors: hydrationErrors,
  __rejectFullscreen: (value: boolean) => { rejectFullscreen = value },
  fetch: (_url: string, init?: RequestInit) => new Promise<Response>(resolve => {
    requests.push({ signal: init?.signal, resolve: body => resolve(new Response(JSON.stringify(body))) })
  }),
})
function Fixture() {
  const [canMaximize, setCanMaximize] = useState(true)
  const [repositoryAvailable, setRepositoryAvailable] = useState(true)
  const [, rerender] = useState(0)
  const record = useCallback((event: string) => { events.push(event); rerender(value => value + 1) }, [])
  const presentation = useReaderPresentation(canMaximize)
  const visible = useDocumentVisible()
  const attention = useTeamAttention(visible)
  const togglePanel = useCallback(() => record('panel'), [record])
  const togglePalette = useCallback(() => record('palette'), [record])
  useShellShortcuts({ repositoryAvailable, onToggleRightPanel: togglePanel, onToggleCommandPalette: togglePalette })
  useEffect(() => subscribePluginCommands(command => { record(command); return true }), [record])
  useEffect(() => { Object.assign(window, { __attention: attention }) }, [attention])
  return <>
    <button onClick={presentation.togglePane}>Toggle pane</button>
    <button onClick={presentation.toggleMaximized}>Toggle maximize</button>
    <button onClick={presentation.enterFullscreen}>Fullscreen</button>
    <button onClick={() => setCanMaximize(value => !value)}>Toggle eligibility</button>
    <button onClick={() => setRepositoryAvailable(value => !value)}>Toggle repository</button>
    <button onClick={() => window.dispatchEvent(new Event('fixture-visibility'))}>Toggle visibility</button>
    <input aria-label="Consumed shortcuts" onKeyDown={event => event.preventDefault()} />
    <output>{JSON.stringify({ collapsed: presentation.paneCollapsed, maximized: presentation.maximized,
      fullscreen: presentation.fullscreen, visible, attention, events })}</output>
  </>
}
window.addEventListener('fixture-visibility', () => { visible = !visible; document.dispatchEvent(new Event('visibilitychange')) })
const ui = <StrictMode><Fixture /></StrictMode>
const container = document.getElementById('root')!
const serverHtml = renderToString(ui)
Object.assign(window, { __serverHtml: serverHtml })
container.innerHTML = serverHtml
const root = hydrateRoot(container, ui, { onRecoverableError: error => hydrationErrors.push(String(error)) })
Object.assign(window, { __unmount: () => root.unmount() })
