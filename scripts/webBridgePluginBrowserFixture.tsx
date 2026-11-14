import { StrictMode, useCallback, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import PluginSurfaceHost from '../components/shell/PluginSurfaceHost'
import type { WebPluginServices } from '../components/shell/pluginTypes'
import type { ChannelBridgeLogEntry, ChannelBridgeViewService, IdeBridgeLogEntry, IdeBridgeViewService } from '../lib/plugins/bridges'
import { dispatchPluginCommand, subscribePluginCommands } from '../lib/plugins/commandBus'
import { getPluginCommand } from '../lib/plugins/catalog'
import { applyPluginSettings, isPluginEnabled, readPluginSettings, withPluginEnabled } from '../lib/plugins/enablement'
import { useDisabledPlugins } from '../lib/plugins/useDisabledPlugins'

const accent = { cssVar: '--cyan', cssRgb: '56,217,245', label: 'Claude' }
const permission: ChannelBridgeLogEntry = { kind: 'permission', id: 'permission', request: { type: 'permission_request', request_id: 'fixture-request', tool_name: 'Bash', description: 'Approve fixture command', input_preview: 'echo fixture' } }
const pending: Array<{ resolve: () => void; reject: (error: Error) => void }> = []
const sent: Array<{ kind: string; account: string; text: string }> = []
const responses: string[] = []
Object.assign(window, { __bridgePending: pending, __bridgeSent: sent, __bridgeResponses: responses })

function Fixture() {
  const [surface, setSurface] = useState<'channel-bridge' | 'ide-bridge' | null>(null)
  const [placement, setPlacement] = useState<'overlay' | 'window'>('overlay')
  const [account, setAccount] = useState('personal')
  const [channelInterest, setChannelInterest] = useState(0)
  const [ideInterest, setIdeInterest] = useState(0)
  const [channelRoute, setChannelRoute] = useState(false)
  const [ideRoute, setIdeRoute] = useState(false)
  const [channelEntries, setChannelEntries] = useState<ChannelBridgeLogEntry[]>([permission])
  const [ideEntries, setIdeEntries] = useState<IdeBridgeLogEntry[]>([])
  const [channelSending, setChannelSending] = useState(false)
  const [ideSending, setIdeSending] = useState(false)
  const [baseUrl, setBaseUrl] = useState('http://fixture.test')
  const [token, setToken] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [comment, setComment] = useState('')
  const [handled, setHandled] = useState(false)
  const disabled = useDisabledPlugins().has('bridges')
  const close = useCallback(() => setSurface(null), [])
  const acquireChannel = useCallback(() => {
    setChannelInterest(count => count + 1)
    let live = true
    return () => { if (live) { live = false; setChannelInterest(count => count - 1) } }
  }, [])
  const acquireIde = useCallback(() => {
    setIdeInterest(count => count + 1)
    let live = true
    return () => { if (live) { live = false; setIdeInterest(count => count - 1) } }
  }, [])
  const channel = useMemo<ChannelBridgeViewService>(() => ({
    accent, acquireView: acquireChannel, baseUrl, setBaseUrl, token, setToken, status: 'connected', entries: channelEntries,
    sending: channelSending, sendError: error, setSendError: setError, routeComposer: channelRoute, setRouteComposer: setChannelRoute, unread: 0,
    async send(text) {
      sent.push({ kind: 'channel', account, text }); setChannelSending(true)
      try { await new Promise<void>((resolve, reject) => pending.push({ resolve, reject })); return { chat_id: 'fixture', message_id: 'fixture', queued: true } }
      finally { setChannelSending(false) }
    },
    async respond(entry, verdict) { responses.push(`permission:${entry.request.request_id}:${verdict}`); setChannelEntries(entries => entries.map(value => value.id === entry.id && value.kind === 'permission' ? { ...value, resolved: verdict } : value)) },
  }), [acquireChannel, baseUrl, token, channelEntries, channelSending, error, channelRoute, account])
  const ide = useMemo<IdeBridgeViewService>(() => ({
    accent, acquireView: acquireIde, baseUrl, setBaseUrl, token, setToken, status: 'connected', claudeConnected: true, entries: ideEntries,
    sending: ideSending, sendError: error, setSendError: setError, routeComposer: ideRoute, setRouteComposer: setIdeRoute, unread: 0,
    async send(text) { sent.push({ kind: 'ide', account, text }); setIdeSending(true); try { await new Promise<void>((resolve, reject) => pending.push({ resolve, reject })); return { delivered: true } } finally { setIdeSending(false) } },
    async respondDiff(entry, verdict) { responses.push(`diff:${entry.request.diff_id}:${verdict}`); setIdeEntries(entries => entries.map(value => value.id === entry.id && value.kind === 'diff' ? { ...value, resolved: verdict } : value)) },
  }), [acquireIde, baseUrl, token, ideEntries, ideSending, error, ideRoute, account])
  useEffect(() => subscribePluginCommands(id => {
    const command = getPluginCommand(id)
    if (!command || !isPluginEnabled(command.pluginId)) return false
    if (command.opens !== 'channel-bridge' && command.opens !== 'ide-bridge') return false
    setSurface(command.opens); return true
  }), [])
  const services = useMemo<WebPluginServices>(() => ({ session: { session: { sessionId: 'same', provider: 'claude', providerInstanceId: account } },
    'channel-bridge': channel, 'ide-bridge': ide, composer: { insertText: text => setComment(`insert:${text}`), attachContext: attachment => setComment(JSON.stringify(attachment)) },
  }), [account, channel, ide])
  const host = surface && <PluginSurfaceHost ownerId="bridge-fixture" surfaceId={surface} placement={placement} sessionKey={`claude@${account}:same`} services={services} onClose={close} />
  return <>
    <div style={{ position: 'relative', zIndex: 100 }}>
      <button onClick={() => setHandled(dispatchPluginCommand('open-channel-bridge'))}>Open CLI</button>
      <button onClick={() => setHandled(dispatchPluginCommand('open-ide-bridge'))}>Open IDE</button>
      <button onClick={() => setPlacement(value => value === 'window' ? 'overlay' : 'window')}>Move placement</button>
      <button onClick={() => setAccount(value => value === 'work' ? 'personal' : 'work')}>Switch account</button>
      <button onClick={() => applyPluginSettings(withPluginEnabled(readPluginSettings(), 'bridges', disabled))}>{disabled ? 'Enable bridges' : 'Disable bridges'}</button>
      <button onClick={() => setIdeEntries(entries => [...entries, { kind: 'diff', id: `diff-${entries.length}`, request: { type: 'open_diff', diff_id: `diff-${entries.length}`, old_file_path: 'fixture.ts', new_file_path: 'fixture.ts', old_file_contents: 'old line', new_file_contents: 'new line', tab_name: 'Fixture diff' } }])}>Inject diff</button>
    </div>
    <output data-testid="handled">{String(handled)}</output>
    <output data-testid="channel-interest">{channelInterest}</output>
    <output data-testid="ide-interest">{ideInterest}</output>
    <output data-testid="channel-routed">{String(channelRoute)}</output>
    <output data-testid="channel-connected">{String(channelRoute || channelInterest > 0)}</output>
    <output data-testid="ide-routed">{String(ideRoute)}</output>
    <output data-testid="ide-connected">{String(ideRoute || ideInterest > 0)}</output>
    <output data-testid="comment">{comment}</output>
    {placement === 'window' ? <section style={{ width: 480, height: 600 }}>{host}</section> : <div>{host}</div>}
  </>
}
createRoot(document.getElementById('root')!).render(<StrictMode><Fixture /></StrictMode>)
