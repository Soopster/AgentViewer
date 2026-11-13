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
import type { AddressableSession, SendCrossSessionMessageResult } from '../../lib/crossSessionMessagingTypes'
import type { SessionGoal } from '../../lib/sessionGoals'
import type { ThreadedMessage } from '../../lib/threading'
import type { RunPlaybook, StartProtocolRunParams, StartProtocolRunResult } from '../../lib/agentProtocol'

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
  rawMessages: [], threadedMessages: [{ role: 'user', uuid: `${session.sessionId}-prompt`, blocks: [{ type: 'text', text: `REUSE ${session.sessionId}` }] }] satisfies ThreadedMessage[], transcriptCards: cardsFor(session),
  transcriptCardsDensity: 'balanced' as const, transcriptCardsShowToolCalls: true, contextUsage: null,
})
const detailClient = await import('./sessionDetailWorkerClient')
mock.module('./sessionDetailWorkerClient', () => ({ ...detailClient, readTuiSessionsAsync: async () => SESSIONS.map((session) => ({ ...session })), readTuiSessionDetailAsync: async (session: Session) => detailFor(session) }))
const threadingClient = await import('./threadingWorkerClient')
mock.module('./threadingWorkerClient', () => ({ ...threadingClient, getTranscriptCardsSync: (session: Session) => cardsFor(session), formatTranscriptCardsAsync: async (session: Session) => cardsFor(session) }))
const metadataClient = await import('./metadataWorkerClient')
mock.module('./metadataWorkerClient', () => ({ ...metadataClient, readTuiSessionMetadataAsync: async () => ({ currentModel: null, contextUsage: null }) }))
const service = await import('../../lib/tui/service')
let observedRuntime: Awaited<ReturnType<typeof service.readTuiRuntimeActivity>> = { running: [], waiting: [], attention: [] }
// Anything that would stop a run or change a team: closing or turning off a
// coordination view must call none of it.
const coordinationMutations: string[] = []
let fixtureGoal: SessionGoal | null = null
const goalMutations: string[] = []
const messageTargets: AddressableSession[] = [{ sessionId: 'same', provider: 'codex', providerInstanceId: 'work', address: 'codex@work:same', name: 'PLUGIN-WORK-RECIPIENT', running: true }]
const sentMessages: Array<{ toName: string; text: string; fromAddress?: string }> = []
let releaseMessage: ((result: SendCrossSessionMessageResult) => void) | null = null
const diagnosticsActions: Array<{ sessionId: string; action: string }> = []
let holdDiagnosticsRead = false
let releaseDiagnosticsRead: ((value: Awaited<ReturnType<typeof service.readTuiSessionDiagnostics>>) => void) | null = null
const fixturePlaybook: RunPlaybook = {
  name: 'fixture-workflow', description: 'PLUGIN-PLAYBOOK-DESCRIPTION', maxAgents: 3,
  phases: [{ title: 'Execute', tasks: [{ key: 'work', title: 'Fixture task', detail: 'Keep the complete editor available.', role: 'teammate' }] }],
}
const rootLaunches: StartProtocolRunParams[] = []
const watchedAcceptedRuns: string[] = []
let releaseRootLaunch: ((value: StartProtocolRunResult) => void) | null = null
const acceptedRootRun = {
  snapshot: { run: { id: 'late-native-run', status: 'running', prompt: 'Late fixture run' }, agents: [] },
  sessions: [{ sessionId: 'late-native-session', provider: 'claude', providerInstanceId: 'work', cwd: CWD, summary: 'Late run', isPending: true }],
} as unknown as StartProtocolRunResult
let playbookLists = 0
const playbookReads: Array<{ cwd: string; name: string }> = []
const playbookWrites: RunPlaybook[] = []
let holdPlaybookRead = false
let releasePlaybookRead: ((value: RunPlaybook) => void) | null = null
mock.module('../../lib/tui/service', () => ({
  ...service,
  startTuiProtocolRun: async (params: StartProtocolRunParams) => { rootLaunches.push(params); return new Promise<StartProtocolRunResult>(resolve => { releaseRootLaunch = resolve }) },
  readTuiProtocolRun: async (runId: string) => {
    if (runId === 'late-native-run') { watchedAcceptedRuns.push(runId); return acceptedRootRun.snapshot }
    return service.readTuiProtocolRun(runId)
  },
  listTuiRunPlaybooks: async () => {
    playbookLists += 1
    return { playbooks: [{ name: fixturePlaybook.name, path: path.join(CWD, '.agent-viewer/playbooks/fixture-workflow.json'), phaseCount: 1, taskCount: 1, expectsArgs: false }], invalid: [] }
  },
  readTuiRunPlaybook: async (cwd: string, name: string) => {
    playbookReads.push({ cwd, name })
    if (holdPlaybookRead) return new Promise<RunPlaybook>(resolve => { releasePlaybookRead = resolve })
    return structuredClone(fixturePlaybook)
  },
  writeTuiRunPlaybook: async (_cwd: string, playbook: RunPlaybook) => { playbookWrites.push(structuredClone(playbook)); return { playbook, path: path.join(CWD, playbook.name + '.json') } },
  deleteTuiRunPlaybook: async () => {},
  readTuiSessionGoal: async () => fixtureGoal,
  patchTuiSessionGoal: async (_session: Session, patch: Partial<SessionGoal>) => { goalMutations.push('patch'); fixtureGoal = fixtureGoal ? { ...fixtureGoal, ...patch } : null; return fixtureGoal },
  clearTuiSessionGoal: async () => { goalMutations.push('clear'); fixtureGoal = null },
  readTuiSessionCoordinator: async () => null,
  sendTuiSessionCoordination: async (...args: unknown[]) => { coordinationMutations.push(`send ${JSON.stringify(args[2])}`); throw new Error('not in this smoke') },
  stopTuiProtocolRun: async (runId: string) => { coordinationMutations.push(`stop ${runId}`); return null },
  deleteTuiProtocolRun: async (runId: string) => { coordinationMutations.push(`delete ${runId}`); return null },
  interruptTuiSessionTurn: async () => { coordinationMutations.push('interrupt'); return [] },
  readTuiSessions: async () => SESSIONS.map((session) => ({ ...session })),
  readTuiSessionDetail: async (session: Session) => detailFor(session),
  readTuiSessionMetadata: async () => ({ models: [], currentModel: null, contextUsage: null }),
  readTuiRuntimeActivity: async () => observedRuntime,
  listTuiRunningSessions: async () => [],
  prewarmTuiSession: async () => {},
  listTuiAddressableSessions: async () => messageTargets,
  sendTuiCrossSessionMessage: async (params: { toName: string; text: string; fromAddress?: string }) => { sentMessages.push(params); return new Promise<SendCrossSessionMessageResult>(resolve => { releaseMessage = resolve }) },
  runTuiSessionAction: async (session: Session, input: { action: string }) => { diagnosticsActions.push({ sessionId: session.sessionId, action: input.action }); return {} },
  readTuiSessionDiagnostics: async () => {
    diagnosticsReads += 1
    if (holdDiagnosticsRead) return new Promise<Awaited<ReturnType<typeof service.readTuiSessionDiagnostics>>>(resolve => { releaseDiagnosticsRead = resolve })
    return { sections: [{ id: 'commands', title: 'COMMANDS', items: ['PLUGIN-DIAG-MARKER'] }] }
  },
}))
// The live CLI bridge's subscriptions, counted: the panel holds one and the
// host one more while the panel is open or the composer routes to the bridge.
// Only the panel's may end with the panel.
let diagnosticsReads = 0
let bridgeSubscriptions = 0
const channelBridge = await import('../../lib/channelBridge')
mock.module('../../lib/channelBridge', () => ({
  ...channelBridge,
  subscribeToChannelEvents: () => {
    bridgeSubscriptions += 1
    let live = true
    return () => { if (live) { live = false; bridgeSubscriptions -= 1 } }
  },
}))

// The Analytics plugin's view, instrumented: it throws on its first render, and
// counts every module evaluation so laziness is observable.
let moduleEvaluations = 0
// React retries a failed render once synchronously, so the failure persists until the test lifts it.
// The fixture throws on purpose and the plugin's error boundary must contain it. React
// still reports a contained render error through the global handler, which testRender
// treats as a crashed smoke, so this one expected message is let through.
process.removeAllListeners('uncaughtException')
process.on('uncaughtException', (error) => {
  if (error instanceof Error && error.message === 'fixture render failure') return
  console.error(error)
  process.exit(1)
})
let failing = true
mock.module(fileURLToPath(new URL('../../plugins/analytics/tui/index.tsx', import.meta.url)), () => {
  moduleEvaluations += 1
  function FixtureAnalytics({ theme, placement, useState, registerKeys, close }: TuiPluginViewProps) {
    const [visits, setVisits] = useState('visits', 0)
    const [filters] = useState<string[]>('filters', [])
    check(filters.length === 0, 'object defaults changed unexpectedly')
    React.useEffect(() => { setVisits((value) => value + 1) }, [])
    React.useEffect(() => { registerKeys((key) => { if (key.name === 'escape') close() }) }, [registerKeys, close])
    if (failing) throw new Error('fixture render failure')
    const overlay = placement === 'overlay'
    return <text id="fixture-analytics" fg={theme.text} {...(overlay ? { position: 'absolute' as const, top: 14, left: 40, zIndex: 50 } : {})}>FIXTURE ANALYTICS visits={visits}</text>
  }
  return { module: { apiVersion: 1, pluginId: 'analytics', views: { analytics: FixtureAnalytics } } }
})

const { tuiPluginViews } = await import('./shell/pluginViews')
const { default: OpenTuiApp } = await import('./App')
const setup = await testRender(<OpenTuiApp />, { width: 230, height: 44, kittyKeyboard: true })
const settle = async (ms = 150) => {
  for (let elapsed = 0; elapsed < ms; elapsed += 30) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)) })
}
const screen = () => setup.captureCharFrame()
const fail = (message: string): never => {
  console.error(`${message}\n${screen()}`)
  process.exit(1)
}
const check = (condition: unknown, message: string) => { if (!condition) fail(message) }
// Esc in the Git browser's detail pane first steps back to its tabs; a second closes it.
const closeGit = async () => {
  await key('escape')
  if (screen().includes('[: Actions]')) { await settle(); if (screen().includes('[: Actions]')) await key('escape') }
}
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
    else if (name === 'tab') setup.mockInput.pressTab()
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

// Executable plugin actions run through the same key/palette dispatch without a view.
await key('r', { shift: true })
await waitFor('reuse action copied the last prompt', () => screen().includes('REUSE plug-alpha'))
await act(async () => { await setup.mockInput.typeText('R') })
await waitFor('navigation shortcut yields to composer typing', () => screen().includes('REUSE plug-alphaR'))
await key('escape')
const actionSettings = await import('../../lib/plugins/enablement')
actionSettings.applyPluginSettings(actionSettings.withPluginEnabled(actionSettings.DEFAULT_PLUGIN_SETTINGS, 'composer-tools', false))
await key('r', { shift: true })
check(screen().includes('REUSE plug-alphaR'), 'disabled reuse action changed the composer')
actionSettings.applyPluginSettings(actionSettings.DEFAULT_PLUGIN_SETTINGS)
console.log('Reuse last prompt is a plugin action; its navigation shortcut yields to composer input and respects disablement.')

// Former root overlays are plugin surfaces now: their shortcuts reach them through the plugin command path.
await key('h', { shift: true })
await waitFor('⇧H opens the handoff plugin', () => screen().includes('Handoff brief') && tuiPluginViews.isLoaded('handoff'))
await key('escape')
await waitFor('handoff closes', () => !screen().includes('j/k scroll · d/u page · c copy'))
await key('k', { ctrl: true })
await key('s')
await waitFor('⌃K s opens the daily summary plugin', () => screen().includes('Daily summary') && tuiPluginViews.isLoaded('daily-summary'))
await key('escape')
await waitFor('daily summary closes', () => !screen().includes('t/y/w or Tab range'))
await act(async () => { actionSettings.applyPluginSettings(actionSettings.withPluginEnabled(actionSettings.DEFAULT_PLUGIN_SETTINGS, 'handoff', false)) })
await key('h', { shift: true })
await settle(200)
check(!screen().includes('j/k scroll · d/u page · c copy'), 'a disabled handoff plugin still opened')
await act(async () => { actionSettings.applyPluginSettings(actionSettings.DEFAULT_PLUGIN_SETTINGS) })
console.log('Handoff (⇧H) and the daily summary (⌃K s) open as plugins and respect disablement.')

// Composer accessories own their modal and native input without root goal cases.
fixtureGoal = { provider: 'claude', providerInstanceId: 'default', sessionId: 'plug-alpha', objective: 'PLUGIN-GOAL-OBJECTIVE', status: 'active', tokenBudget: null, tokensUsed: 0, continuations: 0, maxContinuations: 25, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), lastNote: null, lastDecision: null, lastEvaluatedAt: null, error: null }
const openGoal = async () => {
  await key('?')
  await act(async () => { await setup.mockInput.typeText('Session goal') })
  await settle(200)
  await key('return')
  await waitFor('goal accessory modal', () => screen().includes('What does done look like?'))
}
await openGoal()
await key('p', { ctrl: true })
await waitFor('goal paused', () => fixtureGoal?.status === 'paused' && screen().includes('^P resume'))
await key('p', { ctrl: true })
await waitFor('goal resumed', () => fixtureGoal?.status === 'active' && screen().includes('^P pause'))
const goalMutationCount = goalMutations.length
await act(async () => { actionSettings.applyPluginSettings(actionSettings.withPluginEnabled(actionSettings.DEFAULT_PLUGIN_SETTINGS, 'goals', false)) })
await waitFor('disabled goal modal closes', () => !screen().includes('What does done look like?'))
check(goalMutations.length === goalMutationCount && fixtureGoal?.status === 'active', 'disabling the goal UI changed the runtime goal')
await act(async () => { actionSettings.applyPluginSettings(actionSettings.DEFAULT_PLUGIN_SETTINGS) })
await waitFor('restored goal strip', () => screen().includes('PLUGIN-GOAL-OBJECTIVE'))
await openGoal()
await key('d', { ctrl: true })
await waitFor('explicit goal deletion', () => fixtureGoal === null && !screen().includes('What does done look like?'))
console.log('Goals use the composer plugin host: palette opening, native modal keys, pause/resume, disable/re-enable and explicit deletion preserve runtime ownership.')

// ⌃A opens it: one load, and a render failure stays local.
await key('a', { ctrl: true })
await waitFor('the failure view', () => screen().includes('Analytics stopped: fixture render failure'))
check(moduleEvaluations === 1 && tuiPluginViews.isLoaded('analytics'), 'opening did not load the plugin exactly once')
check(screen().includes('PLUG-ALPHA-BODY'), 'a plugin failure took the transcript down')
check(screen().includes('To:─Plug─alpha'), 'a plugin failure took the composer down')
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
await waitFor('the Git overlay', () => screen().includes('[: Actions]'))
check(tuiPluginViews.isLoaded('git'), 'Git opened without its plugin module')
await closeGit()
await waitFor('Git closed', () => !screen().includes('[: Actions]'))

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
check(!screen().includes('[: Actions]') && screen().includes('Git status is off'), 'a disabled plugin still opened, or said nothing')
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
await waitFor('the Git overlay after re-enabling', () => screen().includes('[: Actions]'))
check(isPluginEnabled('git') && !readPluginSettingsFile().disabled.includes('git'), 'turning Git back on was not saved')
await closeGit()
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
await waitFor('the folder picker', () => screen().includes(' Choose '))
await key('o')
await waitFor('back in the new-session modal', () => !screen().includes(' Choose ') && screen().includes(path.basename(CWD)))
await key('escape')
const { applyPluginSettings, withPluginEnabled, DEFAULT_PLUGIN_SETTINGS } = await import('../../lib/plugins/enablement')
applyPluginSettings(withPluginEnabled(DEFAULT_PLUGIN_SETTINGS, 'files', false))
await settle(100)
await key('n', { shift: true })
await settle(300)
await key('b')
await settle(300)
check(!screen().includes(' Choose ') && screen().includes('Folder browsing needs Files'), 'the folder picker opened with Files off, or said nothing')
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

// Messaging, the task list, the bridge panels and diagnostics are plugins:
// none loads before it is opened, each opens from its old key.
await settle(300)
for (const id of ['messaging', 'tasks', 'bridges', 'diagnostics']) check(!tuiPluginViews.isLoaded(id), `the ${id} plugin loaded before it was opened`)
await key('b', { ctrl: true }); await key('1')
await key('m', { shift: true })
await waitFor('the messaging overlay', () => screen().includes('Cross-session messaging') && screen().includes('reachable'))
check(tuiPluginViews.isLoaded('messaging') && !tuiPluginViews.isLoaded('tasks'), 'opening messaging loaded the wrong plugins')
await key('return')
await act(async () => { await setup.mockInput.typeText('PLUGIN-MESSAGE-DRAFT') })
await waitFor('the plugin message draft', () => screen().includes('PLUGIN-MESSAGE-DRAFT'))
await key('w', { ctrl: true, shift: true })
await waitFor('messaging placement choice or window', () => screen().includes('beside') || !!setup.renderer.root.findDescendantById('surface-frame:messaging'))
if (!setup.renderer.root.findDescendantById('surface-frame:messaging')) await key('return')
await waitFor('messaging draft retained in its window', () => !!setup.renderer.root.findDescendantById('surface-frame:messaging') && screen().includes('PLUGIN-MESSAGE-DRAFT'))
await key('return')
await waitFor('qualified messaging delivery', () => sentMessages.length === 1 && releaseMessage !== null)
check(sentMessages[0].toName === 'codex@work:same', 'messaging used a native id or ambiguous display name')
check(sentMessages[0].fromAddress?.startsWith('claude:plug-') === true, 'messaging omitted the source provider identity')
applyPluginSettings(withPluginEnabled(DEFAULT_PLUGIN_SETTINGS, 'messaging', false))
await waitFor('messaging disabled during delivery', () => screen().includes('Messaging is turned off'))
applyPluginSettings(DEFAULT_PLUGIN_SETTINGS)
await waitFor('messaging restored', () => screen().includes('PLUGIN-WORK-RECIPIENT') && !screen().includes('Messaging is turned off'))
await act(async () => { releaseMessage!({ delivered: true, mode: 'queued', targetName: 'STALE-MESSAGE-RECIPIENT' }) })
await settle(200)
check(!screen().includes('STALE-MESSAGE-RECIPIENT'), 'a disabled presentation delivered a late notice into its replacement')
check(sentMessages.length === 1, 'restoring messaging replayed a delivery')
await key('w', { ctrl: true, shift: true })
await waitFor('messaging back as an overlay', () => !setup.renderer.root.findDescendantById('surface-frame:messaging') && screen().includes('reachable'))
console.log('Messaging preserves its draft across placement changes, sends qualified addresses and rejects a late disabled delivery.')
await key('escape')
if (screen().includes('reachable')) await key('escape')
await waitFor('messaging closed', () => !screen().includes('reachable'))
await key('b', { ctrl: true }); await key('1')
await key('l', { shift: true })
await waitFor('the task list overlay', () => screen().includes(' Tasks '))
check(tuiPluginViews.isLoaded('tasks'), 'the task list opened without its plugin module')
await key('escape')
await waitFor('the task list closed', () => !screen().includes(' Tasks '))

// Diagnostics reads once per open: breaking it out into a window keeps what
// it read rather than reading again (a read can activate a session).
await key('d', { shift: true })
await waitFor('the diagnostics overlay', () => screen().includes('DIAGNOSTICS') && screen().includes('PLUGIN-DIAG-MARKER'))
check(diagnosticsReads === 1, `opening diagnostics read ${diagnosticsReads} times`)
await key('w', { ctrl: true, shift: true })
await waitFor('placement choice or window', () => screen().includes('beside') || !!setup.renderer.root.findDescendantById('surface-frame:diagnostics'))
if (!setup.renderer.root.findDescendantById('surface-frame:diagnostics')) await key('return')
await waitFor('diagnostics in a window', () => !!setup.renderer.root.findDescendantById('surface-frame:diagnostics') && screen().includes('PLUGIN-DIAG-MARKER'))
check(diagnosticsReads === 1, `moving diagnostics into a window read it again (${diagnosticsReads} reads)`)
await key('s')
await waitFor('diagnostics runtime action through its declared service', () => diagnosticsActions.some(action => action.sessionId === 'plug-alpha' && action.action === 'reloadSkills') && diagnosticsReads === 2)
applyPluginSettings(withPluginEnabled(DEFAULT_PLUGIN_SETTINGS, 'diagnostics', false))
await waitFor('the window saying diagnostics is off', () => screen().includes('Diagnostics is turned off'))
await key('b', { ctrl: true }); await key('1')
await key('d', { shift: true })
await waitFor('the refusal', () => screen().includes('Session diagnostics is off'))
check(diagnosticsReads === 2, 'a disabled diagnostics plugin still read the session')
holdDiagnosticsRead = true
applyPluginSettings(DEFAULT_PLUGIN_SETTINGS)
await waitFor('a restored diagnostics read in flight', () => releaseDiagnosticsRead !== null)
applyPluginSettings(withPluginEnabled(DEFAULT_PLUGIN_SETTINGS, 'diagnostics', false))
await waitFor('diagnostics disabled with a read pending', () => screen().includes('Diagnostics is turned off'))
holdDiagnosticsRead = false
applyPluginSettings(DEFAULT_PLUGIN_SETTINGS)
await waitFor('fresh diagnostics after re-enable', () => screen().includes('PLUGIN-DIAG-MARKER'))
await act(async () => { releaseDiagnosticsRead!({ currentModel: null, sections: [{ id: 'stale', title: 'STALE', items: ['STALE-DIAG-RESPONSE'] }] }) })
await settle(200)
check(!screen().includes('STALE-DIAG-RESPONSE'), 'a deactivated diagnostics read overwrote the new view')
console.log('Diagnostics ignores a late read from a disabled lifetime after the plugin is re-enabled.')

// The CLI bridge panel flips the composer's routing; turning the panel's
// plugin off closes the panel but not the bridge the composer routes through.
check(!screen().includes('→ live CLI bridge'), 'the composer was routed to the bridge before the test routed it')
await key('c', { shift: true })
await waitFor('the CLI bridge panel', () => screen().includes(' Live CLI bridge '))
check(tuiPluginViews.isLoaded('bridges'), 'the bridge panel opened without its plugin module')
check(bridgeSubscriptions === 2, `the open panel and host hold ${bridgeSubscriptions} bridge subscriptions, not 2`)
await key('r', { ctrl: true })
await waitFor('the composer routed to the bridge', () => screen().includes('→ live CLI bridge'))
check(bridgeSubscriptions === 2, `routing did not hold its own bridge subscription (${bridgeSubscriptions})`)
applyPluginSettings(withPluginEnabled(DEFAULT_PLUGIN_SETTINGS, 'bridges', false))
await waitFor('the panel closed', () => !screen().includes(' Live CLI bridge '))
check(screen().includes('→ live CLI bridge'), 'turning the bridge panels off dropped the composer\'s routing')
check(bridgeSubscriptions === 1, `turning the bridge panels off dropped the routed bridge connection (${bridgeSubscriptions} subscriptions)`)
await key('c', { shift: true })
await waitFor('the refusal', () => screen().includes('Channel bridge is off'))
check(!screen().includes(' Live CLI bridge '), 'a disabled bridge panel still opened')
applyPluginSettings(DEFAULT_PLUGIN_SETTINGS)
console.log('Messaging, tasks, the bridge panels and diagnostics load on first open; diagnostics reads once per open; a disabled bridge panel leaves the routed bridge running.')

// Terminal is a plugin, and the processes and shells it shows are the host's:
// ⌃K l loads it on demand, and neither closing its view nor turning the plugin
// off stops a running process or shell.
const { getProcesses, resetProcessesForTest } = await import('./processStore')
const { getShells, resetShellsForTest } = await import('./shellStore')
const { mkdirSync } = await import('node:fs')
mkdirSync(path.join(CWD, '.agent-viewer'), { recursive: true })
writeFileSync(path.join(CWD, '.agent-viewer', 'processes.json'), JSON.stringify({ processes: [{ name: 'sleeper', command: 'sleep 30' }] }))
const alive = (pid: number | null | undefined) => { if (!pid) return false; try { process.kill(pid, 0); return true } catch { return false } }
const sleeper = () => getProcesses().find((entry) => entry.name === 'sleeper')
const sleeperRunning = () => sleeper()?.status === 'running' && alive(sleeper()?.pid)
const shellRunning = () => getShells().some((entry) => entry.status === 'running')
check(!tuiPluginViews.isLoaded('terminal') && !tuiPluginViews.isLoaded('browser'), 'the Terminal or Browser plugin loaded before it was opened')
await key('k', { ctrl: true }); await key('l')
await waitFor('the Terminal tab with the declared process', () => tuiPluginViews.isLoaded('terminal') && screen().includes('sleeper'))
await key('s')
await waitFor('the process running', sleeperRunning)
await key('o')
await waitFor('a shell running', shellRunning)
await key(']', { ctrl: true })
await settle(200)
// ⇧O closes the focused panel: the view unmounts, the process and shell do not stop.
await key('O', { shift: true })
await waitFor('the panel closed', () => !screen().includes('sleeper'))
await settle(400)
check(sleeperRunning() && shellRunning(), 'closing the Terminal view stopped its process or shell')
// Open again, then turn the plugin off under the mounted view.
await key('k', { ctrl: true }); await key('l')
await waitFor('the Terminal tab again', () => screen().includes('sleeper'))
applyPluginSettings(withPluginEnabled(DEFAULT_PLUGIN_SETTINGS, 'terminal', false))
await waitFor('the Terminal view turned off', () => screen().includes('Terminal is turned off'))
await settle(400)
check(sleeperRunning() && shellRunning(), 'turning the Terminal plugin off stopped its process or shell')
await key('escape')
await key('b', { ctrl: true }); await key('1')
await key('k', { ctrl: true }); await key('l')
await settle(300)
check(screen().includes('● Processes and logs (dev server'), 'a disabled Terminal command opened, or said nothing')
applyPluginSettings(DEFAULT_PLUGIN_SETTINGS)
await settle(200)
check(sleeperRunning() && shellRunning(), 'turning the Terminal plugin back on disturbed its process or shell')
await resetProcessesForTest()
await resetShellsForTest()
console.log('Terminal opens as a lazy plugin; its process and shell outlive closing the view and turning the plugin off, and a disabled command says so.')

// Browser is a plugin too: a window of it loads on demand and its address
// field takes typing; turned off, opening one says so.
const openPalette = async (query: string) => {
  await key('?')
  await settle(250)
  await act(async () => { await setup.mockInput.typeText(query) })
  await settle(200)
  await key('return')
}
await key('escape')
await key('b', { ctrl: true }); await key('1')
await openPalette('Browser in a window')
await waitFor('the Browser window', () => tuiPluginViews.isLoaded('browser') && screen().includes('URL, host, or port'))
await act(async () => { await setup.mockInput.typeText('localhost:5173') })
await settle(200)
check(screen().includes('localhost:5173'), 'typing did not reach the Browser address field')
await key('escape')
applyPluginSettings(withPluginEnabled(DEFAULT_PLUGIN_SETTINGS, 'browser', false))
await waitFor('the Browser window turned off', () => !!setup.renderer.root.findDescendantById('plugin-disabled:browser'))
await openPalette('Browser in a window')
await settle(300)
check(screen().includes('Browser is off'), 'opening a disabled Browser window said nothing')
applyPluginSettings(DEFAULT_PLUGIN_SETTINGS)
console.log('Browser opens as a lazy plugin window whose address field takes typing, and says so when it is off.')
// Checkpoints, file history and pull requests are plugins. ⇧U loads checkpoints
// on demand; h on a review row opens file history ABOVE it (its own overlay
// slot), and closing that gives the keys back to checkpoints underneath. Git's
// p reaches pull requests through the plugin command. Each, turned off, says so.
for (const id of ['checkpoints', 'file-history', 'pull-requests']) check(!tuiPluginViews.isLoaded(id), `the ${id} plugin loaded before it was opened`)
writeFileSync('README.md', 'fixture\nchanged by the smoke\n')
await key('b', { ctrl: true }); await key('1')
await key('u', { shift: true })
await waitFor('the checkpoints overlay', () => screen().includes(' Checkpoints & review '))
check(tuiPluginViews.isLoaded('checkpoints') && !tuiPluginViews.isLoaded('file-history'), 'checkpoints opened without its module, or loaded file history with it')
await key('tab')
await waitFor('the review tab with the README hunk', () => screen().includes('README.md'))
await key('h')
await waitFor('file history over checkpoints', () => screen().includes(' File history · README.md '))
check(tuiPluginViews.isLoaded('file-history'), 'file history opened without its plugin module')
await key('escape')
await waitFor('checkpoints back on top', () => !screen().includes(' File history · ') && screen().includes(' Checkpoints & review '))
await key('escape')
await waitFor('checkpoints closed', () => !screen().includes(' Checkpoints & review '))
await key('g', { ctrl: true })
await waitFor('the Git overlay for p', () => screen().includes('[: Actions]'))
await key('p')
await waitFor('pull requests from Git', () => tuiPluginViews.isLoaded('pull-requests') && !screen().includes('[: Actions]'))
await key('escape')
await settle(300)
applyPluginSettings({ ...DEFAULT_PLUGIN_SETTINGS, disabled: ['checkpoints', 'pull-requests', 'file-history'] })
await settle(200)
await key('u', { shift: true })
await settle(300)
check(!screen().includes('TURNS') && screen().includes('Checkpoints & review is off'), 'disabled checkpoints still opened, or said nothing')
await key('g', { ctrl: true, shift: true })
await settle(300)
check(screen().includes('Review pull requests is off'), 'disabled pull requests still opened from ⌃⇧G, or said nothing')
await key('g', { ctrl: true })
await waitFor('the Git overlay with PRs off', () => screen().includes('[: Actions]'))
await key('p')
await settle(300)
check(screen().includes('[: Actions]') && screen().includes('Review pull requests is off'), "Git's p did not keep Git and say pull requests are off")
await closeGit()
applyPluginSettings({ ...DEFAULT_PLUGIN_SETTINGS, disabled: ['file-history'] })
await settle(200)
await key('u', { shift: true })
await waitFor('checkpoints with file history off', () => screen().includes(' Checkpoints & review '))
await key('tab')
await waitFor('the review tab again', () => screen().includes('README.md'))
await key('h')
await settle(300)
check(!screen().includes(' File history · ') && screen().includes('File history is off'), 'disabled file history still opened from checkpoints, or said nothing')
await key('escape')
applyPluginSettings(DEFAULT_PLUGIN_SETTINGS)
console.log('Checkpoints, file history and pull requests open as lazy plugins; file history stacks over checkpoints; each says so when off.')

// Coordination: the control center and the teammates panel are one lazy
// plugin; the desk another. Closing or turning a view off leaves the team (the
// interactive coordinator store, its session and feed) as it was, and calls
// nothing that stops a run or a teammate.
const portable = async (letter: string) => { await key('k', { ctrl: true }); await key(letter) }
const checkWindowRoundTrip = async (id: string, marker: string) => {
  const frame = () => setup.renderer.root.findDescendantById(`surface-frame:${id}`)
  await key('w', { ctrl: true, shift: true })
  await waitFor(`${id} placement choice or window`, () => screen().includes('beside') || !!frame())
  if (!frame()) await key('return')
  await waitFor(`${id} docked`, () => !!frame() && screen().includes(marker))
  await portable('w')
  await waitFor(`${id} yields to window management`, () => screen().includes('MANAGE WINDOWS'))
  await key('escape')
  await key('w', { ctrl: true, shift: true })
  await waitFor(`${id} returned to overlay`, () => !frame() && screen().includes(marker))
}
check(!tuiPluginViews.isLoaded('coordination'), 'the Coordination plugin loaded before a coordination view was opened')
check(!tuiPluginViews.isLoaded('desk'), 'the Desk plugin loaded before the desk was opened')
// The manager is a Coordination surface, registered and dispatched like every
// plugin; native inputs and unsaved state stay with its instance when detached.
check(playbookLists === 0, 'playbooks were read before any manager/workflow opened')
await openPalette('Manage playboo')
await waitFor('lazy playbook manager', () => tuiPluginViews.isLoaded('coordination') && screen().includes('REUSABLE COORDINATOR WORKFLOWS') && screen().includes('fixture-workflow'))
await key('e')
await waitFor('structured playbook editor', () => screen().includes('PLAYBOOK SETTINGS') && screen().includes('PLUGIN-PLAYBOOK-DESCRIPTION'))
await act(async () => { await setup.mockInput.typeText('UNSAVED-PLAYBOOK-DRAFT') })
await waitFor('playbook draft typed', () => screen().includes('UNSAVED-PLAYBOOK-DRAFT'))
await checkWindowRoundTrip('playbooks', 'UNSAVED-PLAYBOOK-DRAFT')
check(playbookWrites.length === 0, 'moving the manager saved its unsaved draft')
await key('escape')
await key('escape')
await waitFor('playbook manager closed', () => !screen().includes('REUSABLE COORDINATOR WORKFLOWS'))

// A native read deliberately ignores cancellation. Closing the view and opening
// a new owner must still prevent the former read from replacing its editor.
holdPlaybookRead = true
await openPalette('Manage playboo')
await waitFor('manager reopened for pending read', () => screen().includes('fixture-workflow') && screen().includes('REUSABLE COORDINATOR WORKFLOWS'))
await key('e')
await waitFor('playbook read pending', () => releasePlaybookRead !== null)
await key('escape')
await waitFor('pending manager closed', () => !screen().includes('REUSABLE COORDINATOR WORKFLOWS'))
holdPlaybookRead = false
await openPalette('Manage playboo')
await waitFor('replacement manager', () => screen().includes('REUSABLE COORDINATOR WORKFLOWS'))
await key('n')
await act(async () => { await setup.mockInput.typeText('NEXT-PLAYBOOK-OWNER') })
await waitFor('replacement draft', () => screen().includes('NEXT-PLAYBOOK-OWNER'))
await act(async () => { releasePlaybookRead!({ ...fixturePlaybook, name: 'STALE-PLAYBOOK-OWNER' }) })
await settle(300)
check(screen().includes('NEXT-PLAYBOOK-OWNER') && !screen().includes('STALE-PLAYBOOK-OWNER'), 'a closed manager read replaced its successor draft')
check(playbookReads.every(read => read.cwd === CWD && read.name === fixturePlaybook.name), 'manager read lost its captured repository or selected name')
await act(async () => { applyPluginSettings(withPluginEnabled(DEFAULT_PLUGIN_SETTINGS, 'coordination', false)) })
await waitFor('coordination disable removes manager', () => !screen().includes('REUSABLE COORDINATOR WORKFLOWS'))
await key('?')
await act(async () => { await setup.mockInput.typeText('Manage playboo') })
await settle(200)
check(screen().includes('no matches'), 'disabled coordination still advertised its manager command')
await key('return')
check(!screen().includes('REUSABLE COORDINATOR WORKFLOWS'), 'disabled manager reopened from the palette')
await key('escape')
await act(async () => { applyPluginSettings(DEFAULT_PLUGIN_SETTINGS) })
console.log('Playbooks open through the lazy Coordination plugin; native draft inputs survive window moves, closed reads cannot affect replacement editors, and disablement removes the manager and its command.')

await portable('a')
await waitFor('the control center', () => screen().includes('AGENT CONTROL CENTER'))
check(tuiPluginViews.isLoaded('coordination'), 'the control center opened without its plugin module')
await checkWindowRoundTrip('coordination', 'AGENT CONTROL CENTE')
// Existing setup reaches the same plugin and resumes with its brief intact.
await key('n')
await waitFor('workflow setup from coordination', () => screen().includes('NEW WORKFLOW'))
await act(async () => { await setup.mockInput.typeText('WORKFLOW-BRIEF-KEPT') })
for (let index = 0; index < 5; index += 1) await key('tab')
const listsBeforeManageReturn = playbookLists
await key('m')
await waitFor('workflow Manage opens plugin manager', () => screen().includes('REUSABLE COORDINATOR WORKFLOWS') && !screen().includes('NEW WORKFLOW'))
await key('escape')
await waitFor('manager returns to workflow setup', () => screen().includes('NEW WORKFLOW') && screen().includes('WORKFLOW-BRIEF-KEPT') && !screen().includes('REUSABLE COORDINATOR WORKFLOWS'))
check(playbookLists > listsBeforeManageReturn + 1, 'returning from the manager did not refresh setup playbooks')
// The root registers an accepted run even when its form closes and the plugin
// turns off during submission, without selecting the late run or reopening UI.
for (let index = 0; index < 13; index += 1) await key('tab')
await key('return')
await waitFor('root workflow submission pending', () => rootLaunches.length === 1 && releaseRootLaunch !== null)
await key('return')
check(rootLaunches.length === 1, 'native form submitted twice while start was pending')
await key('escape')
await act(async () => { applyPluginSettings(withPluginEnabled(DEFAULT_PLUGIN_SETTINGS, 'coordination', false)) })
await settle(100)
await act(async () => { releaseRootLaunch!(acceptedRootRun) })
await waitFor('accepted run registered as a background tab and watch', () => screen().includes('Late run') && watchedAcceptedRuns.includes('late-native-run'))
check(screen().includes('PLUG-ALPHA-BODY') && !screen().includes('NEW WORKFLOW') && !screen().includes('AGENT CONTROL CENTER'), 'late accepted run changed selection or reopened its presentation')
check(!screen().includes('Coordinated run started'), 'late accepted run showed a stale form success notice')
await act(async () => { applyPluginSettings(DEFAULT_PLUGIN_SETTINGS) })
await key('escape')
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
await checkWindowRoundTrip('desk', 'AGENT VIEWER ▸ DESK')
await key('escape')
await waitFor('the desk closed', () => !screen().includes('AGENT VIEWER ▸ DESK'))
applyPluginSettings(withPluginEnabled(DEFAULT_PLUGIN_SETTINGS, 'desk', false))
await settle(100)
await portable('b')
await settle(300)
check(!screen().includes('AGENT VIEWER ▸ DESK') && screen().includes('Bloomberg-style desk is off'), 'a disabled desk still opened, or said nothing')
applyPluginSettings(DEFAULT_PLUGIN_SETTINGS)
console.log('The desk opens as a lazy plugin from ⌃K b and refuses with a notice when turned off.')

// Prompt library owns its UI, draft state and key capture in the same plugin
// host as other features; saved storage remains the host service.
await service.saveTuiPrompt({ title: 'Plugin prompt', body: 'Review {{file}} carefully.' })
check(!tuiPluginViews.isLoaded('prompt-library'), 'prompt library loaded before opening')
await key('p', { shift: true })
await waitFor('prompt library plugin', () => screen().includes('Plugin prompt'))
check(tuiPluginViews.isLoaded('prompt-library'), 'prompt library bypassed the plugin loader')
await key('n')
await act(async () => { await setup.mockInput.typeText('Draft survives placement') })
await waitFor('prompt draft', () => screen().includes('Draft survives placement'))
await checkWindowRoundTrip('prompt-library', 'Draft survives placement')
await key('escape')
await waitFor('prompt browse', () => screen().includes('Plugin prompt'))
await key('return')
await waitFor('prompt fill', () => screen().includes('file'))
await act(async () => { await setup.mockInput.typeText('README.md') })
await key('return', { ctrl: true })
await waitFor('prompt inserted into composer', () => screen().includes('Review README.md carefully.'))
applyPluginSettings(withPluginEnabled(DEFAULT_PLUGIN_SETTINGS, 'prompt-library', false))
await settle(100)
await key('p', { shift: true })
check(!tuiPluginViews.isLoaded('prompt-library'), 'disabled prompt library was activated')
applyPluginSettings(DEFAULT_PLUGIN_SETTINGS)
console.log('Prompt library is lazy, preserves an unsaved draft across window moves, fills and inserts templates, and respects disablement.')

// An enabled application observer runs with no alert surface mounted.
check(!tuiPluginViews.isLoaded('session-alerts'), 'background alerts eagerly loaded their view')
observedRuntime = { running: [], waiting: [], attention: SESSIONS.map(session => ({
  id: `observer-${session.sessionId}`, sessionId: session.sessionId, provider: session.provider!,
  title: 'Answer needed', createdAt: Date.now(),
})) }
await waitFor('application observer notification', () => screen().includes('needs you'))
check(!tuiPluginViews.isLoaded('session-alerts'), 'notification delivery loaded its settings surface')
observedRuntime = { running: [], waiting: [], attention: [] }
console.log('Session alerts deliver through the application observer in the real TUI without loading their view.')

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

// Reusing a host for a different surface must replace the cached component.
let changeSurface: (id: 'analytics' | 'files') => void = () => {}
const cache = {
  analytics: { apiVersion: 1 as const, pluginId: 'analytics', views: { analytics: () => <text>SWITCH ANALYTICS</text> } },
  files: { apiVersion: 1 as const, pluginId: 'files', views: { files: () => <text>SWITCH FILES</text> } },
}
const switchingRegistry = { peek: (id: string) => cache[id as keyof typeof cache], load: async (id: string) => cache[id as keyof typeof cache] }
function SwitchingHost() {
  const [surfaceId, setSurface] = React.useState<'analytics' | 'files'>('analytics')
  changeSurface = setSurface
  return <PluginSurfaceHost surfaceId={surfaceId} placement="window" theme={theme} width={60} height={6} focused onClose={() => {}} onKeyHandlerReady={() => {}} registry={switchingRegistry} />
}
const switching = await testRender(<SwitchingHost />, { width: 60, height: 6 })
await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)) })
check(switching.captureCharFrame().includes('SWITCH ANALYTICS'), 'initial cached view did not mount')
await act(async () => { changeSurface('files'); await new Promise(resolve => setTimeout(resolve, 30)) })
check(switching.captureCharFrame().includes('SWITCH FILES') && !switching.captureCharFrame().includes('SWITCH ANALYTICS'), 'changing surface retained the previous component')
switching.renderer.destroy()
console.log('Switching a mounted host replaces its cached plugin component')

process.exit(0)
