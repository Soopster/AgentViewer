import { StrictMode, useCallback, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ApplicationPluginHost } from '../components/shell/ApplicationPluginHost'
import { dispatchPluginCommand } from '../lib/plugins/commandBus'
import PluginSurfaceHost from '../components/shell/PluginSurfaceHost'
import type { WebPluginServices } from '../components/shell/pluginTypes'
import type { PluginPlaybookService } from '../lib/plugins/playbooks'
import type { RunPlaybook, PlaybookSummary } from '../lib/agentProtocol'
import { applyPluginSettings, readPluginSettings, withPluginEnabled } from '../lib/plugins/enablement'
import { useDisabledPlugins } from '../lib/plugins/useDisabledPlugins'

const seed: RunPlaybook = { name: 'seed', description: 'Seed workflow', phases: [{ title: 'Execute', tasks: [{ key: 'work', title: 'Do work', detail: 'Complete work', role: 'teammate' }] }] }
const data = new Map<string, Map<string, RunPlaybook>>()
const calls: Array<{ method: string; cwd: string; name?: string; aborted?: boolean }> = []
const pending: Array<{ resolve: () => void }> = []
const controls = { delayRead: false, delayWrite: false, failWrite: false }
Object.assign(window, { __playbookCalls: calls, __playbookPending: pending, __playbookControls: controls })
function books(cwd: string) {
  if (!data.has(cwd)) data.set(cwd, new Map([[seed.name, structuredClone(seed)]]))
  return data.get(cwd)!
}
function summary(value: RunPlaybook): PlaybookSummary {
  return { ...value, path: `${value.name}.json`, phaseCount: value.phases.length, taskCount: value.phases.reduce((n, phase) => n + phase.tasks.length, 0), expectsArgs: false }
}
const service: PluginPlaybookService = {
  async list(cwd) { calls.push({ method: 'list', cwd }); return { playbooks: [...books(cwd).values()].map(summary), invalid: [] } },
  async read(cwd, name, signal) {
    const call = { method: 'read', cwd, name, aborted: false }; calls.push(call)
    if (controls.delayRead) await new Promise<void>(resolve => pending.push({ resolve }))
    call.aborted = Boolean(signal?.aborted)
    return structuredClone(books(cwd).get(name)!)
  },
  async write(cwd, value, previousName, signal) {
    const call = { method: 'write', cwd, name: previousName, aborted: false }; calls.push(call)
    if (controls.delayWrite) await new Promise<void>(resolve => pending.push({ resolve }))
    call.aborted = Boolean(signal?.aborted)
    if (controls.failWrite) throw new Error('Fixture save refused')
    if (previousName) books(cwd).delete(previousName)
    books(cwd).set(value.name, structuredClone(value))
    return { playbook: value, path: `${cwd}/${value.name}.json` }
  },
  async remove(cwd, name) { calls.push({ method: 'remove', cwd, name }); books(cwd).delete(name) },
}
function Fixture() {
  const [cwd, setCwd] = useState('/fixture/one')
  const [placement, setPlacement] = useState<'window' | 'overlay'>('overlay')
  const [open, setOpen] = useState(true)
  const [embedded, setEmbedded] = useState(false)
  const [commandHost, setCommandHost] = useState(false)
  const disabled = useDisabledPlugins().has('coordination')
  const close = useCallback(() => setOpen(false), [])
  const services = useMemo<WebPluginServices>(() => ({ playbooks: service, repository: { cwd, sessionId: null }, coordination: {
    provider: 'claude', selectedSession: { sessionId: 'lead', provider: 'claude', providerInstanceId: 'work', cwd }, openSession() {},
  } }), [cwd])
  const host = !commandHost && open && <PluginSurfaceHost ownerId="playbooks-fixture" surfaceId={embedded ? 'coordination' : 'playbooks'} placement={placement}
    sessionKey={null} cwd={cwd} services={services} onClose={close} />
  return <>
    <div style={{ position: 'relative', zIndex: 200 }}>
      <button onClick={() => setOpen(true)}>Open manager</button>
      <button onClick={close}>Hide manager</button>
      <button onClick={() => setPlacement(value => value === 'window' ? 'overlay' : 'window')}>Move placement</button>
      <button onClick={() => setCwd(value => value === '/fixture/one' ? '/fixture/two' : '/fixture/one')}>Switch repository</button>
      <button onClick={() => applyPluginSettings(withPluginEnabled(readPluginSettings(), 'coordination', disabled))}>{disabled ? 'Enable coordination' : 'Disable coordination'}</button>
      <button onClick={() => setEmbedded(value => !value)}>Toggle embedded</button>
      <button onClick={() => setCommandHost(true)}>Use command host</button>
      <button onClick={() => dispatchPluginCommand('playbooks')}>Dispatch playbooks</button>
    </div>
    {commandHost && <ApplicationPluginHost sessions={[]} selectedSession={null} cwd={cwd} />}
    <output data-testid="cwd">{cwd}</output>
    {placement === 'window' ? <section style={{ width: 1150, height: 900 }}>{host}</section> : <div>{host}</div>}
  </>
}
createRoot(document.getElementById('root')!).render(<StrictMode><Fixture /></StrictMode>)
