'use client'

// Web panel for the Chief of Staff: its own chunk, loaded on first open.
import { useCallback, useEffect, useRef, useState } from 'react'
import { PLUGIN_API_VERSION, type PluginViewModule } from '@/lib/plugins/types'
import type { WebPluginView, WebPluginViewProps } from '@/components/shell/pluginTypes'
import type { ChiefOfStaffState } from '@/lib/chiefOfStaff/service'
import { subscribeChiefOfStaffRequest, takeChiefOfStaffRequest } from '../seed'
import { COS_PROVIDERS, type CosRule } from '@/lib/chiefOfStaff/rules'
import { panelSections } from '../model'

const REFRESH_MS = 6000
const BLANK: CosRule = { match: '', provider: 'claude' }

/** Routing rules: list, add, edit, delete. Every change saves the whole list and shows what the server made of it. */
function RulesEditor({ rules, problems, onSave }: { rules: CosRule[]; problems: { rule: number; message: string }[]; onSave: (next: CosRule[]) => Promise<boolean> }) {
  const [editing, setEditing] = useState<{ index: number; rule: CosRule } | null>(null)
  const [armed, setArmed] = useState<number | null>(null)
  const set = (patch: Partial<CosRule>) => setEditing(current => current && { ...current, rule: { ...current.rule, ...patch } })
  const clean = (rule: CosRule): CosRule => ({
    match: rule.match.trim(), provider: rule.provider,
    ...(rule.instance?.trim() ? { instance: rule.instance.trim() } : {}), ...(rule.model?.trim() ? { model: rule.model.trim() } : {}),
    ...(rule.effort?.trim() ? { effort: rule.effort.trim() } : {}), ...(rule.role?.trim() ? { role: rule.role.trim() } : {}),
    ...(rule.worktree === false ? { worktree: false } : {}),
  })
  const save = async () => {
    if (!editing) return
    const next = rules.map(rule => ({ ...rule }))
    if (editing.index < 0) next.push(clean(editing.rule)); else next[editing.index] = clean(editing.rule)
    if (await onSave(next)) setEditing(null)
  }
  return (
    <section>
      <h3 className="text-xs font-semibold uppercase text-muted-foreground">Routing rules ({rules.length})</h3>
      <ul>
        {rules.map((rule, index) => (
          <li key={index} className="flex items-center gap-2">
            <span className="flex-1">{rule.match} → {rule.provider}{rule.instance ? `/${rule.instance}` : ''}{rule.model ? ` ${rule.model}` : ''}{rule.effort ? ` · ${rule.effort}` : ''}{rule.worktree === false ? ' · no worktree' : ''}</span>
            <button type="button" onClick={() => { setEditing({ index, rule: { ...rule } }); setArmed(null) }}>Edit</button>
            {armed === index
              ? <><button type="button" onClick={() => { setArmed(null); void onSave(rules.filter((_, at) => at !== index)) }}>Confirm delete</button><button type="button" onClick={() => setArmed(null)}>Keep</button></>
              : <button type="button" onClick={() => setArmed(index)}>Delete</button>}
          </li>
        ))}
      </ul>
      {rules.length === 0 && problems.length === 0 ? <p className="text-muted-foreground">None yet.</p> : null}
      {problems.map((problem, index) => <p key={index} role="alert" className="text-red-500">✗ {problem.rule ? `#${problem.rule} ` : ''}{problem.message}</p>)}
      {editing ? (
        <form onSubmit={event => { event.preventDefault(); void save() }} className="mt-2 flex flex-wrap items-end gap-2">
          <input value={editing.rule.match} onChange={event => set({ match: event.target.value })} placeholder="Kind of work" aria-label="Match" />
          <select value={editing.rule.provider} onChange={event => set({ provider: event.target.value })} aria-label="Provider">{COS_PROVIDERS.map(name => <option key={name}>{name}</option>)}</select>
          <input value={editing.rule.instance ?? ''} onChange={event => set({ instance: event.target.value })} placeholder="Account (optional)" aria-label="Instance" />
          <input value={editing.rule.model ?? ''} onChange={event => set({ model: event.target.value })} placeholder="Model (optional)" aria-label="Model" />
          <input value={editing.rule.effort ?? ''} onChange={event => set({ effort: event.target.value })} placeholder="Effort (optional)" aria-label="Effort" />
          <input value={editing.rule.role ?? ''} onChange={event => set({ role: event.target.value })} placeholder="Role (optional)" aria-label="Role" />
          <label><input type="checkbox" checked={editing.rule.worktree !== false} onChange={event => set({ worktree: event.target.checked ? undefined : false })} /> Worktree</label>
          <button type="submit" disabled={!editing.rule.match.trim()}>Save rule</button>
          <button type="button" onClick={() => setEditing(null)}>Cancel</button>
        </form>
      ) : <button type="button" className="mt-2" onClick={() => setEditing({ index: -1, rule: { ...BLANK } })}>Add rule</button>}
    </section>
  )
}

function ChiefOfStaffView({ services, close }: WebPluginViewProps) {
  const service = services['chief-of-staff']!
  const cwd = services.repository!.cwd
  const provider = services.session?.session?.provider ?? 'claude'
  const [state, setState] = useState<ChiefOfStaffState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const sending = useRef(false)

  const reload = useCallback((signal?: AbortSignal) => {
    service.read(cwd, signal)
      .then(next => { if (!signal?.aborted) { setState(next); setError(null) } })
      .catch((err: unknown) => { if (!signal?.aborted) setError(err instanceof Error ? err.message : 'Could not read the Chief of Staff') })
  }, [service, cwd])
  useEffect(() => {
    const controller = new AbortController()
    reload(controller.signal)
    const timer = setInterval(() => reload(controller.signal), REFRESH_MS)
    return () => { controller.abort(); clearInterval(timer) }
  }, [reload])

  const send = useCallback(async (request: string) => {
    if (sending.current) return
    sending.current = true
    setBusy(true)
    try {
      await service.start({ cwd, provider, request: request || undefined })
      setDraft('')
      setError(null)
      reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the Chief of Staff')
    } finally { sending.current = false; setBusy(false) }
  }, [service, cwd, provider, reload])

  useEffect(() => {
    const first = takeChiefOfStaffRequest()
    if (first) void send(first)
    return subscribeChiefOfStaffRequest(request => { void send(request) })
  }, [send])

  const saveRules = useCallback(async (next: CosRule[]) => {
    try { setState(await service.saveRules(cwd, next)); setError(null); return true } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the rules')
      return false
    }
  }, [service, cwd])
  const session = state?.session
  const open = () => { if (session) { services['session-navigation']?.open({ sessionId: session.sessionId, provider: session.provider as never }); close() } }
  return (
    <div role="dialog" aria-label="Chief of Staff" className="flex flex-col gap-3 p-4 text-sm">
      <div className="flex items-center justify-between">
        <strong>☗ Chief of Staff · {state ? (session ? 'running' : 'not started') : 'loading…'}</strong>
        <div className="flex gap-2">
          {session ? <button type="button" onClick={open}>Open chat</button> : null}
          <button type="button" onClick={close}>Close</button>
        </div>
      </div>
      <form onSubmit={event => { event.preventDefault(); void send(draft.trim()) }} className="flex gap-2">
        <input value={draft} onChange={event => setDraft(event.target.value)} placeholder="Hand the Chief of Staff a request" aria-label="Request" className="flex-1" />
        <button type="submit" disabled={busy || (!draft.trim() && !!session)}>{session ? 'Send' : 'Start'}</button>
      </form>
      {error ? <p role="alert" className="text-red-500">{error}</p> : null}
      {state ? panelSections(state).map(section => section.id === 'rules' ? <RulesEditor key="rules" rules={state.ruleList} problems={state.problems} onSave={saveRules} /> : (
        <section key={section.title}>
          <h3 className="text-xs font-semibold uppercase text-muted-foreground">{section.title}</h3>
          <ul className={section.id === 'report' ? 'whitespace-pre-wrap' : undefined}>{section.lines.map((line, index) => <li key={index} className={line.tone === 'bad' ? 'text-red-500' : line.tone === 'dim' ? 'text-muted-foreground' : undefined}>{line.text}</li>)}</ul>
        </section>
      )) : null}
    </div>
  )
}

export const module: PluginViewModule<WebPluginView> = {
  apiVersion: PLUGIN_API_VERSION,
  pluginId: 'chief-of-staff',
  views: { 'chief-of-staff': ChiefOfStaffView },
}
