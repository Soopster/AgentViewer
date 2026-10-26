/** @jsxImportSource @opentui/react */
// Feature plugin host, in the real App: a plugin's view module is not loaded
// at boot or by browsing, only by opening it; a view that throws leaves a local
// Retry/Close view while the transcript and composer keep working; Retry
// remounts it; and a module that fails to load is retried on demand. Scoped
// state survives the overlay → window move.
import React from 'react'
import { testRender, act } from './testRender'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Session } from '../../lib/types'
import type { TuiTranscriptCard } from '../format'
import type { TuiPluginViewProps } from './shell/pluginTypes'

const CWD = mkdtempSync(path.join(tmpdir(), 'agent-viewer-plugin-host-'))
process.env.SHELL = '/bin/sh'
process.chdir(CWD)
execFileSync('git', ['init', '-q'])
writeFileSync('README.md', 'fixture\n')
execFileSync('git', ['add', '.'])
execFileSync('git', ['-c', 'user.name=Smoke', '-c', 'user.email=smoke@example.test', 'commit', '-qm', 'fixture'])

const bunTestSpecifier = 'bun:test'
const { mock } = await import(bunTestSpecifier) as { mock: { module(specifier: string, factory: () => unknown): void } }

const SESSIONS: Session[] = ['alpha', 'bravo'].map((name, index) => ({
  sessionId: `plug-${name}`, provider: 'claude', cwd: CWD, summary: `Plug ${name}`, firstPrompt: `Plug ${name}`, lastModified: 1_700_000_000_000 - index * 1000,
}))
const marker = (session: Session) => `${session.sessionId.toUpperCase()}-BODY`
const cardsFor = (session: Session): TuiTranscriptCard[] => [{
  key: `${session.sessionId}-card`, role: 'assistant', provider: 'claude', label: 'Assistant', category: 'conversation', autoFold: false,
  compactSummary: marker(session), lines: [{ text: marker(session), tone: 'default' }], expandedLines: [{ text: marker(session), tone: 'default' }],
  searchText: marker(session), searchHaystackLower: marker(session).toLowerCase(),
}]
const detailFor = (session: Session) => ({
  info: { sessionId: session.sessionId, provider: 'claude' as const, cwd: CWD },
  rawMessages: [], threadedMessages: [], transcriptCards: cardsFor(session),
  transcriptCardsDensity: 'balanced' as const, transcriptCardsShowToolCalls: true, contextUsage: null,
})
const detailClient = await import('./sessionDetailWorkerClient')
mock.module('./sessionDetailWorkerClient', () => ({ ...detailClient, readTuiSessionsAsync: async () => SESSIONS.map((session) => ({ ...session })), readTuiSessionDetailAsync: async (session: Session) => detailFor(session) }))
const threadingClient = await import('./threadingWorkerClient')
mock.module('./threadingWorkerClient', () => ({ ...threadingClient, getTranscriptCardsSync: (session: Session) => cardsFor(session), formatTranscriptCardsAsync: async (session: Session) => cardsFor(session) }))
const metadataClient = await import('./metadataWorkerClient')
mock.module('./metadataWorkerClient', () => ({ ...metadataClient, readTuiSessionMetadataAsync: async () => ({ currentModel: null, contextUsage: null }) }))
const service = await import('../../lib/tui/service')
// Anything that would stop a run or change a team: closing or turning off a
// coordination view must call none of it.
const coordinationMutations: string[] = []
mock.module('../../lib/tui/service', () => ({
  ...service,
  readTuiSessionCoordinator: async () => null,
  sendTuiSessionCoordination: async (...args: unknown[]) => { coordinationMutations.push(`send ${JSON.stringify(args[2])}`); throw new Error('not in this smoke') },
  stopTuiProtocolRun: async (runId: string) => { coordinationMutations.push(`stop ${runId}`); return null },
  deleteTuiProtocolRun: async (runId: string) => { coordinationMutations.push(`delete ${runId}`); return null },
  interruptTuiSessionTurn: async () => { coordinationMutations.push('interrupt'); return [] },
  readTuiSessions: async () => SESSIONS.map((session) => ({ ...session })),
  readTuiSessionDetail: async (session: Session) => detailFor(session),
  readTuiSessionMetadata: async () => ({ models: [], currentModel: null, contextUsage: null }),
  readTuiRuntimeActivity: async () => ({ running: [], waiting: [], attention: [] }),
  listTuiRunningSessions: async () => [],
  prewarmTuiSession: async () => {},
}))

// The Analytics plugin's view, instrumented: it throws on its first render, and
// counts every module evaluation so laziness is observable.
let moduleEvaluations = 0
// React retries a failed render once synchronously, so the failure persists until the test lifts it.
let failing = true
mock.module(fileURLToPath(new URL('../../plugins/analytics/tui/index.tsx', import.meta.url)), () => {
  moduleEvaluations += 1
  function FixtureAnalytics({ theme, placement, useState, registerKeys, close }: TuiPluginViewProps) {
    const [visits, setVisits] = useState('visits', 0)
    React.useEffect(() => { setVisits((value) => value + 1) }, [])
    React.useEffect(() => { registerKeys((key) => { if (key.name === 'escape') close() }) }, [registerKeys, close])
    if (failing) throw new Error('fixture render failure')
    const overlay = placement === 'overlay'
    return <text id="fixture-analytics" fg={theme.text} {...(overlay ? { position: 'absolute' as const, top: 3, left: 40, zIndex: 50 } : {})}>FIXTURE ANALYTICS visits={visits}</text>
  }
  return { module: { apiVersion: 1, pluginId: 'analytics', views: { analytics: FixtureAnalytics } } }
})

const { tuiPluginViews } = await import('./shell/pluginViews')
const { default: OpenTuiApp } = await import('./App')
const setup = await testRender(<OpenTuiApp />, { width: 180, height: 44, kittyKeyboard: true })
const settle = async (ms = 150) => {
  for (let elapsed = 0; elapsed < ms; elapsed += 30) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)) })
}
const screen = () => setup.captureCharFrame()
const fail = (message: string): never => {
  console.error(`${message}\n${screen()}`)
  process.exit(1)
}
const check = (condition: unknown, message: string) => { if (!condition) fail(message) }
const waitFor = async (label: string, test: () => boolean) => {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    if (test()) return
    await settle(80)
  }
  fail(`Timed out: ${label}`)
}
const key = async (name: string, modifiers: { ctrl?: boolean; shift?: boolean } = {}) => {
  await act(async () => {
    if (name === 'escape') setup.mockInput.pressEscape()
    else if (name === 'return') setup.mockInput.pressEnter()
    else setup.mockInput.pressKey(name, modifiers)
  })
  await settle(200)
}

await waitFor('the app to render', () => screen().includes('SESSIONS') || screen().includes('New workspace'))
if (screen().includes('New workspace')) await key('return')
await waitFor('the transcript on alpha', () => screen().includes('PLUG-ALPHA-BODY'))
// Browsing does not activate a plugin.
await key('j')
await key('k')
await settle(300)
check(moduleEvaluations === 0 && !tuiPluginViews.isLoaded('analytics'), `browsing loaded the analytics plugin (${moduleEvaluations} evaluations)`)

// ⌃A opens it: one load, and a render failure stays local.
await key('a', { ctrl: true })
await waitFor('the failure view', () => screen().includes('Analytics stopped: fixture render failure'))
check(moduleEvaluations === 1 && tuiPluginViews.isLoaded('analytics'), 'opening did not load the plugin exactly once')
check(screen().includes('PLUG-ALPHA-BODY'), 'a plugin failure took the transcript down')
check(screen().includes('Sending to'), 'a plugin failure took the composer down')
// Retry remounts the view; the module is not evaluated again.
failing = false
await key('r')
await waitFor('the retried view', () => screen().includes('FIXTURE ANALYTICS visits='))
check(moduleEvaluations === 1, 'retrying a render failure re-evaluated the module')
const firstVisits = Number(/visits=(\d+)/.exec(screen())![1])
// Scoped state survives the move into a window (⌃⇧W), and keys still route.
await key('w', { ctrl: true, shift: true })
await waitFor('placement choice or window', () => screen().includes('beside') || !!setup.renderer.root.findDescendantById('surface-frame:analytics'))
if (!setup.renderer.root.findDescendantById('surface-frame:analytics')) await key('return')
await waitFor('analytics in a window', () => !!setup.renderer.root.findDescendantById('surface-frame:analytics') && screen().includes('FIXTURE ANALYTICS'))
const movedVisits = Number(/visits=(\d+)/.exec(screen())![1])
check(movedVisits === firstVisits + 1, `scoped state did not survive the move to a window: ${firstVisits} → ${movedVisits}`)
console.log('A plugin loads on first open only, a render failure stays local and retries, and scoped state survives overlay → window.')

// Git is a plugin too: ⌃G loads it on demand, a full-screen overlay takes the
// keys, and p hands over to pull requests through the host's command dispatch.
await key('escape')
await key('b', { ctrl: true }); await key('1')
check(!tuiPluginViews.isLoaded('git'), 'the Git plugin loaded before it was opened')
await key('g', { ctrl: true })
await waitFor('the Git overlay', () => screen().includes('[1] Status'))
check(tuiPluginViews.isLoaded('git'), 'Git opened without its plugin module')
await key('escape')
await waitFor('Git closed', () => !screen().includes('[1] Status'))

// The plugin manager turns Git off: ⌃G then says so and opens nothing, and the
// choice is on disk for the next launch and the web daemon.
const { isPluginEnabled } = await import('../../lib/plugins/enablement')
const { readPluginSettingsFile } = await import('../../lib/plugins/settingsFile')
await key('?')
await settle(250)
await act(async () => { await setup.mockInput.typeText('Plugins: turn') })
await settle(200)
await key('return')
await waitFor('the plugin manager', () => !!setup.renderer.root.findDescendantById('plugin-manager'))
check(screen().includes('Session analytics') && screen().includes('● Git') && screen().includes('on'), 'the manager does not list both plugins as on')
await key('j')
await key(' ')
await waitFor('Git off', () => screen().includes('○ Git'))
check(!isPluginEnabled('git') && readPluginSettingsFile().disabled.includes('git'), 'turning Git off was not applied and saved')
await key('escape')
await waitFor('the manager closed', () => !setup.renderer.root.findDescendantById('plugin-manager'))
await key('g', { ctrl: true })
await settle(300)
check(!screen().includes('[1] Status') && screen().includes('Git status is off'), 'a disabled plugin still opened, or said nothing')
await key('?')
await settle(250)
await act(async () => { await setup.mockInput.typeText('Git status') })
await settle(200)
check(!screen().includes('⌃G'), 'the palette still offers a disabled plugin\'s command')
await key('escape')
// And back on.
await key('?')
await settle(250)
await act(async () => { await setup.mockInput.typeText('Plugins: turn') })
await settle(200)
await key('return')
await waitFor('the plugin manager again', () => !!setup.renderer.root.findDescendantById('plugin-manager'))
await key('j')
await key('return')
await waitFor('Git on', () => screen().includes('● Git'))
await key('escape')
await key('g', { ctrl: true })
await waitFor('the Git overlay after re-enabling', () => screen().includes('[1] Status'))
check(isPluginEnabled('git') && !readPluginSettingsFile().disabled.includes('git'), 'turning Git back on was not saved')
await key('escape')
console.log('Git opens as a lazy plugin; the plugin manager turns it off (no command, no binding, saved) and back on.')

// Files is a plugin, and the new-session folder picker is its view in picker mode.
check(!tuiPluginViews.isLoaded('files'), 'the Files plugin loaded before it was opened')
await key('f', { ctrl: true })
await waitFor('the Files overlay', () => screen().includes(' Files '))
check(tuiPluginViews.isLoaded('files'), 'Files opened without its plugin module')
await key('escape')
await waitFor('Files closed', () => !screen().includes(' Files '))
await key('n', { shift: true })
await waitFor('the new-session modal', () => screen().includes('Folder') || screen().includes('folder'))
await key('b')
await waitFor('the folder picker', () => screen().includes(' Choose folder '))
await key('o')
await waitFor('back in the new-session modal', () => !screen().includes(' Choose folder ') && screen().includes(path.basename(CWD)))
await key('escape')
const { applyPluginSettings, withPluginEnabled, DEFAULT_PLUGIN_SETTINGS } = await import('../../lib/plugins/enablement')
applyPluginSettings(withPluginEnabled(DEFAULT_PLUGIN_SETTINGS, 'files', false))
await settle(100)
await key('n', { shift: true })
await settle(300)
await key('b')
await settle(300)
check(!screen().includes(' Choose folder ') && screen().includes('Folder browsing needs Files'), 'the folder picker opened with Files off, or said nothing')
await key('escape')
applyPluginSettings(DEFAULT_PLUGIN_SETTINGS)
console.log('Files opens as a lazy plugin; the new-session folder picker is its view, and says so when Files is off.')

// The editor is a plugin: ⌃E loads it on demand, and its buffers are the
// root's, so an unsaved edit survives full screen → window → full screen.
check(!tuiPluginViews.isLoaded('editor'), 'the editor plugin loaded before it was opened')
await key('e', { ctrl: true })
await waitFor('the editor overlay', () => !!setup.renderer.root.findDescendantById('plugin-editor-probe') || screen().includes('Explorer') || screen().includes('EXPLORER'))
check(tuiPluginViews.isLoaded('editor'), 'the editor opened without its plugin module')
await key('p', { ctrl: true })
await settle(300)
await act(async () => { await setup.mockInput.typeText('README') })
await settle(300)
await key('return')
await waitFor('README open in the editor', () => screen().includes('fixture'))
await act(async () => { await setup.mockInput.typeText('UNSAVEDEDIT') })
await waitFor('the edit in the buffer', () => screen().includes('UNSAVEDEDIT'))
await key('w', { ctrl: true, shift: true })
await waitFor('placement choice or window', () => screen().includes('beside') || !!setup.renderer.root.findDescendantById('surface-frame:editor'))
if (!setup.renderer.root.findDescendantById('surface-frame:editor')) await key('return')
await waitFor('the editor in a window', () => !!setup.renderer.root.findDescendantById('surface-frame:editor'))
await waitFor('the edit survived the move to a window', () => screen().includes('UNSAVEDEDIT'))
await key('w', { ctrl: true, shift: true })
await waitFor('the editor back full screen', () => !setup.renderer.root.findDescendantById('surface-frame:editor'))
await waitFor('the edit survived the move back', () => screen().includes('UNSAVEDEDIT'))
await key('escape')
await settle(300)
applyPluginSettings(withPluginEnabled(DEFAULT_PLUGIN_SETTINGS, 'editor', false))
await settle(200)
check(!screen().includes('UNSAVEDEDIT'), 'turning the editor off left its overlay open')
await key('b', { ctrl: true }); await key('1')
await key('e', { ctrl: true })
await settle(300)
check(!screen().includes('UNSAVEDEDIT') && screen().includes('Open project editor is off'), 'a disabled editor still opened, or said nothing')
applyPluginSettings(DEFAULT_PLUGIN_SETTINGS)
console.log('The editor opens as a lazy plugin and keeps an unsaved edit across full screen → window → full screen.')

// Coordination: the control center and the teammates panel are one lazy
// plugin; the desk another. Closing or turning a view off leaves the team (the
// interactive coordinator store, its session and feed) as it was, and calls
// nothing that stops a run or a teammate.
const portable = async (letter: string) => { await key('k', { ctrl: true }); await key(letter) }
check(!tuiPluginViews.isLoaded('coordination'), 'the Coordination plugin loaded before a coordination view was opened')
check(!tuiPluginViews.isLoaded('desk'), 'the Desk plugin loaded before the desk was opened')
await portable('a')
await waitFor('the control center', () => screen().includes('AGENT CONTROL CENTER'))
check(tuiPluginViews.isLoaded('coordination'), 'the control center opened without its plugin module')
await key('escape')
await waitFor('the control center closed', () => !screen().includes('AGENT CONTROL CENTER'))
await key('a', { ctrl: true, shift: true })
await waitFor('the control center from ⌃⇧A', () => screen().includes('AGENT CONTROL CENTER'))
await key('escape')
await waitFor('the control center closed again', () => !screen().includes('AGENT CONTROL CENTER'))
const coordinatorStore = await import('./interactiveCoordinatorStore')
await portable('t')
await waitFor('the teammates panel', () => coordinatorStore.isInteractiveCoordinatorOpen() && screen().includes(' Teammates '))
const teamSession = coordinatorStore.getInteractiveCoordinatorState().session
check(teamSession?.sessionId === SESSIONS[0]!.sessionId, `the teammates panel opened for ${teamSession?.sessionId ?? 'nothing'}`)
// The attention badge observes the conversation's team without the panel.
const releaseObservation = coordinatorStore.observeInteractiveCoordinator(teamSession!)
applyPluginSettings(withPluginEnabled(DEFAULT_PLUGIN_SETTINGS, 'coordination', false))
await waitFor('the teammates panel closed by turning Coordination off, saying why', () => !coordinatorStore.isInteractiveCoordinatorOpen() && screen().includes('Teammates are off'))
const kept = coordinatorStore.getInteractiveCoordinatorState()
check(kept.session?.sessionId === teamSession!.sessionId, 'turning the view off dropped the conversation\'s team from the store')
check(coordinationMutations.length === 0, `closing or turning off a coordination view changed the team: ${coordinationMutations.join(', ')}`)
await portable('a')
await settle(300)
check(!screen().includes('AGENT CONTROL CENTER') && screen().includes('Open Agent Operations is off'), 'a disabled control center still opened, or said nothing')
await portable('t')
await settle(300)
check(!coordinatorStore.isInteractiveCoordinatorOpen() && !screen().includes('TEAMMATES') && screen().includes('Teammates for this conversation is off'), 'a disabled teammates panel still opened, or said nothing')
// The attention badge opens the store directly; the host refuses it too.
coordinatorStore.openInteractiveCoordinatorAttention()
coordinatorStore.openInteractiveCoordinator(teamSession!)
await settle(300)
check(!coordinatorStore.isInteractiveCoordinatorOpen(), 'the teammates panel opened from the store with Coordination off')
check(coordinatorStore.getInteractiveCoordinatorState().session?.sessionId === teamSession!.sessionId, 'refusing the panel dropped the team')
releaseObservation()
applyPluginSettings(DEFAULT_PLUGIN_SETTINGS)
console.log('Coordination opens as a lazy plugin (⌃K a, ⌃⇧A, ⌃K t); turning it off closes its views, refuses openers with a notice, and leaves the team untouched.')

await portable('b')
await waitFor('the desk', () => screen().includes('AGENT VIEWER ▸ DESK'))
check(tuiPluginViews.isLoaded('desk'), 'the desk opened without its plugin module')
await key('escape')
await waitFor('the desk closed', () => !screen().includes('AGENT VIEWER ▸ DESK'))
applyPluginSettings(withPluginEnabled(DEFAULT_PLUGIN_SETTINGS, 'desk', false))
await settle(100)
await portable('b')
await settle(300)
check(!screen().includes('AGENT VIEWER ▸ DESK') && screen().includes('Bloomberg-style desk is off'), 'a disabled desk still opened, or said nothing')
applyPluginSettings(DEFAULT_PLUGIN_SETTINGS)
console.log('The desk opens as a lazy plugin from ⌃K b and refuses with a notice when turned off.')

// A module that fails to load is evicted and loads on the next attempt.
const { PluginSurfaceHost, pluginInstanceId } = await import('./shell/PluginSurfaceHost')
let loadAttempts = 0
const flakyRegistry = {
  peek: () => undefined,
  load: async () => {
    loadAttempts += 1
    if (loadAttempts === 1) throw new Error('chunk offline')
    return { apiVersion: 1 as const, pluginId: 'analytics', views: { analytics: ({ theme }: TuiPluginViewProps) => <text fg={theme.text}>LOADED AFTER RETRY</text> } }
  },
}
let hostKeys: ((key: { name: string; ctrl: boolean; shift: boolean; sequence: string }) => void) | null = null
let closed = 0
const { DARK_THEME: theme } = await import('../theme')
const host = await testRender(
  <PluginSurfaceHost surfaceId="analytics" placement="window" session={null} sessionKey={null} selected={{ key: null, detail: null }}
    density="balanced" showToolCalls shouldYield={() => false} theme={theme} width={60} height={6} focused
    onClose={() => { closed += 1 }} onKeyHandlerReady={(handler) => { hostKeys = handler }} registry={flakyRegistry} />,
  { width: 60, height: 6 },
)
const hostScreen = () => host.captureCharFrame()
for (let i = 0; i < 20 && !hostScreen().includes('chunk offline'); i += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) })
check(hostScreen().includes('Analytics stopped: chunk offline') && hostScreen().includes('r retry'), `no load-failure view:\n${hostScreen()}`)
await act(async () => { hostKeys!({ name: 'r', ctrl: false, shift: false, sequence: 'r' }) })
for (let i = 0; i < 20 && !hostScreen().includes('LOADED AFTER RETRY'); i += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) })
check(hostScreen().includes('LOADED AFTER RETRY') && loadAttempts === 2, `retry did not reload the module:\n${hostScreen()}`)
await act(async () => { hostKeys!({ name: 'escape', ctrl: false, shift: false, sequence: '\u001b' }) })
check(closed === 1, 'Escape on a view without its own keys did not close it')
check(pluginInstanceId('analytics', 'claude:a') !== pluginInstanceId('analytics', 'claude@work:a'), 'two instances of one native id share plugin state')
console.log('A failed module load shows Retry/Close and reloads on r; pinned instances are keyed per provider instance.')
process.exit(0)
