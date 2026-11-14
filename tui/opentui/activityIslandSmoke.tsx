/** @jsxImportSource @opentui/react */
import assert from 'node:assert/strict'
import { useState } from 'react'
import { act, testRender } from './testRender'
import { DARK_THEME } from '../theme'
import { PluginWidgetHost } from './shell/PluginWidgetHost'
import { PluginSurfaceHost } from './shell/PluginSurfaceHost'
import type { TuiPluginKeyHandler } from './shell/pluginTypes'
import { tuiNotifications } from '../../lib/plugins/notifications'
import { tuiActivityFeed } from '../../lib/plugins/activityFeed'
import { applyPluginSettings, DEFAULT_PLUGIN_SETTINGS, withPluginEnabled } from '../../lib/plugins/enablement'
import { beginPiActivity, completePiActivity, getPiActivitySnapshot } from '../../lib/piActivity'
import { beginProviderLoading } from '../../lib/providerLoading'
import { toast, dismissAllToasts } from './toastStore'
import type { PluginSessionRef } from '../../lib/plugins/bookmarks'
import { usePublishObservedTranscript } from '../../lib/plugins/observedTranscripts'
import type { ThreadedMessage } from '../../lib/threading'

let show: (value: boolean) => void
let resize: (width: number) => void
let keys: TuiPluginKeyHandler | null = null
const opened: PluginSessionRef[] = []
const target = { provider: 'codex' as const, providerInstanceId: 'work', sessionId: 'same' }
const messages: ThreadedMessage[] = [{ role: 'system', uuid: 'bg-start', provider: 'claude', blocks: [{ type: 'claude_system', payload: { type: 'system', subtype: 'task_started', task_id: 'background', description: 'Worker build' } }] } as unknown as ThreadedMessage]
function Fixture() {
  const [expanded, setExpanded] = useState(false)
  const [width, setWidth] = useState(100)
  show = setExpanded; resize = setWidth
  usePublishObservedTranscript('tui', target, messages, { messages: [] })
  return <box width={width} height={30}>
    <box position="absolute" top={5}><text>READER CONTENT</text></box>
    <PluginWidgetHost slot="top-center" theme={DARK_THEME} width={width} height={30} zIndex={48} runCommand={() => setExpanded(value => !value)} />
    <PluginWidgetHost slot="corner" theme={DARK_THEME} width={width} height={30} zIndex={48} />
    <PluginWidgetHost slot="viewport" theme={DARK_THEME} width={width} height={30} zIndex={80} />
    {expanded ? <PluginSurfaceHost surfaceId="activity-island" placement="overlay" theme={DARK_THEME} width={width} height={30} focused
      provided={{ 'session-navigation': { open: value => { opened.push(value) } } }}
      onClose={() => setExpanded(false)} onKeyHandlerReady={value => { keys = value }} /> : null}
  </box>
}
applyPluginSettings(DEFAULT_PLUGIN_SETTINGS)
const setup = await testRender(<Fixture />, { width: 100, height: 30 })
const screen = () => setup.captureCharFrame()
const settle = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)) }); await setup.flush() }
const waitFor = async (label: string, condition: () => boolean) => {
  for (let index = 0; index < 100; index++) { if (condition()) return; await settle() }
  throw new Error(`${label}\n${screen()}`)
}
const press = async (name: string) => { await act(async () => { keys?.({ name, sequence: name, ctrl: false, shift: false }) }); await settle() }
try {
  await waitFor('background task computed in the real worker', () => screen().includes('Worker build'))
  assert(screen().includes('READER CONTENT'), 'compact widget preserves surrounding content')
  await act(async () => { toast.info('SHARED NOTIFICATION', { durationMs: 0 }) })
  await waitFor('island and toast both display a shared notification', () => tuiActivityFeed.getSnapshot().some(item => item.title === 'SHARED NOTIFICATION') && screen().includes('SHARED NOTIFICATION'))
  assert.equal((screen().match(/SHARED NOTIFICATION/g) || []).length, 1, 'running work stays primary while the toast shows the notice')
  await act(async () => { applyPluginSettings(withPluginEnabled(DEFAULT_PLUGIN_SETTINGS, 'toasts', false)) })
  await settle()
  assert(!screen().includes('SHARED NOTIFICATION'), 'disabling toasts removes its presentation while the island keeps its queued notice')
  assert(tuiNotifications.getSnapshot().some(item => item.title === 'SHARED NOTIFICATION'), 'disabling toasts does not clear shared notifications')
  await act(async () => { show(true) })
  await waitFor('expanded island', () => screen().includes('SHARED NOTIFICATION') && screen().includes('Activity'))
  await act(async () => { tuiNotifications.service.show('error', 'Needs review', { target }) })
  await waitFor('error visible', () => screen().includes('Needs review'))
  // Stable order: worker, notification, then the newly arrived error.
  await press('down'); await press('down'); await press('return')
  await waitFor('navigation closes overlay', () => !screen().includes('Activity'))
  assert.equal(opened[0]?.providerInstanceId, 'work')
  await act(async () => { show(true) })
  await waitFor('reopened island', () => screen().includes('Activity'))
  await press('d')
  assert(!screen().includes('Needs review'), 'dismiss removes the selected presentation row')
  await press('escape')
  await act(async () => { resize(24) })
  await settle()
  assert(screen().includes('READER CONTENT'), 'narrow geometry preserves the reader')
  await act(async () => { applyPluginSettings(withPluginEnabled(DEFAULT_PLUGIN_SETTINGS, 'dynamic-island', false)); resize(100) })
  await settle()
  let token = ''
  await act(async () => { token = beginPiActivity('island-smoke', 'Pi startup fixture') })
  await waitFor('Pi falls back when island is disabled', () => screen().includes('Pi activity') && screen().includes('Pi startup fixture'))
  assert(getPiActivitySnapshot().active)
  await act(async () => { applyPluginSettings(DEFAULT_PLUGIN_SETTINGS) })
  await waitFor('Pi folds into re-enabled island', () => !screen().includes('Pi activity') && tuiActivityFeed.getSnapshot().some(item => item.title === 'Pi startup fixture'))
  await act(async () => { completePiActivity(token) })
  let finish: () => void = () => {}
  await act(async () => { applyPluginSettings(withPluginEnabled(DEFAULT_PLUGIN_SETTINGS, 'toasts', false)); finish = beginProviderLoading('codex') })
  await waitFor('provider loading independent of toast plugin', () => tuiActivityFeed.getSnapshot().some(item => item.title === 'Loading Codex…'))
  await act(async () => { finish() })
  console.log('TUI activity island: PASS (real worker and hosts, expansion, keys, instance navigation, dismissal, narrow geometry, independent toasts, Pi fallback and provider startup)')
} finally {
  act(() => { setup.renderer.destroy(); dismissAllToasts(); applyPluginSettings(DEFAULT_PLUGIN_SETTINGS) })
}
process.exit(0)
