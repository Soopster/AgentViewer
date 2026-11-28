'use client'

// Web panel for pstack: model roles, playbook install and the skill list.
import { useEffect, useRef, useState } from 'react'
import { PLUGIN_API_VERSION, type PluginViewModule } from '@/lib/plugins/types'
import type { WebPluginView, WebPluginViewProps } from '@/components/shell/pluginTypes'
import { installWorkflowPack } from '@/lib/plugins/workflowPacks'
import { PSTACK_PACK } from '@/lib/pstack/playbooks'
import type { PstackState } from '@/lib/pstack/service'
import { fileProblems, roleRows, ROLE_FORMAT, USAGE_LINES, type PstackRoleRow } from '../model'

function RoleField({ row, onSave }: { row: PstackRoleRow; onSave: (line: string) => Promise<void> }) {
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <form onSubmit={event => { event.preventDefault(); if (draft !== null) void onSave(draft).then(() => setDraft(null), () => {}) }} className="flex flex-wrap items-center gap-2">
      <label htmlFor={`pstack-${row.id}`} className="w-48" title={row.hint}>{row.id}</label>
      <input id={`pstack-${row.id}`} className="min-w-64 flex-1 rounded border bg-transparent px-2 py-1" value={draft ?? row.line} placeholder={`session model (${ROLE_FORMAT}${row.panel ? ', …' : ''})`} onChange={event => setDraft(event.target.value)} />
      {draft !== null && draft !== row.line ? <><button type="submit">Save</button><button type="button" onClick={() => setDraft(null)}>Cancel</button></> : null}
      {row.problem ? <p role="alert" className="w-full text-red-500">✗ Not applied: {row.problem}</p> : null}
    </form>
  )
}

function PstackView({ services, close }: WebPluginViewProps) {
  const service = services.pstack!
  const cwd = services.repository!.cwd
  const [state, setState] = useState<PstackState | null>(null)
  const [notice, setNotice] = useState('')
  const [installing, setInstalling] = useState(false)
  const lock = useRef(false)
  const message = (error: unknown) => error instanceof Error ? error.message : String(error)

  useEffect(() => {
    const controller = new AbortController()
    service.read(cwd, controller.signal).then(next => { if (!controller.signal.aborted) setState(next) }).catch((error: unknown) => { if (!controller.signal.aborted) setNotice(message(error)) })
    return () => controller.abort()
  }, [service, cwd])

  const save = async (role: string, line: string) => {
    try { setState(await service.saveRole(cwd, role, line)); setNotice('') } catch (error) { setNotice(message(error)); throw error }
  }
  const install = async () => {
    if (lock.current) return
    lock.current = true
    setInstalling(true)
    try {
      const result = await installWorkflowPack(services.playbooks!, cwd, PSTACK_PACK)
      setNotice([result.installed.length ? `Installed ${result.installed.join(', ')}` : '', ...result.skipped, ...result.errors].filter(Boolean).join(' · '))
    } catch (error) { setNotice(message(error)) } finally { lock.current = false; setInstalling(false) }
  }

  return (
    <div role="dialog" aria-label="pstack" className="flex flex-col gap-3 overflow-auto p-4 text-sm">
      <div className="flex items-center justify-between">
        <strong>≡ pstack {state ? `${state.version} · ${state.skills.length} skills` : '· loading…'}</strong>
        <button type="button" onClick={close}>Close</button>
      </div>
      <ul className="text-muted-foreground">{USAGE_LINES.map(line => <li key={line}>{line}</li>)}</ul>
      {notice ? <p role="status" className="text-amber-600">{notice}</p> : null}
      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold uppercase text-muted-foreground">Model roles</h3>
        <p className="text-muted-foreground">An empty role runs on the session&apos;s own model. Saved for you in {state?.configFile ?? 'your config'}.</p>
        {state ? fileProblems(state).map(problem => <p key={problem.message} role="alert" className="text-red-500">✗ {problem.message}</p>) : null}
        {state ? roleRows(state).map(row => <RoleField key={row.id} row={row} onSave={line => save(row.id, line)} />) : null}
      </section>
      <section>
        <h3 className="text-xs font-semibold uppercase text-muted-foreground">Coordinator playbooks</h3>
        <p className="text-muted-foreground">{PSTACK_PACK.playbooks.map(item => item.name).join(', ')}. Existing files are kept. Installing starts no agents.</p>
        <button type="button" disabled={installing} onClick={() => { void install() }}>Install in this repository</button>
      </section>
      <section>
        <h3 className="text-xs font-semibold uppercase text-muted-foreground">Skills</h3>
        <p>{state?.skills.filter(name => !name.startsWith('principle-')).join(' · ')}</p>
        <p className="text-muted-foreground">Also listed in the Skill picker and Skills Manager. pstack by Lauren Tan, MIT.</p>
      </section>
    </div>
  )
}

export const module: PluginViewModule<WebPluginView> = {
  apiVersion: PLUGIN_API_VERSION,
  pluginId: 'pstack',
  views: { pstack: PstackView },
}
